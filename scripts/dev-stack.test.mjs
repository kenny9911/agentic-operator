import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { EventEmitter, once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  DEV_STACK_CONFIG,
  installSupervisorSignalHandlers,
  shutdownGraceMs,
  terminateProcessGroups,
} from "./dev-stack.mjs";

const SUPERVISOR_URL = new URL("./dev-stack.mjs", import.meta.url).href;

test("shutdown grace covers API draining and SQLite writer termination", () => {
  assert.equal(shutdownGraceMs({}), 17_000);
  assert.equal(
    shutdownGraceMs({ AGENTIC_SHUTDOWN_TIMEOUT_MS: "25000" }),
    27_000,
  );
  assert.equal(
    shutdownGraceMs({ AGENTIC_SQLITE_WRITER_CHILD_TERMINATION_MS: "30000" }),
    32_000,
  );
  assert.equal(
    shutdownGraceMs({ AGENTIC_DEV_SHUTDOWN_TIMEOUT_MS: "500" }),
    500,
  );
});

async function startFixtureStack(
  t,
  { scenario = "ready", apiScript = "dev" } = {},
) {
  const directory = await mkdtemp(path.join(tmpdir(), "agentic-dev-stack-"));
  const eventsFile = path.join(directory, "events.ndjson");
  const pnpm = path.join(directory, "pnpm");
  const reserve = createServer();
  reserve.listen(0, "127.0.0.1");
  await once(reserve, "listening");
  const port = reserve.address().port;
  await new Promise((resolve) => reserve.close(resolve));
  await writeFile(eventsFile, "");
  await writeFile(
    pnpm,
    `#!${process.execPath}
const { appendFileSync } = require("node:fs");
const { createServer } = require("node:http");
const args = process.argv.slice(2);
const name = args.includes("@agentic/api") ? "api" : args.includes("@agentic/web") ? "web" : "inngest";
const record = (event) => appendFileSync(process.env.AGENTIC_DEV_FIXTURE_EVENTS, JSON.stringify({ name, event, args, pid: process.pid }) + "\\n");
record("start");
process.on("SIGTERM", () => { record("stop"); process.exit(0); });
setInterval(() => {}, 1000);
if (name === "api") {
  if (process.env.AGENTIC_DEV_FIXTURE_SCENARIO === "crash") {
    setTimeout(() => process.exit(42), 100);
  } else if (process.env.AGENTIC_DEV_FIXTURE_SCENARIO === "ready") {
    const server = createServer((_request, response) => {
      record("request");
      response.writeHead(503);
      response.end("degraded subsystem");
    });
    setTimeout(() => server.listen(Number(process.env.AGENTIC_DEV_FIXTURE_PORT), "127.0.0.1"), 150);
    process.on("SIGUSR2", () => server.close(() => record("unavailable")));
  }
}
`,
    { mode: 0o755 },
  );
  const config = { ...DEV_STACK_CONFIG, apiOrigin: `http://127.0.0.1:${port}` };
  const source = `import { main } from ${JSON.stringify(SUPERVISOR_URL)}; await main(${JSON.stringify({ config, pnpm, apiScript })});`;
  const child = spawn(process.execPath, ["--input-type=module", "-e", source], {
    env: {
      ...process.env,
      AGENTIC_DEV_FIXTURE_EVENTS: eventsFile,
      AGENTIC_DEV_FIXTURE_PORT: String(port),
      AGENTIC_DEV_FIXTURE_SCENARIO: scenario,
      AGENTIC_DEV_READY_TIMEOUT_MS: "3000",
      AGENTIC_DEV_READY_INTERVAL_MS: "20",
      AGENTIC_DEV_OUTAGE_TIMEOUT_MS: "100",
      AGENTIC_DEV_WATCH_INTERVAL_MS: "20",
      AGENTIC_DEV_SHUTDOWN_TIMEOUT_MS: "250",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const exit = once(child, "exit");
  let output = "";
  for (const stream of [child.stdout, child.stderr]) {
    stream.setEncoding("utf8");
    stream.on("data", (chunk) => {
      output += chunk;
    });
  }
  const events = async () =>
    (await readFile(eventsFile, "utf8"))
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGTERM");
      await Promise.race([
        exit,
        new Promise((resolve) => setTimeout(resolve, 500)),
      ]);
    }
    for (const event of await events()) {
      if (event.event !== "start") continue;
      try {
        process.kill(-event.pid, "SIGKILL");
      } catch {}
    }
    if (child.exitCode === null && child.signalCode === null)
      child.kill("SIGKILL");
    await rm(directory, { recursive: true, force: true });
  });
  const waitFor = async (predicate) => {
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      const current = await events();
      if (predicate(current)) return current;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.fail(`fixture stack did not reach expected state:\n${output}`);
  };
  return { child, exit, events, waitFor, output: () => output, config };
}

