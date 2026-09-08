"use strict";

// Fixed image supervisor. Uploaded files are data during staging; only run
// mode invokes the requested script, after the host mounts its volume read-only.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");

const MAX_BUNDLE = 20 * 1024 * 1024;
const MAX_FILE = 5 * 1024 * 1024;
const MAX_PROTOCOL = 29 * 1024 * 1024;
const INTERPRETERS = Object.freeze({ node: "/usr/local/bin/node", python: "/usr/bin/python3" });

function safePath(value) {
  if (typeof value !== "string" || !value || Buffer.byteLength(value) > 240 || value !== value.normalize("NFC") || /[\\\u0000-\u001f\u007f-\u009f:*?"<>|]/u.test(value)) throw new Error("Unsafe portable path");
  if (Buffer.from(value).toString("utf8") !== value) throw new Error("Invalid path Unicode");
  const parts = value.split("/");
  if (parts.length > 16 || parts.some((part) => !part || part === "." || part === ".." || part.trim() !== part || part.endsWith(".") || /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/iu.test(part))) throw new Error("Unsafe portable path");
  return value;
}

function decode64(value, maximum) {
  if (typeof value !== "string" || value.length > 4 * Math.ceil(maximum / 3)) throw new Error("Input size limit");
  const bytes = Buffer.from(value, "base64");
  if (bytes.length > maximum || bytes.toString("base64") !== value) throw new Error("Invalid base64 input");
  return bytes;
}

function bundleDigest(files) {
  const hash = crypto.createHash("sha256").update("agentic-skill-bundle-v1\0");
  for (const file of [...files].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)) {
    const name = Buffer.from(file.path);
    const sizes = Buffer.alloc(8);
    sizes.writeUInt32BE(name.length, 0); sizes.writeUInt32BE(file.bytes.length, 4);
    hash.update(sizes).update(name).update(file.bytes);
  }
  return hash.digest("hex");
}

function stage(payload) {
  if (payload.schema !== "agentic-skill-stage/v1" || !Array.isArray(payload.files) || payload.files.length < 1 || payload.files.length > 200) throw new Error("Invalid stage protocol");
  let total = 0;
  const paths = new Set();
  const files = payload.files.map((file) => {
    safePath(file.path);
    const key = file.path.toUpperCase().toLowerCase();
    if (paths.has(key)) throw new Error("Duplicate portable path");
    paths.add(key);
    const bytes = decode64(file.content, file.path === "SKILL.md" ? 256 * 1024 : MAX_FILE);
    total += bytes.length;
    if (total > MAX_BUNDLE) throw new Error("Bundle size limit");
    return { path: file.path, bytes };
  });
  if (!files.some((file) => file.path === "SKILL.md") || bundleDigest(files) !== payload.contentDigest) throw new Error("Bundle integrity mismatch");
  if (fs.readdirSync("/skill").length) throw new Error("Staging volume is not empty");
  const directories = new Set(["/skill"]);
  for (const file of files) {
    const target = path.join("/skill", file.path);
    const parts = file.path.split("/").slice(0, -1);
    let parent = "/skill";
    for (const part of parts) {
      parent = path.join(parent, part);
      if (!directories.has(parent)) { fs.mkdirSync(parent, { mode: 0o700 }); directories.add(parent); }
    }
    fs.writeFileSync(target, file.bytes, { flag: "wx", mode: 0o400 });
    fs.chmodSync(target, 0o444);
  }
  for (const directory of [...directories].sort((a, b) => b.length - a.length)) fs.chmodSync(directory, 0o555);
  return { schema: "agentic-skill-stage-result/v1", ok: true, contentDigest: payload.contentDigest };
}

function integer(value, minimum, maximum) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new Error("Invalid runner limit");
  return value;
}

