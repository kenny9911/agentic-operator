#!/usr/bin/env python3
"""Fetch reviewed, commit-pinned GitHub skill folders without running their code.

sources.json and curation.json are the operator-reviewed allow-list. --discover only reports new
upstream candidates; it never changes pins, licenses, downloads or publications.
"""
import argparse
import concurrent.futures
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import struct
import tempfile
import time
import urllib.parse
import urllib.request

ROOT = Path(__file__).resolve().parents[1] / "skills-library"
MAX_FILE = 5 * 1024 * 1024
MAX_DOWNLOAD = 100 * 1024 * 1024
MANAGED_ROOTS = ("upstream", "adapted")


def safe_path(value):
    if not isinstance(value, str) or not value or "\\" in value:
        raise ValueError(f"Unsafe source path: {value!r}")
    parts = value.split("/")
    if any(p in ("", ".", "..") or p.strip() != p for p in parts):
        raise ValueError(f"Unsafe source path: {value!r}")
    if any(ord(c) < 32 for c in value) or ":" in value:
        raise ValueError(f"Unsafe source path: {value!r}")
    return value


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def bundle_digest(directory):
    """Match packages/skills/src/bundle.ts digestFiles, including JS path order."""
    files = [(p.relative_to(directory).as_posix(), p.read_bytes()) for p in directory.rglob("*") if p.is_file()]
    digest = hashlib.sha256(b"agentic-skill-bundle-v1\0")
    for name, data in sorted(files, key=lambda item: item[0].encode("utf-16-be")):
        encoded = name.encode("utf8")
        digest.update(struct.pack(">II", len(encoded), len(data)))
        digest.update(encoded)
        digest.update(data)
    return digest.hexdigest()


def override_description(original, description):
    """Replace one reviewed frontmatter field; preserve every other source byte."""
    if not isinstance(description, str) or not description.strip() or len(description.encode("utf-16-le")) // 2 > 1024:
        raise ValueError("A reviewed description override must contain 1–1024 characters")
    text = original.decode("utf8")
    lines = text.splitlines(keepends=True)
    if not lines or lines[0].strip() != "---":
        raise ValueError("Description adaptation requires YAML frontmatter")
    close = next((i for i in range(1, len(lines)) if lines[i].strip() == "---"), None)
    if close is None:
        raise ValueError("Description adaptation requires a closing frontmatter delimiter")
    indices = [i for i in range(1, close) if lines[i].startswith("description:")]
    if len(indices) != 1:
        raise ValueError("Description adaptation requires exactly one top-level description")
    start = indices[0]
    end = start + 1
    while end < close and (lines[end].startswith((" ", "\t")) or not lines[end].strip()):
        end += 1
    newline = "\r\n" if lines[start].endswith("\r\n") else "\n"
    replacement = ("# Modified by Agentic Operator: shortened discovery description; original in references/UPSTREAM-SKILL.md." + newline
                   + "description: " + json.dumps(description, ensure_ascii=False) + newline)
    return ("".join(lines[:start]) + replacement + "".join(lines[end:])).encode("utf8")


def fetch(url, maximum=MAX_FILE):
    for attempt in range(3):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "agentic-operator-skill-catalog"})
            with urllib.request.urlopen(req, timeout=45) as response:
                data = response.read(maximum + 1)
            if len(data) > maximum:
                raise ValueError(f"Download exceeds byte limit: {url}")
            return data
        except (OSError, TimeoutError):
            if attempt == 2:
                raise
            time.sleep(attempt + 1)


def source_tree(source, revision=None):
    repo = source["repository"]
    if not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", repo):
        raise ValueError("Expected an explicit GitHub owner/repository")
    ref = revision or source["revision"]
    data = json.loads(fetch(f"https://api.github.com/repos/{repo}/git/trees/{ref}?recursive=1", 12 * 1024 * 1024))
    if data.get("truncated"):
        raise ValueError(f"GitHub returned a truncated inventory for {repo}")
    return data


def verified_blob(source, item):
    path = safe_path(item["path"])
    if item.get("mode") not in ("100644", "100755") or item["type"] != "blob":
        raise ValueError(f"Links and non-regular resources are not admitted: {path}")
    if item["size"] > MAX_FILE:
        raise ValueError(f"Resource exceeds file limit: {path}")
    url = f'https://raw.githubusercontent.com/{source["repository"]}/{source["revision"]}/{urllib.parse.quote(path)}'
    data = fetch(url)
    validate_blob_bytes(item, data)
    return data


