import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const values = new Map();
let check = false;
for (let i = 2; i < process.argv.length; i++) {
  const argument = process.argv[i];
  if (argument === "--check") { check = true; continue; }
  if (!["--node-image", "--python-version", "--tag"].includes(argument) || values.has(argument) || !process.argv[i + 1]) throw new Error("Use --node-image DIGEST --python-version EXACT_DEBIAN_VERSION [--tag TAG] [--check]");
  values.set(argument, process.argv[++i]);
}
const nodeImage = values.get("--node-image") ?? "";
const pythonVersion = values.get("--python-version") ?? "";
const tag = values.get("--tag") ?? "agentic-skill-runner:local";
if (!/^(?:[a-z0-9][a-z0-9._/:-]*@)?sha256:[a-f0-9]{64}$/.test(nodeImage)) throw new Error("The reviewed Node base must be an exact SHA-256 image identity");
if (!/^[0-9][A-Za-z0-9.+:~_-]{0,99}$/.test(pythonVersion)) throw new Error("Choose an exact Debian python3 package version");
if (!/^[a-z0-9][a-z0-9._/:-]{0,199}$/.test(tag)) throw new Error("Invalid local image tag");
if (check) {
  process.stdout.write("Build arguments are valid; no Docker command was run.\n");
} else {
  const root = resolve(import.meta.dirname, "../..");
  const built = spawnSync("docker", ["build", "--file", resolve(import.meta.dirname, "Dockerfile"), "--build-arg", `NODE_IMAGE=${nodeImage}`, "--build-arg", `PYTHON_DEBIAN_VERSION=${pythonVersion}`, "--tag", tag, root], { stdio: "inherit" });
  if (built.status !== 0) throw new Error("Skill runner image build failed");
  const inspected = spawnSync("docker", ["image", "inspect", "--format", "{{.Id}}", tag], { encoding: "utf8", timeout: 10_000 });
  const imageId = inspected.stdout?.trim();
  if (inspected.status !== 0 || !/^sha256:[a-f0-9]{64}$/.test(imageId)) throw new Error("Built image has no immutable image identity");
  process.stdout.write(`Built image: ${imageId}\nReview and explicitly approve this identity before enabling Skill script execution.\n`);
}
