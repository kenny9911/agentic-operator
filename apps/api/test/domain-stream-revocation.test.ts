import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile, appendFile } from "node:fs/promises";
import type { ServerResponse } from "node:http";
import os from "node:os";
import path from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  agents,
  apiTokens,
  domains,
  getDb,
  memberships,
  ontocodeProjects,
  ontocodeSessionEvents,
  ontocodeSessions,
  runs,
  tenants,
  users,
  workflows,
  tenantRuntimeNamespaces,
} from "@agentic/db";
import {
  __broadcastSubscriberCount,
  publishStreamEvent,
} from "@agentic/runtime";
import { registerAuth, signSessionJwt } from "../src/plugins/auth";
import { registerEnvelope } from "../src/plugins/error";
import { streamRoutes } from "../src/routes/v1/stream";
import { runsLogsRoute } from "../src/routes/v1/runs-logs";
import { ontocodeStreamRoutes } from "../src/routes/v1/ontocode-stream";
import { agentFactoryRoutes } from "../src/routes/v1/agent-factory";
import {
  createDomain,
  grantDomainMembership,
  revokeDomainMembership,
} from "../src/services/domains";
import {
  recordRunStart,
  recordRunProgress,
} from "../src/services/agent-factory/stores";
import { setFactoryDomainBinding } from "../src/services/agent-factory/domain-binding";