function runPayload(payload) {
  if (payload.schema !== "agentic-skill-run/v1" || !Object.hasOwn(INTERPRETERS, payload.interpreter)) throw new Error("Invalid execution protocol");
  safePath(payload.scriptPath);
  if (!payload.scriptPath.startsWith("scripts/")) throw new Error("Execute a bundled scripts/ path");
  const configured = payload.limits;
  if (!configured || typeof configured !== "object") throw new Error("Missing execution limits");
  const limits = {
    timeoutMs: integer(configured.timeoutMs, 1, 300_000),
    inputBytes: integer(configured.inputBytes, 1, 1024 * 1024),
    outputBytes: integer(configured.outputBytes, 1, 4 * 1024 * 1024),
    argumentBytes: integer(configured.argumentBytes, 1, 64 * 1024),
    argumentCount: integer(configured.argumentCount, 1, 128),
    artifactBytes: integer(configured.artifactBytes, 1, 32 * 1024 * 1024),
    artifactFileBytes: integer(configured.artifactFileBytes, 1, 10 * 1024 * 1024),
    artifactCount: integer(configured.artifactCount, 1, 128),
    artifactDepth: integer(configured.artifactDepth, 1, 16),
  };
  if (!Array.isArray(payload.args) || payload.args.length > limits.argumentCount || payload.args.some((arg) => typeof arg !== "string" || arg.includes("\0")) || Buffer.byteLength(payload.args.join("\0")) > limits.argumentBytes) throw new Error("Invalid script arguments");
  const stdin = decode64(payload.stdin, limits.inputBytes);
  const script = path.join("/skill", payload.scriptPath);
  if (fs.realpathSync(script) !== script || !fs.lstatSync(script).isFile()) throw new Error("Script is outside the staged bundle");
  return { script, interpreter: INTERPRETERS[payload.interpreter], args: payload.args, stdin, limits };
}

function artifactFiles(root, limits) {
  const files = [];
  const names = new Set();
  let bytes = 0;
  let entries = 0;
  function checkDirectory(directory, expected) {
    const stat = fs.lstatSync(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink() || fs.realpathSync(directory) !== directory || (expected && (stat.dev !== expected.dev || stat.ino !== expected.ino))) throw new Error("Changed artifact directory");
    return stat;
  }
  function walk(directory, prefix, parents) {
    const anchor = checkDirectory(directory);
    const chain = [...parents, { path: directory, stat: anchor }];
    const stream = fs.opendirSync(directory);
    try {
      for (let entry = stream.readSync(); entry; entry = stream.readSync()) {
        if (++entries > limits.artifactCount * 4 + 64) throw new Error("Artifact entry limit");
        const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
        safePath(relative);
        if (relative.split("/").length > limits.artifactDepth) throw new Error("Artifact depth limit");
        const file = path.join(directory, entry.name);
        const stat = fs.lstatSync(file);
        if (stat.isSymbolicLink()) throw new Error("Artifact links are not allowed");
        if (stat.isDirectory()) { walk(file, relative, chain); continue; }
        const key = relative.toUpperCase().toLowerCase();
        if (names.has(key) || !stat.isFile() || stat.nlink !== 1 || files.length >= limits.artifactCount || stat.size > limits.artifactFileBytes || bytes + stat.size > limits.artifactBytes) throw new Error("Artifact file limit");
        names.add(key);
        for (const parent of chain) checkDirectory(parent.path, parent.stat);
        if (fs.realpathSync(file) !== file) throw new Error("Artifact escaped scratch");
        const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
        let content;
        try {
          const before = fs.fstatSync(fd);
          if (!before.isFile() || before.dev !== stat.dev || before.ino !== stat.ino || before.size !== stat.size) throw new Error("Changed artifact file");
          const buffer = Buffer.alloc(before.size + 1);
          let read = 0;
          while (read < buffer.length) { const count = fs.readSync(fd, buffer, read, buffer.length - read, null); if (!count) break; read += count; }
          const after = fs.fstatSync(fd);
          if (read !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs) throw new Error("Changed artifact file");
          for (const parent of chain) checkDirectory(parent.path, parent.stat);
          content = buffer.subarray(0, read);
        } finally { fs.closeSync(fd); }
        bytes += content.length;
        files.push({ path: relative, content: content.toString("base64") });
      }
    } finally { stream.closeSync(); }
    checkDirectory(directory, anchor);
  }
  walk(root, "", []);
  return files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
}

function textWithin(bytes, maximum) {
  let text = bytes.toString("utf8");
  if (Buffer.byteLength(text) <= maximum) return text;
  text = Buffer.from(text).subarray(0, maximum).toString("utf8");
  while (Buffer.byteLength(text) > maximum) text = text.slice(0, -1);
  return text;
}

