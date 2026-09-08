/** Refresh the collection's first-party Creator snapshot without touching DB state. */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  decodeSkillFile,
  loadSkillCreatorPolicy,
  readSkillBundleFromDirectory,
  skillBundleDigest,
} from "@agentic/skills";
import { readSkillCatalog } from "../src/services/skill-catalog-import";

const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const library = resolve(repositoryRoot, "skills-library");
const catalogFile = resolve(library, "catalog.json");
const { catalog } = readSkillCatalog(catalogFile);
const policy = loadSkillCreatorPolicy();
const localPath = "local/skill-creator";
const destination = resolve(library, localPath);
const previous = catalog.skills.find(
  (entry) => entry.id === "agentic/skill-creator",
);
if (existsSync(destination)) {
  const existingDigest = skillBundleDigest(
    readSkillBundleFromDirectory(destination),
  );
  if (!previous?.sourceDigest || existingDigest !== previous.sourceDigest)
    throw new Error(
      "The local Creator snapshot has changes; preserve them before refreshing it.",
    );
  if (existingDigest === policy.contentDigest) {
    process.stdout.write(
      `Creator snapshot is current: ${policy.contentDigest}\n`,
    );
    process.exit(0);
  }
}
const staging = resolve(library, ".skill-download-creator");
if (existsSync(staging))
  throw new Error(
    "A prior Creator snapshot operation needs inspection before retrying.",
  );
mkdirSync(resolve(staging, "skill-creator"), { recursive: true });
const previousCatalog = readFileSync(catalogFile);
let swapped = false;
let catalogWritten = false;
let rollbackFailed = false;
try {
  for (const file of policy.bundle.files) {
    const target = resolve(staging, "skill-creator", file.path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, decodeSkillFile(file));
  }
  const entry = {
    id: "agentic/skill-creator",
    sourceId: "agentic",
    upstreamPath: "packages/skills/builtin/skill-creator",
    path: localPath,
    upstreamName: "skill-creator",
    name: "agentic-skill-creator",
    sourceUrl:
      "https://github.com/kenny9911/agentic-operator/tree/main/packages/skills/builtin/skill-creator",
    revision: "workspace",
    license: "Project-maintained policy; see bundled authoring sources",
    sourceDigest: policy.contentDigest,
  };
  catalog.skills = [
    ...catalog.skills.filter((item) => item.id !== entry.id),
    entry,
  ];
  mkdirSync(dirname(destination), { recursive: true });
  if (existsSync(destination))
    renameSync(destination, resolve(staging, "previous"));
  renameSync(resolve(staging, "skill-creator"), destination);
  swapped = true;
  const pendingCatalog = resolve(staging, "catalog.json");
  writeFileSync(pendingCatalog, `${JSON.stringify(catalog, null, 2)}\n`);
  if (!readFileSync(catalogFile).equals(previousCatalog))
    throw new Error(
      "Catalog changed during the snapshot; retry against the current catalog.",
    );
  renameSync(pendingCatalog, catalogFile);
  catalogWritten = true;
  process.stdout.write(`Creator snapshot refreshed: ${policy.contentDigest}\n`);
} catch (error) {
  try {
    if (swapped) rmSync(destination, { recursive: true, force: true });
    if (existsSync(resolve(staging, "previous")))
      renameSync(resolve(staging, "previous"), destination);
    if (catalogWritten) writeFileSync(catalogFile, previousCatalog);
  } catch (rollbackError) {
    rollbackFailed = true;
    throw new AggregateError(
      [error, rollbackError],
      `Snapshot rollback failed; recover the previous snapshot from ${staging}`,
    );
  }
  throw error;
} finally {
  if (!rollbackFailed) rmSync(staging, { recursive: true, force: true });
}