test("root development commands use the supervised startup and run its regressions", async () => {
  assert.equal(DEV_STACK_CONFIG.apiOrigin, "http://127.0.0.1:3540");
  assert.equal(DEV_STACK_CONFIG.webPort, 3599);
  const manifest = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );
  assert.equal(manifest.scripts.dev, "node scripts/dev-stack.mjs");
  assert.equal(
    manifest.scripts["dev:e2e"],
    "node scripts/dev-stack.mjs --no-watch",
  );
  assert.match(manifest.scripts.test, /scripts\/dev-stack\.test\.mjs/);
  assert.match(manifest.scripts.test, /scripts\/wait-for-http\.test\.mjs/);
});

for (const apiScript of ["dev", "dev:no-watch"]) {
  test(
    `supervisor waits for the API before starting dependents (${apiScript})`,
    {
      skip: process.platform === "win32",
      timeout: 10_000,
    },
    async (t) => {
      const stack = await startFixtureStack(t, { apiScript });
      const events = await stack.waitFor(
        (current) =>
          current.filter((event) => event.event === "start").length === 3,
      );
      const starts = events.filter((event) => event.event === "start");
      assert.equal(starts[0].name, "api");
      assert.equal(starts[0].args.at(-1), apiScript);
      const requestIndex = events.findIndex(
        (event) => event.name === "api" && event.event === "request",
      );
      assert(
        requestIndex > 0,
        "API must accept a request before dependents launch",
      );
      for (const name of ["web", "inngest"]) {
        assert(
          events.findIndex(
            (event) => event.name === name && event.event === "start",
          ) > requestIndex,
        );
      }
      assert.match(stack.output(), /status 503/);
      assert.deepEqual(starts.find((event) => event.name === "inngest").args, [
        "exec",
        "inngest-cli",
        "dev",
        "-u",
        `${stack.config.apiOrigin}/inngest`,
        "-p",
        "8488",
        "--connect-gateway-port",
        "8489",
        "--connect-gateway-grpc-port",
        "50152",
        "--connect-executor-grpc-port",
        "50153",
      ]);
      stack.child.kill("SIGTERM");
      assert.deepEqual(await stack.exit, [0, null]);
      assert.deepEqual(
        (await stack.events())
          .filter((event) => event.event === "stop")
          .map((event) => event.name)
          .sort(),
        ["api", "inngest", "web"],
      );
      for (const { pid } of starts) assert.equal(processExists(pid), false);
    },
  );
}

for (const scenario of ["never-ready", "crash"]) {
  test(
    `supervisor keeps dependents stopped when API startup fails (${scenario})`,
    {
      skip: process.platform === "win32",
      timeout: 10_000,
    },
    async (t) => {
      const stack = await startFixtureStack(t, { scenario });
      assert.deepEqual(await stack.exit, [1, null]);
      const starts = (await stack.events()).filter(
        (event) => event.event === "start",
      );
      assert.deepEqual(
        starts.map((event) => event.name),
        ["api"],
      );
      assert.match(
        stack.output(),
        scenario === "crash"
          ? /api stopped unexpectedly \(exit code 42\)/
          : /API readiness failed:.*timed out/,
      );
      for (const { pid } of starts) assert.equal(processExists(pid), false);
    },
  );
}