def validate_blob_bytes(item, data):
    digest = hashlib.sha1(b"blob " + str(len(data)).encode() + b"\0" + data).hexdigest()
    if digest != item["sha"] or len(data) != item["size"]:
        raise ValueError(f"Git object integrity mismatch: {item['path']}")


def validate_review(source):
    if not re.fullmatch(r"[a-z][a-z0-9-]*", source["id"]):
        raise ValueError("Invalid source id")
    if not re.fullmatch(r"[a-f0-9]{40}", source["revision"]):
        raise ValueError("Every source must be pinned to a full commit")
    paths = set()
    for skill in source["skills"]:
        path = safe_path(skill["path"])
        if path in paths:
            raise ValueError("Duplicate reviewed skill path")
        paths.add(path)
        license_path = safe_path(skill["licensePath"])
        if not license_path.startswith(path + "/"):
            raise ValueError("The reviewed license must be included in the skill bundle")
        if skill["license"] not in ("Apache-2.0", "MIT"):
            raise ValueError("This downloader admits only reviewed Apache-2.0 and MIT bundles")
        if not re.fullmatch(r"[a-f0-9]{64}", skill["licenseSha256"]):
            raise ValueError("Pin the reviewed license bytes before downloading")


def validate_curation(root, config, catalog=None):
    """Require an explicit scope decision before a source can enter the library."""
    curation = json.loads((root / "curation.json").read_text())
    if curation.get("schemaVersion") != 1:
        raise ValueError("Unsupported skill curation manifest")
    retained, removed = curation.get("retained", []), curation.get("removed", [])
    all_entries = retained + removed
    if not retained or any(not entry.get("rationale") for entry in all_entries):
        raise ValueError("Every curation decision requires a rationale")
    if len({entry["id"] for entry in all_entries}) != len(all_entries):
        raise ValueError("Curation ids must be unique across retained and removed skills")
    retained_by_id = {entry["id"]: entry for entry in retained}
    selected = [dict(skill, sourceId=source["id"]) for source in config["sources"] for skill in source["skills"]]
    expected = {entry["id"] for entry in retained if entry["sourceId"] != "agentic"}
    if len(selected) != len(expected) or {entry["id"] for entry in selected} != expected:
        raise ValueError("Source selection must match retained curation; removed or unreviewed skills cannot be synced")
    for entry in selected:
        decision = retained_by_id[entry["id"]]
        if any(entry[key] != decision[key] for key in ("name", "sourceId")) or entry["path"] != decision["upstreamPath"]:
            raise ValueError(f"Source identity differs from retained curation: {entry['id']}")
    if catalog is not None:
        if len(catalog["skills"]) != len(retained_by_id) or {entry["id"] for entry in catalog["skills"]} != set(retained_by_id):
            raise ValueError("Catalog selection must match retained curation")
        for entry in catalog["skills"]:
            decision = retained_by_id[entry["id"]]
            if any(entry[key] != decision[key] for key in ("name", "sourceId", "upstreamPath")):
                raise ValueError(f"Catalog identity differs from retained curation: {entry['id']}")
    return curation


def cached_source_tree(source, cached, previous_catalog):
    """Allow offline pruning/refresh only from already verified unchanged pins."""
    previous = {entry["id"]: entry for entry in previous_catalog["skills"]}
    for skill in source["skills"]:
        entry = previous.get(skill["id"])
        url = f"https://github.com/{source['repository']}/tree/{source['revision']}/{skill['path']}"
        if not entry or entry["sourceId"] != source["id"] or entry["sourceUrl"] != url or entry["revision"] != source["revision"]:
            raise ValueError(f"Offline sync requires an already locked source and revision: {skill['id']}")
    prefix = f"upstream/{source['id']}/"
    items = [{"path": path[len(prefix):], "type": "blob", "mode": item["mode"],
        "size": item["bytes"], "sha": item["gitBlobSha"]}
        for path, item in cached.items() if path.startswith(prefix)]
    if not items:
        raise ValueError(f"No verified offline source files: {source['id']}")
    return {"tree": items}


