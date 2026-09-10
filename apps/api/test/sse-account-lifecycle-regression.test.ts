import { EventEmitter } from "node:events";
import type { FastifyInstance } from "fastify";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const state = vi.hoisted(() => ({
  auth: {
    userId: "usr-stream",
    tenantId: "ten-stream",
    tenantSlug: "stream",
    role: "admin" as const,
    platformRole: "none" as const,
    via: "cookie" as const,
    authorityAccountId: "account-stream",
  },
  refresh: vi.fn(),
  replay: null as unknown[] | null,
  durable: [] as unknown[],
  subscriber: null as ((event: unknown) => void) | null,
  unsubscribe: vi.fn(),
}));

vi.mock("../src/plugins/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/plugins/auth")>()),
  refreshRequestAuth: (...args: unknown[]) => state.refresh(...args),
}));
vi.mock("../src/plugins/rbac", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/plugins/rbac")>()),
  requirePermission: () => state.auth,
}));
vi.mock("../src/services/ontocode-session-store", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../src/services/ontocode-session-store")
  >()),
  listOntoCodeEvents: () => ({ items: [], hasMore: false }),
}));
vi.mock("../src/services/agent-factory", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/services/agent-factory")>()),
  getRun: () => ({ id: "run-replay", deletedAt: null }),
}));
vi.mock(
  "../src/services/agent-factory/run-registry",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("../src/services/agent-factory/run-registry")
    >()),
    subscribeRunWithReplay: (
      _id: string,
      callback: (event: unknown) => void,
    ) => {
      if (!state.replay) return null;
      state.subscriber = callback;
      return { replay: state.replay, unsubscribe: state.unsubscribe };
    },
    // Keep the prior synchronous subscription contract represented: reverting
    // the route to it must reproduce the historical >512-frame failure.
    subscribeRun: (_id: string, callback: (event: unknown) => void) => {
      if (!state.replay) return null;
      for (const event of state.replay) callback(event);
      state.subscriber = callback;
      return state.unsubscribe;
    },
    readDurableRun: async () => ({ transcript: state.durable, deleted: false }),
    isActiveRun: () => state.replay !== null,
  }),
);
vi.mock("../src/routes/v1/agent-factory-fixture-assets", () => ({
  registerFactoryFixtureAssetRoutes: async () => undefined,
}));

import { agentFactoryRoutes } from "../src/routes/v1/agent-factory";
import { ontocodeStreamRoutes } from "../src/routes/v1/ontocode-stream";

type RequestFixture = ReturnType<typeof request>;
type ReplyFixture = ReturnType<typeof reply>;
type Handler = (req: RequestFixture, res: ReplyFixture) => Promise<unknown>;
const handlers = new Map<string, Handler>();
const responses: RawResponse[] = [];

// Exercise real route and authorization code while controlling just the socket
// and durable read seams. This exposes drain/close races without sleeps or LLMs.
class RawResponse extends EventEmitter {
  frames: string[] = [];
  destroyed = false;
  writableEnded = false;
  blockOrdinal: number | null = null;
  writeHead = vi.fn();
  write(data: string): boolean {
    this.frames.push(data);
    return (
      this.blockOrdinal === null ||
      !data.includes(`"ordinal":${this.blockOrdinal}`)
    );
  }
  end() {
    if (this.writableEnded) return;
    this.writableEnded = true;
    this.emit("close");
  }
}

function request() {
  return {
    auth: state.auth,
    raw: new EventEmitter(),
    params: { sessionId: "session-replay" },
    query: { run: "run-replay" },
    headers: {},
    log: { error: vi.fn() },
  };
}
function reply() {
  const raw = new RawResponse();
  responses.push(raw);
  return { raw, hijack: vi.fn(), fail: vi.fn() };
}
function history() {
  return Array.from({ length: 600 }, (_, ordinal) => ({
    t: "message",
    ordinal,
  }));
}
function ordinals(raw: RawResponse) {
  return raw.frames.flatMap((frame) => {
    const match = /^data: (\{.*\})\n\n$/.exec(frame);
    if (!match) return [];
    const event = JSON.parse(match[1]!) as { ordinal?: number };
    return typeof event.ordinal === "number" ? [event.ordinal] : [];
  });
}
async function microtasks() {
  for (let index = 0; index < 20; index += 1) await Promise.resolve();
}