describe("open Domain streams revoke access before the next frame", () => {
  let app: FastifyInstance;
  let address: string;
  let logRoot: string;
  const clients: Array<{ cancel: () => Promise<void> }> = [];
  const transportHooks = new Map<
    string,
    (frame: string, raw: ServerResponse) => boolean | void
  >();

  beforeAll(async () => {
    vi.stubEnv("AUTH_MODE", "");
    logRoot = await mkdtemp(
      path.join(os.tmpdir(), "domain-stream-revocation-"),
    );
    vi.stubEnv("AGENTIC_LOGS_DIR", logRoot);
    app = Fastify();
    await registerEnvelope(app);
    await registerAuth(app);
    // Observe the real transport. Tests can commit an administrative change
    // at an exact frame boundary, or force backpressure, without replacing
    // the route, persistence, authorization, or broadcaster.
    app.addHook("onRequest", async (req, reply) => {
      const hook = transportHooks.get(
        String(req.headers["x-stream-test"] ?? ""),
      );
      if (!hook) return;
      const raw = reply.raw;
      const write = raw.write.bind(raw);
      raw.write = ((...args: Parameters<typeof write>) => {
        const accepted = write(...args);
        return hook(String(args[0]), raw) ?? accepted;
      }) as typeof raw.write;
    });
    await app.register(streamRoutes, { prefix: "/v1" });
    await app.register(runsLogsRoute, { prefix: "/v1" });
    await app.register(ontocodeStreamRoutes, { prefix: "/v1" });
    await app.register(agentFactoryRoutes, { prefix: "/v1" });
    address = await app.listen({ host: "127.0.0.1", port: 0 });
  });

  afterAll(async () => {
    await Promise.all(clients.map((client) => client.cancel()));
    await app?.close();
    vi.unstubAllEnvs();
    await rm(logRoot, { recursive: true, force: true });
  });

  async function fixture() {
    const suffix = randomUUID().slice(0, 8);
    const owner = {
      id: `ten-stream-${suffix}`,
      slug: `stream-${suffix}`,
      name: "Stream owner",
    };
    const userId = `usr-stream-${suffix}`;
    const db = getDb();
    db.insert(tenants).values(owner).run();
    db.insert(users)
      .values({
        id: userId,
        email: `${suffix}@stream.test`,
        name: "Stream operator",
        status: "active",
        platformRole: "none",
      })
      .run();
    db.insert(memberships)
      .values({ userId, tenantId: owner.id, role: "viewer" })
      .run();
    const domain = await createDomain(owner.id, {
      slug: "purchasing",
      name: "Purchasing",
    });
    grantDomainMembership(owner.id, domain.id, userId, "operator");
    const cookie = `agentic_session=${await signSessionJwt({ sub: userId, name: "Stream operator", initials: "SO", tenant: owner.slug })}`;
    const headers = {
      cookie,
      "x-agentic-tenant": owner.slug,
      "x-agentic-domain": domain.slug,
    };
    return { owner, userId, domain, headers };
  }

  async function openStream(url: string, headers: Record<string, string>) {
    const controller = new AbortController();
    const response = await fetch(`${address}${url}`, {
      headers,
      signal: controller.signal,
    });
    if (response.status !== 200)
      throw new Error(
        `Stream failed (${response.status}): ${await response.text()}`,
      );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let body = "";
    let ended = false;
    const completed = (async () => {
      try {
        while (true) {
          const next = await reader.read();
          if (next.done) break;
          body += decoder.decode(next.value, { stream: true });
        }
      } catch (error) {
        if (!controller.signal.aborted) throw error;
      } finally {
        ended = true;
      }
    })();
    const client = {
      get body() {
        return body;
      },
      get ended() {
        return ended;
      },
      async seen(value: string) {
        await vi.waitFor(() => expect(body).toContain(value), {
          timeout: 2500,
          interval: 10,
        });
      },
      async closed() {
        await vi.waitFor(() => expect(ended).toBe(true), {
          timeout: 2500,
          interval: 10,
        });
      },
      async cancel() {
        controller.abort();
        await reader.cancel().catch(() => {});
        await completed;
      },
    };
    clients.push(client);
    return client;
  }

  function publish(tenantId: string, marker: string) {
    publishStreamEvent({
      type: "run.started",
      tenantId,
      at: Date.now(),
      runId: marker,
      agentName: "stream-agent",
      triggerEvent: null,
      subject: null,
      correlationId: marker,
    });
  }

  const revocations = [
    [
      "Domain membership removal",
      (f: Awaited<ReturnType<typeof fixture>>) =>
        revokeDomainMembership(f.owner.id, f.domain.id, f.userId),
    ],
    [
      "parent membership removal",
      (f: Awaited<ReturnType<typeof fixture>>) =>
        getDb()
          .delete(memberships)
          .where(
            and(
              eq(memberships.tenantId, f.owner.id),
              eq(memberships.userId, f.userId),
            ),
          )
          .run(),
    ],
    [
      "parent archive",
      (f: Awaited<ReturnType<typeof fixture>>) =>
        getDb()
          .update(tenants)
          .set({ archivedAt: new Date() })
          .where(eq(tenants.id, f.owner.id))
          .run(),
    ],
    [
      "Domain archive",
      (f: Awaited<ReturnType<typeof fixture>>) =>
        getDb()
          .update(domains)
          .set({ archivedAt: new Date() })
          .where(eq(domains.id, f.domain.id))
          .run(),
    ],
    [
      "namespace archive",
      (f: Awaited<ReturnType<typeof fixture>>) =>
        getDb()
          .update(tenantRuntimeNamespaces)
          .set({ status: "archived", archivedAt: new Date() })
          .where(eq(tenantRuntimeNamespaces.tenantId, f.domain.runtimeTenantId))
          .run(),
    ],
    [
      "user suspension",
      (f: Awaited<ReturnType<typeof fixture>>) =>
        getDb()
          .update(users)
          .set({ status: "disabled" })
          .where(eq(users.id, f.userId))
          .run(),
    ],
  ] as const;

  it.each(revocations)(
    "closes lifecycle SSE after %s without leaking the next event",
    async (_name, revoke) => {
      const f = await fixture();
      const client = await openStream("/v1/stream?backfill=0", f.headers);
      await client.seen("event: ready");
      publish(f.domain.runtimeTenantId, "before-revocation");
      await client.seen("before-revocation");
      revoke(f);
      publish(f.domain.runtimeTenantId, "forbidden-after-revocation");
      await client.closed();
      expect(client.body).not.toContain("forbidden-after-revocation");
      expect(__broadcastSubscriberCount(f.domain.runtimeTenantId)).toBe(0);
    },
  );

  it.each(["delete", "rotate", "reduce-scopes"] as const)(
    "rechecks an open namespace token after %s",
    async (change) => {
      const f = await fixture();
      const token = randomUUID();
      const tokenId = `tok-${randomUUID()}`;
      getDb()
        .insert(apiTokens)
        .values({
          id: tokenId,
          tenantId: f.domain.runtimeTenantId,
          hash: createHash("sha256").update(token).digest("hex"),
          name: "Stream token",
          scopes: ["tenant:write"],
        })
        .run();
      const client = await openStream("/v1/stream?backfill=0", {
        authorization: `Bearer ${token}`,
      });
      await client.seen("event: ready");
      publish(f.domain.runtimeTenantId, "token-before-revocation");
      await client.seen("token-before-revocation");
      if (change === "delete")
        getDb().delete(apiTokens).where(eq(apiTokens.id, tokenId)).run();
      else
        getDb()
          .update(apiTokens)
          .set(
            change === "rotate"
              ? {
                  hash: createHash("sha256").update(randomUUID()).digest("hex"),
                }
              : { scopes: ["tenant:read"] },
          )
          .where(eq(apiTokens.id, tokenId))
          .run();
      publish(f.domain.runtimeTenantId, "forbidden-token-frame");
      await client.closed();
      expect(client.body).not.toContain("forbidden-token-frame");
      expect(__broadcastSubscriberCount(f.domain.runtimeTenantId)).toBe(0);
    },
  );

  it("discards buffered lifecycle frames when grants change before drain", async () => {
    const f = await fixture();
    let response: ServerResponse | undefined;
    transportHooks.set("backpressure", (frame, raw) => {
      if (frame.includes("transport-blocked")) {
        response = raw;
        return false;
      }
    });
    const client = await openStream("/v1/stream?backfill=0", {
      ...f.headers,
      "x-stream-test": "backpressure",
    });
    await client.seen("event: ready");
    publish(f.domain.runtimeTenantId, "transport-blocked");
    publish(f.domain.runtimeTenantId, "forbidden-buffered-frame");
    grantDomainMembership(f.owner.id, f.domain.id, f.userId, "viewer");
    response!.emit("drain");
    await client.closed();
    expect(client.body).toContain("transport-blocked");
    expect(client.body).not.toContain("forbidden-buffered-frame");
    expect(__broadcastSubscriberCount(f.domain.runtimeTenantId)).toBe(0);
    transportHooks.delete("backpressure");
  });

  it.each(["quiet", "backpressured"] as const)(
    "closes a %s run-log follower after revocation without sending further lines",
    async (mode) => {
      const f = await fixture();
      const workflowId = `wf-${randomUUID()}`;
      const agentId = `agt-${randomUUID()}`;
      const runId = `run-${randomUUID()}`;
      const filePath = path.join(
        logRoot,
        f.domain.runtimeTenantSlug,
        "runs",
        "2026-09-10",
        `${runId}.log`,
      );
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(
        filePath,
        mode === "backpressured"
          ? "visible-log-line\nforbidden-log-line\n"
          : "visible-log-line\n",
      );
      if (mode === "backpressured") {
        transportHooks.set("blocked-log", (frame) => {
          if (frame.includes("visible-log-line")) return false;
        });
      }
      const db = getDb();
      db.insert(workflows)
        .values({
          id: workflowId,
          tenantId: f.domain.runtimeTenantId,
          slug: "stream-logs",
          name: "Stream logs",
        })
        .run();
      db.insert(agents)
        .values({
          id: agentId,
          workflowId,
          kebabId: "logAgent",
          name: "logAgent",
          title: "Log Agent",
          actor: "Agent",
          kind: "code",
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .run();
      db.insert(runs)
        .values({
          id: runId,
          tenantId: f.domain.runtimeTenantId,
          agentId,
          status: "ok",
          correlationId: runId,
          logPath: filePath,
        })
        .run();
      const client = await openStream(`/v1/runs/${runId}/logs?follow=1`, {
        ...f.headers,
        ...(mode === "backpressured" ? { "x-stream-test": "blocked-log" } : {}),
      });
      await client.seen("visible-log-line");
      revokeDomainMembership(f.owner.id, f.domain.id, f.userId);
      await client.closed();
      await appendFile(filePath, "forbidden-log-line\n");
      expect(client.body).not.toContain("forbidden-log-line");
      transportHooks.delete("blocked-log");
    },
  );

  it("revalidates a durable Factory replay between frames", async () => {
    const f = await fixture();
    setFactoryDomainBinding(
      f.domain.runtimeTenantId,
      { id: "purchasing" },
      "explicit",
    );
    const runId = recordRunStart(
      "purchasing",
      "Stream access regression",
      f.domain.runtimeTenantId,
    );
    recordRunProgress(
      runId,
      {
        transcript: [
          { t: "message", text: "factory-before-revocation" },
          { t: "message", text: "forbidden-factory-frame" },
        ],
        tokensUsed: 0,
        turns: 0,
        agentsCount: 0,
        reachedTerminal: false,
      },
      f.domain.runtimeTenantId,
    );
    transportHooks.set("factory-revoke", (frame) => {
      if (frame.includes("factory-before-revocation"))
        revokeDomainMembership(f.owner.id, f.domain.id, f.userId);
    });
    const client = await openStream(`/v1/agent-factory/stream?run=${runId}`, {
      ...f.headers,
      "x-stream-test": "factory-revoke",
    });
    await client.closed();
    expect(client.body).toContain("factory-before-revocation");
    expect(client.body).not.toContain("forbidden-factory-frame");
    transportHooks.delete("factory-revoke");
  });

  it("closes an OntoCode event poller after its namespace token is revoked", async () => {
    const f = await fixture();
    const projectId = `ocp-${randomUUID().replaceAll("-", "").slice(0, 16)}`;
    const sessionId = `ocs-${randomUUID().replaceAll("-", "").slice(0, 16)}`;
    const token = randomUUID();
    const tokenId = `tok-${randomUUID()}`;
    const db = getDb();
    db.insert(apiTokens)
      .values({
        id: tokenId,
        tenantId: f.domain.runtimeTenantId,
        hash: createHash("sha256").update(token).digest("hex"),
        name: "OntoCode stream token",
        scopes: ["tenant:read"],
      })
      .run();
    db.insert(ontocodeProjects)
      .values({
        id: projectId,
        tenantId: f.domain.runtimeTenantId,
        domain: "purchasing",
        name: "Stream project",
      })
      .run();
    db.insert(ontocodeSessions)
      .values({
        id: sessionId,
        tenantId: f.domain.runtimeTenantId,
        projectId,
        title: "Stream session",
        goal: "Stream revocation",
      })
      .run();
    const append = (seq: number, marker: string) =>
      db
        .insert(ontocodeSessionEvents)
        .values({
          id: `oce-${randomUUID().replaceAll("-", "").slice(0, 16)}`,
          tenantId: f.domain.runtimeTenantId,
          projectId,
          sessionId,
          correlationId: sessionId,
          seq,
          type: "session.created",
          payloadJson: JSON.stringify({ marker }),
        })
        .run();
    append(1, "ontocode-before-revocation");
    const client = await openStream(
      `/v1/ontocode/sessions/${sessionId}/stream`,
      { authorization: `Bearer ${token}` },
    );
    await client.seen("ontocode-before-revocation");
    db.delete(apiTokens).where(eq(apiTokens.id, tokenId)).run();
    append(2, "forbidden-ontocode-frame");
    await client.closed();
    expect(client.body).not.toContain("forbidden-ontocode-frame");
  });
});