test(
  "supervisor stops dependents after a sustained API outage while its watcher stays alive",
  {
    skip: process.platform === "win32",
    timeout: 10_000,
  },
  async (t) => {
    const stack = await startFixtureStack(t);
    const events = await stack.waitFor(
      (current) =>
        current.filter((event) => event.event === "start").length === 3,
    );
    const starts = events.filter((event) => event.event === "start");
    process.kill(starts.find((event) => event.name === "api").pid, "SIGUSR2");
    assert.deepEqual(await stack.exit, [1, null]);
    assert.match(stack.output(), /API watchdog failed:.*remained unavailable/);
    for (const { pid } of starts) assert.equal(processExists(pid), false);
  },
);

function processExists(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !(error && typeof error === "object" && error.code === "ESRCH");
  }
}

test(
  "process-group cleanup force-kills a child that ignores SIGTERM",
  { skip: process.platform === "win32", timeout: 5_000 },
  async (t) => {
    const child = spawn(
      process.execPath,
      [
        "-e",
        [
          'process.on("SIGTERM", () => {});',
          'process.stdout.write("ready\\n");',
          "setInterval(() => {}, 1000);",
        ].join(""),
      ],
      {
        detached: true,
        stdio: ["ignore", "pipe", "ignore"],
      },
    );
    const exit = once(child, "exit");
    t.after(() => {
      if (child.exitCode === null) {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {}
      }
    });

    await once(child.stdout, "data");
    const startedAt = Date.now();
    const lingering = await terminateProcessGroups(
      [{ name: "fixture", child }],
      {
        graceMs: 100,
        forceWaitMs: 1_000,
        pollIntervalMs: 10,
      },
    );
    const [code, signal] = await exit;

    assert.equal(code, null);
    assert.equal(signal, "SIGKILL");
    assert.deepEqual(lingering, []);
    assert(Date.now() - startedAt >= 100);
  },
);

test("signal handling drains on first signal and force-kills on a repeat", () => {
  const source = new EventEmitter();
  let shuttingDown = false;
  let clock = 0;
  const shutdownSignals = [];
  const forcedSignals = [];
  const dispose = installSupervisorSignalHandlers({
    source,
    now: () => clock,
    isShuttingDown: () => shuttingDown,
    shutdown: (signal) => {
      shutdownSignals.push(signal);
      shuttingDown = true;
    },
    forceShutdown: (exitCode, signal) => {
      forcedSignals.push({ exitCode, signal });
    },
  });

  source.emit("SIGHUP");
  clock = 100;
  source.emit("SIGINT");
  clock = 600;
  source.emit("SIGTERM");
  dispose();
  source.emit("SIGINT");

  assert.deepEqual(shutdownSignals, ["SIGHUP"]);
  assert.deepEqual(forcedSignals, [{ exitCode: 143, signal: "SIGTERM" }]);
});

test(
  "cleanup kills descendants after their process-group leader exits",
  { skip: process.platform === "win32", timeout: 5_000 },
  async (t) => {
    const descendantScript =
      'process.on("SIGTERM", () => {}); setInterval(() => {}, 1000);';
    const leaderScript = [
      'const { spawn } = require("node:child_process");',
      `const child = spawn(process.execPath, ["-e", ${JSON.stringify(descendantScript)}], { stdio: "ignore" });`,
      "child.unref();",
      "process.stdout.write(String(child.pid));",
    ].join("");
    const leader = spawn(process.execPath, ["-e", leaderScript], {
      detached: true,
      stdio: ["ignore", "pipe", "ignore"],
    });
    let output = "";
    leader.stdout.setEncoding("utf8");
    leader.stdout.on("data", (chunk) => {
      output += chunk;
    });
    await once(leader, "exit");
    const descendantPid = Number(output);
    assert(Number.isInteger(descendantPid) && descendantPid > 0);

    t.after(() => {
      if (processExists(descendantPid)) {
        try {
          process.kill(descendantPid, "SIGKILL");
        } catch {}
      }
    });

    const lingering = await terminateProcessGroups(
      [{ name: "leader", child: leader }],
      {
        graceMs: 100,
        forceWaitMs: 1_000,
        pollIntervalMs: 10,
      },
    );

    assert.deepEqual(lingering, []);
    assert.equal(processExists(descendantPid), false);
  },
);