def check_locked_tree(root, lock):
    """Verify the previous snapshot without requiring unchanged source pins."""
    expected = set()
    managed = lock.get("managedRoots", ["upstream"])
    if not managed or any(name not in MANAGED_ROOTS for name in managed):
        raise ValueError("Invalid managed source roots")
    expected_dirs = set(managed)
    for name in MANAGED_ROOTS:
        if (root / name).is_symlink():
            raise ValueError(f"Symlink in vendored source: {name}")
    for item in lock["files"]:
        relative = safe_path(item["path"])
        if not any(relative.startswith(name + "/") for name in managed) or relative in expected:
            raise ValueError(f"Invalid or duplicate locked source path: {relative}")
        expected.add(relative)
        file = root / relative
        within_root = [root.joinpath(*Path(relative).parts[:i]) for i in range(len(Path(relative).parts) + 1)]
        if any(p.is_symlink() for p in within_root):
            raise ValueError(f"Symlink in vendored source: {relative}")
        if not file.is_file() or sha256(file.read_bytes()) != item["sha256"]:
            raise ValueError(f"Missing or modified vendored file: {relative}")
        if "mode" in item and bool(file.stat().st_mode & 0o111) != (item["mode"] == "100755"):
            raise ValueError(f"Modified executable mode: {relative}")
        expected_dirs.update(p.as_posix() for p in Path(relative).parents if p.as_posix() != ".")
    actual = {p.relative_to(root).as_posix() for name in MANAGED_ROOTS for p in (root / name).rglob("*") if p.is_file() or p.is_symlink()}
    if actual != expected:
        raise ValueError(f"Untracked source files: {sorted(actual - expected)[:5]}")
    # Git does not retain empty directories. Declared managed roots may be absent
    # when their last bundle is pruned; nested untracked directories still fail.
    actual_dirs = set(managed) | {name for name in MANAGED_ROOTS if (root / name).is_dir()} | {
        p.relative_to(root).as_posix() for name in MANAGED_ROOTS for p in (root / name).rglob("*") if p.is_dir()}
    if actual_dirs != expected_dirs:
        raise ValueError(f"Untracked source directories: {sorted(actual_dirs - expected_dirs)[:5]}")
    return {item["path"]: item for item in lock["files"]}


def check(root):
    lock = json.loads((root / "sources.lock.json").read_text())
    expected = check_locked_tree(root, lock)
    if sha256((root / "sources.json").read_bytes()) != lock["sourceManifestSha256"]:
        raise ValueError("Source pins changed; run sync to fetch and validate the reviewed revision")
    catalog = json.loads((root / "catalog.json").read_text())
    config = json.loads((root / "sources.json").read_text())
    validate_curation(root, config, catalog)
    if sha256((root / "curation.json").read_bytes()) != lock.get("curationManifestSha256"):
        raise ValueError("Curation changed; run sync to validate the reviewed selection")
    # Local maintained entries are separately digest-bound during import.
    upstream_entries = [s for s in catalog["skills"] if s["sourceId"] != "agentic"]
    if sha256(json.dumps(upstream_entries, sort_keys=True).encode()) != lock["catalogSha256"]:
        raise ValueError("Source catalog metadata differs from its lock")
    return {"files": len(expected), "skills": len(upstream_entries), "bytes": sum(x["bytes"] for x in lock["files"])}