beforeAll(async () => {
  const app: Record<string, unknown> = { addHook: vi.fn() };
  for (const method of ["get", "post", "put", "patch", "delete"])
    app[method] = (path: string, ...args: unknown[]) => {
      if (method === "get") handlers.set(path, args.at(-1) as Handler);
      return app;
    };
  await ontocodeStreamRoutes(app as unknown as FastifyInstance);
  await agentFactoryRoutes(app as unknown as FastifyInstance);
});
beforeEach(() => {
  vi.useFakeTimers({
    toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout"],
  });
  state.refresh.mockReset().mockResolvedValue(state.auth);
  state.replay = null;
  state.durable = [];
  state.subscriber = null;
  state.unsubscribe.mockReset().mockImplementation(() => {
    state.subscriber = null;
  });
});
afterEach(() => {
  for (const raw of responses.splice(0)) raw.end();
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("account-authorized SSE lifecycle regressions", () => {
  it("does not install timers after initial OntoCode authorization rejects", async () => {
    state.refresh.mockResolvedValue(null);
    const res = reply();
    await handlers.get("/ontocode/sessions/:sessionId/stream")!(request(), res);
    expect(res.raw.writableEnded).toBe(true);
    expect(state.refresh).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("handles a socket closing while the initial OntoCode inspection is pending", async () => {
    let resolveInspection!: (value: typeof state.auth) => void;
    state.refresh.mockReturnValue(
      new Promise((resolve) => {
        resolveInspection = resolve;
      }),
    );
    const req = request();
    const res = reply();
    const serving = handlers.get("/ontocode/sessions/:sessionId/stream")!(
      req,
      res,
    );
    req.raw.emit("close");
    resolveInspection(state.auth);
    await serving;
    expect(res.raw.writableEnded).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("delivers a 600-frame durable Factory history in order and ends cleanly", async () => {
    state.durable = history();
    const res = reply();
    await handlers.get("/agent-factory/stream")!(request(), res);
    await microtasks();
    expect(ordinals(res.raw)).toEqual(
      Array.from({ length: 600 }, (_, index) => index),
    );
    expect(res.raw.frames).toContain("event: end\ndata: ok\n\n");
    expect(res.raw.writableEnded).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("replays 600 live-history frames, continues live delivery, and releases its subscriber", async () => {
    state.replay = [{ t: "run.started", runId: "run-replay" }, ...history()];
    const req = request();
    const res = reply();
    await handlers.get("/agent-factory/stream")!(req, res);
    expect(ordinals(res.raw)).toEqual(
      Array.from({ length: 600 }, (_, index) => index),
    );
    expect(res.raw.writableEnded).toBe(false);
    expect(state.unsubscribe).not.toHaveBeenCalled();
    state.subscriber!({ t: "message", ordinal: 600 });
    await microtasks();
    expect(ordinals(res.raw).at(-1)).toBe(600);
    req.raw.emit("close");
    expect(state.unsubscribe).toHaveBeenCalledTimes(1);
    expect(state.subscriber).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("revocation releases a backpressured replay without waiting for socket drain", async () => {
    state.replay = history();
    const res = reply();
    res.raw.blockOrdinal = 0;
    const serving = handlers.get("/agent-factory/stream")!(request(), res);
    await microtasks();
    expect(ordinals(res.raw)).toEqual([0]);
    expect(res.raw.listenerCount("drain")).toBe(1);
    state.refresh.mockResolvedValue(null);
    await vi.advanceTimersByTimeAsync(15_000);
    await serving;
    expect(ordinals(res.raw)).toEqual([0]);
    expect(res.raw.writableEnded).toBe(true);
    expect(state.unsubscribe).toHaveBeenCalledTimes(1);
    expect(res.raw.listenerCount("drain")).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});
