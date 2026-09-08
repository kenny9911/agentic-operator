import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const requiredNode = readFileSync(path.join(repoRoot, ".nvmrc"), "utf8")
  .trim()
  .replace(/^v/, "");
const requiredPnpm = JSON.parse(
  readFileSync(path.join(repoRoot, "package.json"), "utf8"),
).packageManager.split("@")[1];
const shellQuote = (value) => `'${value.replaceAll("'", "'\\''")}'`;

function buildFixture(
  t,
  {
    args = [],
    runtime = requiredNode,
    nvm = true,
    corepack = true,
    pnpmVersion = requiredPnpm,
    dependencies = true,
    buildStatus = 0,
    installStatus = 0,
  } = {},
) {
  const directory = mkdtempSync(path.join(tmpdir(), "build harness test "));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const scripts = path.join(directory, "scripts");
  const bin = path.join(directory, "bin");
  const fixtureHome = path.join(directory, "home");
  const otherCwd = path.join(directory, "outside");
  const scratch = path.join(directory, "scratch");
  const trace = path.join(directory, "trace");
  for (const child of [scripts, bin, fixtureHome, otherCwd, scratch])
    mkdirSync(child);
  if (dependencies) mkdirSync(path.join(directory, "node_modules"));
  writeFileSync(trace, "");
  writeFileSync(path.join(directory, ".nvmrc"), `${requiredNode}\n`);
  writeFileSync(
    path.join(directory, "package.json"),
    JSON.stringify({
      engines: { node: requiredNode },
      packageManager: `pnpm@${requiredPnpm}`,
    }),
  );
  copyFileSync(
    path.join(repoRoot, "scripts/build.sh"),
    path.join(scripts, "build.sh"),
  );
  copyFileSync(
    path.join(repoRoot, "scripts/ensure-node-version.mjs"),
    path.join(scripts, "ensure-node-version.mjs"),
  );
  // Only fixture launchers and required shell utilities can be found. These
  // tests must never discover a host package manager or download dependencies.
  for (const executable of [
    "/bin/bash",
    "/bin/cat",
    "/bin/chmod",
    "/bin/rm",
    "/usr/bin/dirname",
    "/usr/bin/env",
    "/usr/bin/mktemp",
    "/usr/bin/tr",
  ]) {
    symlinkSync(executable, path.join(bin, path.basename(executable)));
  }
  const executable = (name, body) =>
    writeFileSync(path.join(bin, name), `#!/bin/bash\nset -eu\n${body}\n`, {
      mode: 0o755,
    });
  if (runtime !== null) {
    const preload = path.join(directory, "node-version.cjs");
    writeFileSync(
      preload,
      'Object.defineProperty(process, "version", { value: `v${process.env.FIXTURE_NODE_VERSION}` });\n' +
        'Object.defineProperty(process.versions, "node", { value: process.env.FIXTURE_NODE_VERSION });\n',
    );
    executable(
      "node",
      `if [ "\${1:-}" = --version ] || [ "\${1:-}" = -v ]; then
  printf 'v%s\\n' "$FIXTURE_NODE_VERSION"
  exit 0
fi
exec ${shellQuote(process.execPath)} --require ${shellQuote(preload)} "$@"`,
    );
  }
  if (nvm) {
    mkdirSync(path.join(fixtureHome, ".nvm"));
    writeFileSync(
      path.join(fixtureHome, ".nvm/nvm.sh"),
      `nvm() {
  [ "$1" = use ] || return 2
  printf 'nvm:%s\\n' "$2" >> "$FIXTURE_TRACE"
  [ "$2" = "${requiredNode}" ] || return 3
  export FIXTURE_NODE_VERSION=${shellQuote(requiredNode)}
}\n`,
    );
  }
  const launcher = `printf 'launcher:%s\\n' "$*" >> "$FIXTURE_TRACE"
case "\${1:-}" in
  --version) printf '%s\\n' "$FIXTURE_PNPM_VERSION" ;;
  install)
    [ "$*" = 'install --frozen-lockfile' ] || exit 52
    printf 'install\\n' >> "$FIXTURE_TRACE"
    exit "$FIXTURE_INSTALL_STATUS"
    ;;
  run)
    [ "\${2:-}" = build ] || exit 53
    [ "$(node --version)" = "v${requiredNode}" ] || exit 54
    printf 'cwd:%s\\n' "$PWD" >> "$FIXTURE_TRACE"
    shift 2
    for arg in "$@"; do printf 'arg:%s\\n' "$arg" >> "$FIXTURE_TRACE"; done
    nested="$(pnpm --version)"
    printf 'nested:%s\\n' "$nested" >> "$FIXTURE_TRACE"
    [ "$nested" = "${requiredPnpm}" ] || exit 55
    printf 'build\\n' >> "$FIXTURE_TRACE"
    exit "$FIXTURE_BUILD_STATUS"
    ;;
  *) exit 56 ;;
esac`;
  if (corepack) {
    executable("corepack", '[ "$1" = pnpm ] || exit 57\nshift\n' + launcher);
    executable(
      "pnpm",
      "printf 'stale-pnpm\\n' >> \"$FIXTURE_TRACE\"\nprintf '9.15.0\\n'",
    );
  } else {
    executable("pnpm", launcher);
  }
  const result = spawnSync(
    "/bin/bash",
    [path.join(scripts, "build.sh"), ...args],
    {
      cwd: otherCwd,
      encoding: "utf8",
      timeout: 10_000,
      env: {
        HOME: fixtureHome,
        PATH: bin,
        TMPDIR: scratch,
        FIXTURE_TRACE: trace,
        FIXTURE_NODE_VERSION: runtime ?? "",
        FIXTURE_PNPM_VERSION: pnpmVersion,
        FIXTURE_BUILD_STATUS: String(buildStatus),
        FIXTURE_INSTALL_STATUS: String(installStatus),
      },
    },
  );
  assert.ifError(result.error);
  return {
    ...result,
    directory: realpathSync(directory),
    events: readFileSync(trace, "utf8").trim().split("\n").filter(Boolean),
  };
}