def sync(root, config, offline=False):
    manifest_bytes = (root / "sources.json").read_bytes()
    if json.loads(manifest_bytes) != config:
        raise ValueError("Source manifest changed after loading")
    curation_bytes = (root / "curation.json").read_bytes()
    source_ids = [source["id"] for source in config["sources"]]
    if len(source_ids) != len(set(source_ids)):
        raise ValueError("Source ids must be unique")
    validate_curation(root, config)
    previous_lock = None
    cached = {}
    if (root / "sources.lock.json").exists():
        previous_lock = json.loads((root / "sources.lock.json").read_text())
        cached = check_locked_tree(root, previous_lock)
    elif any((root / name).exists() or (root / name).is_symlink() for name in MANAGED_ROOTS):
        raise ValueError("Refusing to replace existing upstream content without a lock")
    catalog_bytes = (root / "catalog.json").read_bytes() if (root / "catalog.json").exists() else None
    old_catalog = json.loads(catalog_bytes) if catalog_bytes else {"skills": []}
    if offline:
        previous_upstream = [entry for entry in old_catalog["skills"] if entry["sourceId"] != "agentic"]
        if not previous_lock or sha256(json.dumps(previous_upstream, sort_keys=True).encode()) != previous_lock.get("catalogSha256"):
            raise ValueError("Offline sync requires the verified previous catalog provenance")
    root.mkdir(parents=True, exist_ok=True)
    stage = Path(tempfile.mkdtemp(prefix=".skill-download-", dir=root))
    for name in MANAGED_ROOTS:
        (stage / name).mkdir()
    preserve_stage = False
    records, catalog = [], []
    try:
        for source in config["sources"]:
            validate_review(source)
            tree = cached_source_tree(source, cached, old_catalog) if offline else source_tree(source)
            items = {x["path"]: x for x in tree["tree"]}
            def load_blob(item):
                path = safe_path(item["path"])
                if item.get("mode") not in ("100644", "100755") or item["type"] != "blob" or item["size"] > MAX_FILE:
                    raise ValueError(f"Unsupported or oversized resource: {path}")
                relative = f"upstream/{source['id']}/{path}"
                existing = cached.get(relative)
                if existing and existing["gitBlobSha"] == item["sha"] and existing["bytes"] == item["size"]:
                    data = (root / relative).read_bytes()
                    validate_blob_bytes(item, data)
                    return data
                if offline:
                    raise ValueError(f"Offline source resource is not locked: {path}")
                return verified_blob(source, item)
            # Check license bytes before fetching other resources.
            for skill in source["skills"]:
                license_bytes = load_blob(items[skill["licensePath"]])
                if sha256(license_bytes) != skill["licenseSha256"]:
                    raise ValueError(f"License changed; review required: {skill['path']}")
            selected = [x for x in items.values() if x["type"] != "tree" and any(x["path"].startswith(s["path"] + "/") for s in source["skills"])]
            # Retain repository-level notices without treating them as a blanket license.
            selected += [items[safe_path(p)] for p in source.get("noticePaths", [])]
            selected = list({x["path"]: x for x in selected}.values())
            if sum(x.get("size", 0) for x in selected) + sum(x["bytes"] for x in records) > MAX_DOWNLOAD:
                raise ValueError("Reviewed collection exceeds download limit")
            action = "Reusing verified files for" if offline else "Fetching"
            print(f"{action} {source['id']}: {len(source['skills'])} skills, {len(selected)} files", flush=True)
            def download(item):
                data = load_blob(item)
                relative = f"upstream/{source['id']}/{safe_path(item['path'])}"
                target = stage / relative
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(data)
                os.chmod(target, 0o755 if item["mode"] == "100755" else 0o644)
                return {"path": relative, "sha256": sha256(data), "gitBlobSha": item["sha"], "bytes": len(data), "mode": item["mode"]}
            with concurrent.futures.ThreadPoolExecutor(max_workers=10) as pool:
                records.extend(pool.map(download, selected))
            for skill in source["skills"]:
                path = skill["path"]
                if path + "/SKILL.md" not in items:
                    raise ValueError(f"Reviewed bundle has no SKILL.md: {path}")
                selected_path = f"upstream/{source['id']}/{path}"
                adaptation = None
                if "descriptionOverride" in skill:
                    selected_path = f"adapted/{source['id']}/{Path(path).name}"
                    destination = stage / selected_path
                    shutil.copytree(stage / f"upstream/{source['id']}/{path}", destination)
                    entrypoint = destination / "SKILL.md"
                    original = entrypoint.read_bytes()
                    archived = destination / "references/UPSTREAM-SKILL.md"
                    if archived.exists():
                        raise ValueError(f"Adaptation would overwrite an upstream resource: {archived}")
                    archived.parent.mkdir(parents=True, exist_ok=True)
                    archived.write_bytes(original)
                    os.chmod(archived, 0o644)
                    entrypoint.write_bytes(override_description(original, skill["descriptionOverride"]))
                    adaptation = "Reviewed description shortened to the portable 1024-character limit; complete original SKILL.md retained in references/UPSTREAM-SKILL.md."
                    for file in sorted(destination.rglob("*")):
                        if file.is_file():
                            data = file.read_bytes()
                            records.append({"path": file.relative_to(stage).as_posix(), "sha256": sha256(data),
                                "bytes": len(data), "mode": "100755" if file.stat().st_mode & 0o111 else "100644", "generated": True})
                entry = {"id": skill["id"], "sourceId": source["id"], "upstreamPath": path,
                    "path": selected_path, "upstreamName": skill["upstreamName"],
                    "name": skill["name"], "sourceUrl": f"https://github.com/{source['repository']}/tree/{source['revision']}/{path}",
                    "revision": source["revision"], "license": skill["license"], "sourceDigest": bundle_digest(stage / selected_path)}
                if adaptation:
                    entry["adaptation"] = adaptation
                catalog.append(entry)
        catalog.sort(key=lambda s: s["id"])
        if sum(item["bytes"] for item in records) > MAX_DOWNLOAD:
            raise ValueError("Reviewed collection and adaptations exceed byte limit")
        lock = {"schemaVersion": 1, "managedRoots": list(MANAGED_ROOTS), "sourceManifestSha256": sha256(manifest_bytes),
                "curationManifestSha256": sha256(curation_bytes),
                "catalogSha256": sha256(json.dumps(catalog, sort_keys=True).encode()),
                "files": sorted(records, key=lambda x: x["path"])}
        catalog.extend(s for s in old_catalog["skills"] if s["sourceId"] == "agentic")
        if any(len({s[key] for s in catalog}) != len(catalog) for key in ("name", "id")):
            raise ValueError("Catalog ids and names must be unique, including maintained skills")
        for filename, data in [("catalog.json", {"schemaVersion": 1, "skills": catalog}), ("sources.lock.json", lock)]:
            temp = stage / filename
            temp.write_text(json.dumps(data, indent=2) + "\n")
        (stage / "sources.json").write_bytes(manifest_bytes)
        (stage / "curation.json").write_bytes(curation_bytes)
        check(stage)
        # Recheck inputs immediately before publishing; downloads may take time.
        if (root / "sources.json").read_bytes() != manifest_bytes:
            raise ValueError("Source manifest changed during sync")
        if (root / "curation.json").read_bytes() != curation_bytes:
            raise ValueError("Curation changed during sync")
        current_catalog = (root / "catalog.json").read_bytes() if (root / "catalog.json").exists() else None
        if current_catalog != catalog_bytes:
            raise ValueError("Catalog changed during sync")
        if previous_lock is not None:
            if json.loads((root / "sources.lock.json").read_text()) != previous_lock:
                raise ValueError("Source lock changed during sync")
            check_locked_tree(root, previous_lock)
        elif any((root / name).exists() or (root / name).is_symlink() for name in MANAGED_ROOTS) or (root / "sources.lock.json").exists():
            raise ValueError("Source collection appeared during sync")
        backup = stage / "previous-state"
        backup.mkdir()
        backed_up, installed = [], []
        try:
            for name in (*MANAGED_ROOTS, "catalog.json", "sources.lock.json"):
                target = root / name
                if target.exists() or target.is_symlink():
                    target.rename(backup / name)
                    backed_up.append(name)
            for name in (*MANAGED_ROOTS, "catalog.json", "sources.lock.json"):
                (stage / name).rename(root / name)
                installed.append(name)
            result = check(root)
        except BaseException:
            try:
                for name in reversed(installed):
                    target = root / name
                    if target.is_dir() and not target.is_symlink():
                        shutil.rmtree(target)
                    else:
                        target.unlink()
                for name in reversed(backed_up):
                    (backup / name).rename(root / name)
            except BaseException as rollback_error:
                preserve_stage = True
                raise RuntimeError(f"Rollback failed; recovery files retained in {stage}") from rollback_error
            raise
        print(json.dumps(result), flush=True)
    finally:
        if not preserve_stage:
            shutil.rmtree(stage)


def discover(config):
    excluded = {(entry["sourceId"], entry["path"]): entry["reason"] for entry in config.get("excluded", [])}
    for source in config["sources"] + config.get("watchSources", []):
        tree = source_tree(source, "HEAD")
        known = {s["path"] for s in source.get("skills", [])}
        paths = sorted(x["path"][:-9] for x in tree["tree"] if x["path"].endswith("/SKILL.md"))
        print(json.dumps({"source": source["id"], "repository": source["repository"],
            "revision": tree["sha"], "skillCount": len(paths),
            "unselected": [p for p in paths if p not in known and (source["id"], p) not in excluded],
            "excluded": [{"path": p, "reason": excluded[(source["id"], p)]} for p in paths if (source["id"], p) in excluded]}))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--check", action="store_true", help="Verify the local collection offline")
    mode.add_argument("--discover", action="store_true", help="Report current official inventories without changing the collection")
    mode.add_argument("--offline", action="store_true", help="Sync only already-locked source pins without network access; supports reviewed pruning")
    args = parser.parse_args()
    config = json.loads((ROOT / "sources.json").read_text())
    if args.check:
        print(json.dumps(check(ROOT)))
    elif args.discover:
        discover(config)
    else:
        sync(ROOT, config, offline=args.offline)
