import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
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
const [requiredMajor, requiredMinor, requiredPatch] = requiredVersion.split(".");
// Synthetic newer patch keeps the major-only nvm regression reproducible
// after the repository pin changes, without needing that release installed.
const newerVersion = `${requiredMajor}.${requiredMinor}.${Number(requiredPatch) + 1}`;

function shellQuote(value) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function restartFixture(
  t,
  { nvm = "installed", runtime = newerVersion, pnpmRejects = false } = {},
) {
  const directory = mkdtempSync(path.join(tmpdir(), "restart-dev-test-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const scripts = path.join(directory, "scripts");
  const bin = path.join(directory, "bin");
  const fixtureHome = path.join(directory, "home");
  const trace = path.join(directory, "trace");
  for (const child of [scripts, bin, fixtureHome]) mkdirSync(child);
  writeFileSync(trace, "");
  writeFileSync(path.join(directory, ".nvmrc"), `${requiredVersion}\n`);
  writeFileSync(
    path.join(directory, "package.json"),
    JSON.stringify({ engines: { node: requiredVersion } }),
  );
  for (const name of ["restart-dev.sh", "ensure-node-version.mjs"]) {
    copyFileSync(path.join(scriptsDirectory, name), path.join(scripts, name));
  }

  // PATH has only fixture executables and the shell utilities used by restart.
  // In particular, a test for missing Node cannot find a host installation.
  for (const executable of [
    "/bin/bash",
    "/bin/cat",
    "/usr/bin/dirname",
    "/usr/bin/env",
    "/usr/bin/tr",
    "/usr/bin/sed",
  ]) {
    symlinkSync(executable, path.join(bin, path.basename(executable)));
  }
  const writeExecutable = (name, contents) => {
    writeFileSync(path.join(bin, name), `#!/bin/bash\nset -eu\n${contents}\n`, {
      mode: 0o755,
    });
  };

  if (runtime !== null) {
    const preload = path.join(directory, "node-version.cjs");
    writeFileSync(
      preload,
      [
        'Object.defineProperty(process, "version", { value: `v${process.env.FIXTURE_NODE_VERSION}` });',
        'Object.defineProperty(process.versions, "node", { value: process.env.FIXTURE_NODE_VERSION });',
      ].join("\n"),
    );
    writeExecutable(
      "node",
      `
if [ "\${1:-}" = "--version" ] || [ "\${1:-}" = "-v" ]; then
  printf 'v%s\\n' "$FIXTURE_NODE_VERSION"
  exit 0
fi
exec ${shellQuote(process.execPath)} --require ${shellQuote(preload)} "$@"`,
    );
  }

  if (nvm !== "absent") {
    mkdirSync(path.join(fixtureHome, ".nvm"));
    writeFileSync(
      path.join(fixtureHome, ".nvm", "nvm.sh"),
      `
nvm() {
  [ "$1" = "use" ] || return 2
  local selected="\${2:-$(cat .nvmrc)}"
  printf 'nvm:use:%s\\n' "$selected" >> "$FIXTURE_TRACE"
  [ "$FIXTURE_NVM" != "missing-pin" ] || return 3
  case "$selected" in
    ${requiredMajor}) export FIXTURE_NODE_VERSION=${newerVersion} ;;
    ${requiredVersion}|v${requiredVersion}) export FIXTURE_NODE_VERSION=${requiredVersion} ;;
    *) return 3 ;;
  esac
}
`,
    );
  }

  writeExecutable(
    "pnpm",
    `
printf 'pnpm:%s\\n' "$*" >> "$FIXTURE_TRACE"
if [ "$FIXTURE_PNPM_REJECTS" = "1" ]; then
  echo 'ERR_PNPM_UNSUPPORTED_ENGINE: fixture launcher rejected the runtime' >&2
  exit 42
fi
if [ "$(node -p 'process.versions.node')" != "${requiredVersion}" ]; then
  echo 'ERR_PNPM_UNSUPPORTED_ENGINE: wrong Node runtime' >&2
  exit 1
fi
if [ "$*" = 'run ensure:node' ]; then
  node scripts/ensure-node-version.mjs
elif [ "$*" = 'dev' ]; then
  printf 'dev:skip-stop:%s\\n' "\${AGENTIC_SKIP_PREDEV_STOP:-0}" >> "$FIXTURE_TRACE"
else
  echo "Unexpected pnpm command: $*" >&2
  exit 2
fi`,
  );
  writeFileSync(
    path.join(scripts, "stop-dev.sh"),
    '#!/bin/bash\nprintf "stop\\n" >> "$FIXTURE_TRACE"\n',
  );

  const result = spawnSync(
    "/bin/bash",
    [path.join(scripts, "restart-dev.sh")],
    {
      cwd: directory,
      encoding: "utf8",
      timeout: 10_000,
      env: {
        HOME: fixtureHome,
        PATH: bin,
        FIXTURE_TRACE: trace,
        FIXTURE_NVM: nvm,
        FIXTURE_NODE_VERSION: runtime ?? "",
        FIXTURE_PNPM_REJECTS: pnpmRejects ? "1" : "0",
      },
    },
  );
  assert.ifError(result.error);
  return {
    ...result,
    events: readFileSync(trace, "utf8").trim().split("\n").filter(Boolean),
  };
}

function assertStackWasPreserved(result) {
  assert.notEqual(result.status, 0, result.stdout + result.stderr);
  assert(
    !result.events.includes("stop"),
    `Stopped the existing stack: ${result.events.join(", ")}`,
  );
  assert(
    !result.events.includes("pnpm:dev"),
    `Started dev despite failed preflight: ${result.events.join(", ")}`,
  );
}

test("restart selects the exact repository pin when a newer Node 26 patch is installed", (t) => {
  const result = restartFixture(t);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert(result.events.includes(`nvm:use:${requiredVersion}`));
  const preflight = result.events.indexOf("pnpm:run ensure:node");
  const stop = result.events.indexOf("stop");
  const start = result.events.indexOf("pnpm:dev");
  assert(
    preflight >= 0 && preflight < stop && stop < start,
    result.events.join(", "),
  );
  assert(result.events.includes("dev:skip-stop:1"));
});

test("restart accepts an already active exact runtime without nvm", (t) => {
  const result = restartFixture(t, { nvm: "absent", runtime: requiredVersion });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert(result.events.includes("stop"));
  assert(result.events.includes("pnpm:dev"));
});

test("restart leaves the stack running when nvm and the exact runtime are unavailable", (t) => {
  assertStackWasPreserved(restartFixture(t, { nvm: "absent" }));
});

test("restart leaves the stack running when nvm cannot activate the repository pin", (t) => {
  assertStackWasPreserved(restartFixture(t, { nvm: "missing-pin" }));
});

test("restart leaves the stack running when Node is missing", (t) => {
  assertStackWasPreserved(restartFixture(t, { nvm: "absent", runtime: null }));
});

test("restart leaves the stack running when the selected pnpm launcher rejects its engine", (t) => {
  const result = restartFixture(t, {
    nvm: "absent",
    runtime: requiredVersion,
    pnpmRejects: true,
  });
  assertStackWasPreserved(result);
  assert.match(result.stderr, /ERR_PNPM_UNSUPPORTED_ENGINE/);
});
