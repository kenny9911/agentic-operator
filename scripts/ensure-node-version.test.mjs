import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const scriptsDirectory = path.dirname(fileURLToPath(import.meta.url));
const requiredVersion = readFileSync(
  path.join(scriptsDirectory, "../.nvmrc"),
  "utf8",
).trim().replace(/^v/, "");
const [major, minor, patch] = requiredVersion.split(".").map(Number);

function checkRuntime(t, { runtime = requiredVersion, pin = requiredVersion, engine = requiredVersion } = {}) {
  const directory = mkdtempSync(path.join(tmpdir(), "ensure-node-test-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const scripts = path.join(directory, "scripts");
  mkdirSync(scripts);
  const guard = path.join(scripts, "ensure-node-version.mjs");
  copyFileSync(path.join(scriptsDirectory, "ensure-node-version.mjs"), guard);
  writeFileSync(path.join(directory, ".nvmrc"), `${pin}\n`);
  writeFileSync(path.join(directory, "package.json"), JSON.stringify({ engines: { node: engine } }));
  const preload = path.join(directory, "runtime.cjs");
  writeFileSync(preload, [
    `Object.defineProperty(process.versions, "node", { value: ${JSON.stringify(runtime)} });`,
    `Object.defineProperty(process, "version", { value: ${JSON.stringify(`v${runtime}`)} });`,
  ].join("\n"));
  const result = spawnSync(process.execPath, ["--require", preload, guard], {
    cwd: tmpdir(), // The guard must resolve its own repository, not the caller's cwd.
    encoding: "utf8",
    timeout: 10_000,
  });
  assert.ifError(result.error);
  return result;
}

test("Node guard accepts exactly the repository runtime from another cwd", (t) => {
  const result = checkRuntime(t);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /matches the repository pin/);
});

test("Node guard rejects another patch of the required major", (t) => {
  const result = checkRuntime(t, { runtime: `${major}.${minor}.${patch + 1}` });
  assert.equal(result.status, 1);
  assert(result.stderr.includes(`Node ${requiredVersion} is required`));
});

test("Node guard rejects another major", (t) => {
  const result = checkRuntime(t, { runtime: `${major + 1}.0.0` });
  assert.equal(result.status, 1);
  assert(result.stderr.includes(`Node ${requiredVersion} is required`));
});

test("Node guard rejects disagreement between the nvm and package pins", (t) => {
  const result = checkRuntime(t, { engine: `${major}.${minor}.${patch + 1}` });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /version pins disagree/);
});

test("Node guard rejects a non-exact nvm pin", (t) => {
  const result = checkRuntime(t, { pin: String(major) });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /invalid exact Node version/);
});