async function run(payload) {
  const input = runPayload(payload);
  fs.mkdirSync("/scratch/tmp", { mode: 0o700 });
  fs.mkdirSync("/scratch/artifacts", { mode: 0o700 });
  const child = spawn(input.interpreter, [input.script, ...input.args], {
    cwd: "/scratch", detached: true, stdio: ["pipe", "pipe", "pipe"],
    env: { PATH: "/usr/local/bin:/usr/bin:/bin", HOME: "/scratch", TMPDIR: "/scratch/tmp", SKILL_ROOT: "/skill", OUTPUT_DIR: "/scratch/artifacts", PYTHONDONTWRITEBYTECODE: "1", PYTHONUNBUFFERED: "1" },
  });
  let failure;
  let total = 0;
  const stdout = [], stderr = [];
  const kill = () => { try { if (child.pid) process.kill(-child.pid, "SIGKILL"); } catch { try { child.kill("SIGKILL"); } catch {} } };
  const receive = (sink) => (chunk) => {
    const remaining = input.limits.outputBytes - total;
    if (remaining > 0) sink.push(chunk.subarray(0, remaining));
    total += chunk.length;
    if (total > input.limits.outputBytes) { failure = "output_limit"; kill(); }
  };
  child.stdout.on("data", receive(stdout)); child.stderr.on("data", receive(stderr));
  child.stdin.on("error", () => {});
  const timer = setTimeout(() => { failure = "timeout"; kill(); }, Math.max(1, input.limits.timeoutMs - 500));
  const exitCode = await new Promise((resolve) => {
    child.once("error", () => { failure = "script_failed"; resolve(-1); });
    child.once("close", (code) => resolve(Number.isInteger(code) ? code : -1));
    child.stdin.end(input.stdin);
  });
  clearTimeout(timer);
  kill(); // Stop ordinary descendants before collecting their scratch output.
  let artifacts = [];
  try { artifacts = artifactFiles("/scratch/artifacts", input.limits); }
  catch { failure = "artifact_limit"; }
  const stdoutText = textWithin(Buffer.concat(stdout), input.limits.outputBytes);
  const stderrText = textWithin(Buffer.concat(stderr), input.limits.outputBytes - Buffer.byteLength(stdoutText));
  return { schema: "agentic-skill-run-result/v1", stdout: stdoutText, stderr: stderrText, exitCode, artifacts, ...(failure ? { failure } : {}) };
}

function readPayload() {
  return new Promise((resolve, reject) => {
    const parts = [];
    let length = 0;
    const timer = setTimeout(() => reject(new Error("Input deadline")), 15_000);
    function data(chunk) {
      length += chunk.length;
      if (length > MAX_PROTOCOL) { clearTimeout(timer); process.stdin.pause(); reject(new Error("Protocol size limit")); return; }
      parts.push(chunk);
      if (chunk.includes(10)) {
        clearTimeout(timer); process.stdin.pause(); process.stdin.removeListener("data", data);
        try { resolve(JSON.parse(Buffer.concat(parts).toString("utf8"))); } catch (error) { reject(error); }
      }
    }
    process.stdin.on("data", data);
    process.stdin.once("end", () => { clearTimeout(timer); reject(new Error("Incomplete input protocol")); });
    process.stdin.once("error", reject);
  });
}

async function main() {
  if (process.platform !== "linux" || process.pid !== 1 || process.getuid() !== 65532) {
    process.stderr.write("Skill runner requires its non-root isolated container.\n");
    process.exitCode = 78;
    return;
  }
  const stageMode = process.argv[2] === "stage";
  if (!stageMode && process.argv[2] !== "run") throw new Error("Invalid runner mode");
  try {
    const payload = await readPayload();
    const result = stageMode ? stage(payload) : await run(payload);
    process.stdout.write(JSON.stringify(result) + "\n", () => process.exit(0));
  } catch {
    const result = stageMode
      ? { schema: "agentic-skill-stage-result/v1", ok: false }
      : { schema: "agentic-skill-run-result/v1", stdout: "", stderr: "", exitCode: -1, artifacts: [], failure: "script_failed" };
    process.stdout.write(JSON.stringify(result) + "\n", () => process.exit(2));
  }
}

module.exports = { safePath, decode64, bundleDigest, artifactFiles, textWithin };
if (require.main === module) void main();