test("build help works before Node or package-manager preflight", (t) => {
  const result = buildFixture(t, {
    args: ["--help"],
    runtime: null,
    nvm: false,
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /Usage:/i);
  assert.deepEqual(result.events, []);
});

test("build selects the exact Node pin and keeps nested pnpm on the selected launcher", (t) => {
  const result = buildFixture(t, {
    runtime: "26.5.0",
    args: ["--force", "--filter=@agentic/web", "argument with spaces"],
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert(result.events.includes(`nvm:${requiredNode}`));
  assert(result.events.includes(`cwd:${result.directory}`));
  assert(result.events.includes(`nested:${requiredPnpm}`));
  assert(!result.events.includes("stale-pnpm"));
  assert.deepEqual(
    result.events.filter((event) => event.startsWith("arg:")),
    ["arg:--force", "arg:--filter=@agentic/web", "arg:argument with spaces"],
  );
  assert(!result.events.includes("install"));
});

test("build refuses an unavailable exact Node runtime before invoking pnpm", (t) => {
  const result = buildFixture(t, { runtime: "26.5.0", nvm: false });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /nvm install/);
  assert.deepEqual(result.events, []);
});

test("build rejects a package-manager version that differs from packageManager", (t) => {
  const result = buildFixture(t, { pnpmVersion: "9.15.0", corepack: false });
  assert.notEqual(result.status, 0);
  assert(!result.events.includes("build"));
  assert(!result.events.includes("install"));
  assert.match(result.stderr, /pnpm/i);
});

test("build installs missing dependencies with the frozen lockfile", (t) => {
  const result = buildFixture(t, { dependencies: false, nvm: false });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const install = result.events.indexOf("install");
  const build = result.events.indexOf("build");
  assert(install >= 0 && install < build, result.events.join(", "));
});

test("build propagates installation failure and does not build", (t) => {
  const result = buildFixture(t, { args: ["--install"], installStatus: 23 });
  assert.equal(result.status, 23, result.stdout + result.stderr);
  assert(result.events.includes("install"));
  assert(!result.events.includes("build"));
});

test("build preserves the build process exit status with a direct pnpm fallback", (t) => {
  const result = buildFixture(t, {
    corepack: false,
    nvm: false,
    buildStatus: 37,
  });
  assert.equal(result.status, 37, result.stdout + result.stderr);
  assert(result.events.includes("build"));
});
