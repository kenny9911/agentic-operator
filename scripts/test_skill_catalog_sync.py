"""Offline integrity and data-preservation checks for the skill catalog sync."""
import contextlib
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location("skill_catalog_sync", Path(__file__).with_name("sync-skill-catalog.py"))
SYNC = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(SYNC)


class CatalogSyncTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name).resolve() / "library"
        self.root.mkdir()
        self.contents = {
            "skills/example/LICENSE.txt": b"Apache License\nVersion 2.0\n",
            "skills/example/SKILL.md": b"---\nname: example\ndescription: Example use\n---\nRead scripts/run.py.\n",
            "skills/example/scripts/run.py": b"print('example')\n",
        }
        self.source = {"id": "official", "repository": "example/skills", "revision": "a" * 40, "skills": [{
            "id": "official-example", "name": "official-example", "upstreamName": "example", "path": "skills/example",
            "license": "Apache-2.0", "licensePath": "skills/example/LICENSE.txt",
            "licenseSha256": SYNC.sha256(self.contents["skills/example/LICENSE.txt"]),
        }]}
        self.config = {"sources": [self.source]}
        self.curation = {"schemaVersion": 1, "retained": [{"id": "official-example", "name": "official-example",
            "sourceId": "official", "upstreamPath": "skills/example", "rationale": "Business workflow fixture"}], "removed": []}
        self.save_curation()
        self.save_manifest()
        self.downloaded = []

    def save_manifest(self):
        (self.root / "sources.json").write_text(json.dumps(self.config))

    def save_curation(self):
        (self.root / "curation.json").write_text(json.dumps(self.curation))

    def tree(self, _source):
        return {"tree": [{
            "path": name, "type": "blob", "size": len(data),
            "mode": "100755" if name.endswith("run.py") else "100644",
            "sha": hashlib.sha1(b"blob " + str(len(data)).encode() + b"\0" + data).hexdigest(),
        } for name, data in self.contents.items()]}

    def blob(self, _source, item):
        self.downloaded.append(item["path"])
        data = self.contents[item["path"]]
        SYNC.validate_blob_bytes(item, data)
        return data

    def sync(self):
        with patch.object(SYNC, "source_tree", self.tree), patch.object(SYNC, "verified_blob", self.blob), contextlib.redirect_stdout(io.StringIO()):
            SYNC.sync(self.root, self.config)

    def snapshot(self):
        return {path.relative_to(self.root).as_posix(): path.read_bytes() for path in self.root.rglob("*") if path.is_file()}

    def test_complete_bundle_and_executable_mode_are_verified_offline(self):
        self.sync()
        self.assertEqual(SYNC.check(self.root)["files"], 3)
        script = self.root / "upstream/official/skills/example/scripts/run.py"
        self.assertTrue(script.stat().st_mode & 0o111)
        os.chmod(script, 0o644)
        with self.assertRaisesRegex(ValueError, "executable mode"):
            SYNC.check(self.root)

    def test_empty_managed_root_may_be_absent_in_a_fresh_git_checkout(self):
        self.sync()
        (self.root / "adapted").rmdir()
        self.assertEqual(SYNC.check(self.root)["skills"], 1)

    def test_unchanged_blobs_are_reused_without_network_downloads(self):
        self.sync()
        self.downloaded.clear()
        self.sync()
        self.assertEqual(self.downloaded, [])
        self.assertEqual(SYNC.check(self.root)["skills"], 1)

    def test_offline_sync_reuses_verified_pins_and_never_fetches(self):
        self.sync()
        with patch.object(SYNC, "source_tree", side_effect=AssertionError("Network is forbidden")), \
                patch.object(SYNC, "verified_blob", side_effect=AssertionError("Download is forbidden")), \
                contextlib.redirect_stdout(io.StringIO()):
            SYNC.sync(self.root, self.config, offline=True)
        self.assertEqual(SYNC.check(self.root)["skills"], 1)

    def test_offline_sync_refuses_a_new_pin_and_preserves_existing_bundle(self):
        self.sync()
        old_bundle = (self.root / "upstream/official/skills/example/SKILL.md").read_bytes()
        self.source["revision"] = "b" * 40
        self.save_manifest()
        with self.assertRaisesRegex(ValueError, "already locked source and revision"):
            SYNC.sync(self.root, self.config, offline=True)
        self.assertEqual((self.root / "upstream/official/skills/example/SKILL.md").read_bytes(), old_bundle)

    def test_offline_sync_rejects_edited_catalog_provenance(self):
        self.sync()
        self.source["revision"] = "b" * 40
        self.save_manifest()
        catalog_path = self.root / "catalog.json"
        catalog = json.loads(catalog_path.read_text())
        catalog["skills"][0]["revision"] = "b" * 40
        catalog["skills"][0]["sourceUrl"] = f"https://github.com/example/skills/tree/{'b' * 40}/skills/example"
        catalog_path.write_text(json.dumps(catalog))
        before = self.snapshot()
        with self.assertRaisesRegex(ValueError, "verified previous catalog provenance"):
            SYNC.sync(self.root, self.config, offline=True)
        self.assertEqual(self.snapshot(), before)

    def test_untracked_files_and_empty_directories_are_preserved(self):
        self.sync()
        for relative, directory in [("user-notes.txt", False), ("user-work", True)]:
            with self.subTest(relative=relative):
                target = self.root / "upstream" / relative
                target.mkdir() if directory else target.write_text("Do not erase")
                self.downloaded.clear()
                with self.assertRaisesRegex(ValueError, "Untracked source"):
                    self.sync()
                self.assertTrue(target.exists())
                self.assertEqual(self.downloaded, [])
                target.rmdir() if directory else target.unlink()

    def test_modified_resources_are_preserved(self):
        self.sync()
        target = self.root / "upstream/official/skills/example/SKILL.md"
        target.write_text("Local work")
        with self.assertRaisesRegex(ValueError, "modified vendored file"):
            self.sync()
        self.assertEqual(target.read_text(), "Local work")

    def test_parent_symlink_is_rejected_even_when_bytes_match(self):
        self.sync()
        upstream = self.root / "upstream"
        external = self.root.parent / "external-source"
        upstream.rename(external)
        upstream.symlink_to(external, target_is_directory=True)
        with self.assertRaisesRegex(ValueError, "Symlink"):
            self.sync()
        self.assertTrue((external / "official/skills/example/SKILL.md").is_file())

    def test_collection_without_lock_is_not_overwritten(self):
        upstream = self.root / "upstream"
        upstream.mkdir()
        (upstream / "personal.txt").write_text("Keep this")
        with self.assertRaisesRegex(ValueError, "without a lock"):
            self.sync()
        self.assertEqual((upstream / "personal.txt").read_text(), "Keep this")

    def test_metadata_install_failure_restores_entire_previous_snapshot(self):
        self.sync()
        before = self.snapshot()
        original_rename = Path.rename

        def fail_lock_install(path, target):
            if path.parent.name.startswith(".skill-download-") and path.name == "sources.lock.json":
                raise OSError("Simulated disk failure while installing lock")
            return original_rename(path, target)

        with patch.object(Path, "rename", fail_lock_install), self.assertRaisesRegex(OSError, "Simulated disk failure"):
            self.sync()
        self.assertEqual(self.snapshot(), before)
        self.assertEqual(SYNC.check(self.root)["skills"], 1)
        self.assertFalse(list(self.root.glob(".skill-download-*")))

    def test_missing_declared_notice_aborts_before_publication(self):
        self.source["noticePaths"] = ["THIRD_PARTY_NOTICES.md"]
        self.save_manifest()
        with self.assertRaises(KeyError):
            self.sync()
        self.assertFalse((self.root / "upstream").exists())

    def test_changed_license_aborts_before_other_resources_are_fetched(self):
        self.contents["skills/example/LICENSE.txt"] = b"Changed upstream terms"
        with self.assertRaisesRegex(ValueError, "License changed"):
            self.sync()
        self.assertEqual(self.downloaded, ["skills/example/LICENSE.txt"])
        self.assertFalse((self.root / "upstream").exists())

    def test_manifest_mutation_during_download_cannot_mislabel_snapshot(self):
        original_blob = self.blob

        def mutate_manifest(source, item):
            data = original_blob(source, item)
            (self.root / "sources.json").write_text('{"sources": []}')
            return data

        with patch.object(self, "blob", mutate_manifest), self.assertRaisesRegex(ValueError, "manifest changed during sync"):
            self.sync()
        self.assertFalse((self.root / "upstream").exists())

    def test_removed_skill_cannot_be_reintroduced_by_source_selection(self):
        removed = dict(self.source["skills"][0], id="official-deploy", name="official-deploy", path="skills/deploy")
        self.curation["removed"] = [{"id": "official-deploy", "name": "official-deploy", "sourceId": "official",
            "upstreamPath": "skills/deploy", "rationale": "Deployment-time tooling is excluded"}]
        self.save_curation()
        self.source["skills"].append(removed)
        self.save_manifest()
        with patch.object(SYNC, "source_tree", side_effect=AssertionError("No network expected")):
            with self.assertRaisesRegex(ValueError, "removed or unreviewed"):
                self.sync()
        self.assertFalse((self.root / "upstream").exists())

    def test_curation_identity_cannot_redirect_a_retained_id(self):
        self.source["skills"][0]["path"] = "skills/deploy"
        self.save_manifest()
        with self.assertRaisesRegex(ValueError, "identity differs"):
            self.sync()

    def test_duplicate_retained_entries_are_rejected(self):
        self.sync()
        catalog = json.loads((self.root / "catalog.json").read_text())
        catalog["skills"].append(dict(catalog["skills"][0]))
        with self.assertRaisesRegex(ValueError, "Catalog selection"):
            SYNC.validate_curation(self.root, self.config, catalog)
        self.source["skills"].append(dict(self.source["skills"][0]))
        self.save_manifest()
        with self.assertRaisesRegex(ValueError, "Source selection"):
            self.sync()

    def test_curation_mutation_during_sync_preserves_the_previous_snapshot(self):
        self.sync()
        before = (self.root / "catalog.json").read_bytes()
        original_tree = self.tree

        def mutate_curation(source):
            self.curation["retained"][0]["rationale"] = "Changed during sync"
            self.save_curation()
            return original_tree(source)

        with patch.object(self, "tree", mutate_curation), self.assertRaisesRegex(ValueError, "Curation changed during sync"):
            self.sync()
        self.assertEqual((self.root / "catalog.json").read_bytes(), before)

    def test_reviewed_prune_preserves_authored_skills_outside_managed_roots(self):
        for path, content in list(self.contents.items()):
            self.contents[path.replace("skills/example/", "skills/retired/")] = content
        retired = dict(self.source["skills"][0], id="official-retired", name="official-retired",
            path="skills/retired", licensePath="skills/retired/LICENSE.txt")
        self.source["skills"].append(retired)
        decision = {"id": "official-retired", "name": "official-retired", "sourceId": "official",
            "upstreamPath": "skills/retired", "rationale": "Previously selected development fixture"}
        self.curation["retained"].append(decision)
        self.save_manifest()
        self.save_curation()
        self.sync()
        authored = self.root / "local/customer-ontology/SKILL.md"
        authored.parent.mkdir(parents=True)
        authored.write_text("Business ontology instructions owned by the project")
        self.source["skills"].pop()
        self.curation["retained"].pop()
        self.curation["removed"].append(decision)
        self.save_manifest()
        self.save_curation()
        self.sync()
        self.assertFalse((self.root / "upstream/official/skills/retired").exists())
        self.assertTrue((self.root / "upstream/official/skills/example/SKILL.md").is_file())
        self.assertEqual(authored.read_text(), "Business ontology instructions owned by the project")

    def test_maintained_skill_id_collision_preserves_previous_catalog(self):
        maintained = {"sourceId": "agentic", "id": "official-example", "name": "maintained-example"}
        (self.root / "catalog.json").write_text(json.dumps({"skills": [maintained]}))
        before = self.snapshot()
        with self.assertRaisesRegex(ValueError, "ids and names must be unique"):
            self.sync()
        self.assertEqual(self.snapshot(), before)

    def test_source_ids_cannot_overwrite_one_anothers_directories(self):
        self.config["sources"].append(dict(self.source))
        self.save_manifest()
        with self.assertRaisesRegex(ValueError, "Source ids must be unique"):
            self.sync()

    def test_description_adaptation_preserves_original_bundle_and_locks_both(self):
        original = b"---\nname: example\ndescription: |-\n  Long original description.\n  More original description.\nlicense: Apache-2.0\n---\nKeep every body byte.\n"
        self.contents["skills/example/SKILL.md"] = original
        self.source["skills"][0]["descriptionOverride"] = "Short reviewed scope."
        self.save_manifest()
        self.sync()
        raw = self.root / "upstream/official/skills/example"
        adapted = self.root / "adapted/official/example"
        self.assertEqual((raw / "SKILL.md").read_bytes(), original)
        self.assertEqual((adapted / "references/UPSTREAM-SKILL.md").read_bytes(), original)
        expected = b'---\nname: example\ndescription: "Short reviewed scope."\nlicense: Apache-2.0\n---\nKeep every body byte.\n'
        adapted_bytes = (adapted / "SKILL.md").read_bytes()
        self.assertIn(b"# Modified by Agentic Operator:", adapted_bytes)
        self.assertEqual(b"\n".join(line for line in adapted_bytes.split(b"\n") if not line.startswith(b"# Modified by Agentic Operator:")), expected)
        self.assertEqual((adapted / "scripts/run.py").read_bytes(), (raw / "scripts/run.py").read_bytes())
        catalog = json.loads((self.root / "catalog.json").read_text())["skills"][0]
        self.assertEqual(catalog["path"], "adapted/official/example")
        self.assertEqual(catalog["sourceDigest"], SYNC.bundle_digest(adapted))
        self.assertNotEqual(catalog["sourceDigest"], SYNC.bundle_digest(raw))
        self.assertIn("adaptation", catalog)
        self.assertEqual(SYNC.check(self.root)["files"], 7)
        self.sync()
        (adapted / "references/UPSTREAM-SKILL.md").write_text("Local change")
        with self.assertRaisesRegex(ValueError, "modified vendored file"):
            self.sync()

    def test_adaptation_cannot_overwrite_existing_reference(self):
        self.contents["skills/example/references/UPSTREAM-SKILL.md"] = b"Real upstream content"
        self.source["skills"][0]["descriptionOverride"] = "Short scope."
        self.save_manifest()
        with self.assertRaisesRegex(ValueError, "overwrite an upstream resource"):
            self.sync()
        self.assertFalse((self.root / "upstream").exists())

    def test_description_override_preserves_crlf_and_rejects_oversized_values(self):
        original = b"---\r\nname: example\r\ndescription: old\r\n---\r\nBody\r\n"
        adapted = SYNC.override_description(original, "Reviewed")
        self.assertIn(b"# Modified by Agentic Operator:", adapted)
        without_notice = b"\r\n".join(line for line in adapted.split(b"\r\n") if not line.startswith(b"# Modified by Agentic Operator:"))
        self.assertEqual(without_notice, original.replace(b"description: old", b'description: "Reviewed"'))
        with self.assertRaisesRegex(ValueError, "1024"):
            SYNC.override_description(original, "x" * 1025)

    def test_digest_matches_typescript_framing_and_utf16_path_order(self):
        bundle = self.root / "digest-fixture"
        (bundle / "assets").mkdir(parents=True)
        (bundle / "SKILL.md").write_bytes(b"abc")
        (bundle / "assets/\U00010000").write_bytes(bytes([0, 255, 7]))
        (bundle / "assets/\ue000").write_bytes(b"xyz")
        # Generated independently with the exact Node digestFiles implementation.
        self.assertEqual(SYNC.bundle_digest(bundle), "a8068b4604c64a5ad0a0d86f9124072a7b7bfcc2b2568087a71410873904b293")


if __name__ == "__main__":
    unittest.main()
