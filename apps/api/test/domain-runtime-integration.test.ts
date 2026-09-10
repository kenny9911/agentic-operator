/**
 * Real deterministic manifest bootstrap, handler execution, durable outputs and
 * monitor queries. The step executor below is in-process; this proves the
 * runtime/data boundary, not a live Inngest broker or external model call.
 */
import path from "node:path";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import {
  domains,
  deployments,
  events,
  eventStore,
  getDb,
  runs,
  steps,
  tenantRuntimeNamespaces,
  tenants,
  workflows,
} from "@agentic/db";
import {
  bootstrapAllByTenant,
  bootstrapTenantBySlug,
  isDomainRuntimeActive,
  AgentSchema,
  registerCronTriggers,
  subscribeStreamEvents,
  activeBlobBackend,
  setBlobRemoteBackend,
  type InngestFunction,
} from "@agentic/runtime";
import { makeId } from "@agentic/shared";
import { getRun, listRunsPaged } from "../src/queries/runs";
import { enabledTenantDeploymentScope } from "../src/services/tenant-deployment-scope";
import { transitionTenantLifecycle } from "../src/services/tenant-lifecycle";
import { archiveDomain, restoreDomain } from "../src/services/domains";

type RuntimeFunction = {
  fn: (context: Record<string, unknown>) => Promise<unknown>;
};
type Delivery = { id?: string; name: string; data: Record<string, unknown> };
const suffix = makeId("check")
  .replace(/[^a-z0-9]/gi, "")
  .toLowerCase()
  .slice(-12);
const owner = {
  id: makeId("ten"),
  slug: `domain-owner-${suffix}`,
  name: "Runtime domain owner",
};
const siblings = ["alpha", "beta"].map((slug) => ({
  id: makeId("dom"),
  tenantId: owner.id,
  slug,
  name: "Same business name",
  runtimeTenantId: makeId("ten"),
  runtimeTenantSlug: `domain-${slug}-${suffix}`,
}));
const modelDirs: string[] = [];
const functions = new Map<string, InngestFunction.Any[]>();
const observed = new Map<string, Array<{ tenantId: string; type: string }>>();
const unsubscribe: Array<() => void> = [];

function manifest() {
  return [
    { id: "intake", name: "intake", trigger: ["REQUEST"], emitted: "HANDOFF" },
    {
      id: "finish",
      name: "finish",
      trigger: ["HANDOFF"],
      emitted: "COMPLETED",
    },
  ].map(({ emitted, ...agent }) => ({
    ...agent,
    actor: ["Agent"],
    retries: 0,
    tool_use: [{ name: "meta.ping" }],
    actions: [
      { order: "1", name: "meta.ping", type: "tool", result_key: "context" },
    ],
    triggered_event: [emitted],
  }));
}

async function executeChain(runtimeSlug: string): Promise<Delivery[]> {
  const served = functions.get(runtimeSlug)!;
  const queue: Delivery[] = [
    { name: `${runtimeSlug}/REQUEST`, data: { subject: "same-subject" } },
  ];
  const dispatched: Delivery[] = [];
  while (queue.length) {
    const event = queue.shift()!;
    const index =
      event.name === `${runtimeSlug}/REQUEST`
        ? 0
        : event.name === `${runtimeSlug}/HANDOFF`
          ? 1
          : -1;
    if (index === -1) continue;
    const result = await (served[index] as unknown as RuntimeFunction).fn({
      event,
      step: {
        run: async (
          _id: unknown,
          operation: (...args: unknown[]) => unknown,
          ...args: unknown[]
        ) => operation(...args),
        sendEvent: async (_id: unknown, payload: Delivery | Delivery[]) => {
          const deliveries = Array.isArray(payload) ? payload : [payload];
          dispatched.push(...deliveries);
          queue.push(...deliveries);
          return {
            ids: deliveries.map((delivery) => delivery.id ?? makeId("evt")),
          };
        },
      },
      logger: { info() {}, warn() {}, error() {} },
      attempt: 0,
    });
    expect(result).toMatchObject({ ok: true });
  }
  return dispatched;
}

describe.sequential("Tenant -> Domains runtime lifecycle", () => {
  beforeAll(async () => {
    const db = getDb();
    db.insert(tenants).values(owner).run();
    for (const sibling of siblings) {
      db.insert(tenants)
        .values({
          id: sibling.runtimeTenantId,
          slug: sibling.runtimeTenantSlug,
          name: "Private execution namespace",
        })
        .run();
      const { runtimeTenantSlug, ...domain } = sibling;
      db.insert(domains).values(domain).run();
      const dir = path.join(
        process.env.AGENTIC_MODELS_DIR!,
        `${runtimeTenantSlug}-v1`,
      );
      modelDirs.push(dir);
      await mkdir(dir, { recursive: true });
      await writeFile(
        path.join(dir, "workflow.json"),
        JSON.stringify(manifest()),
      );
      const served = await bootstrapTenantBySlug(runtimeTenantSlug);
      expect(served).toHaveLength(2);
      functions.set(runtimeTenantSlug, served);
      // Identical workflow, Agent and Event names are legal under siblings.
      db.update(workflows)
        .set({ slug: "shared-workflow", name: "Shared workflow" })
        .where(eq(workflows.tenantId, sibling.runtimeTenantId))
        .run();
      observed.set(sibling.runtimeTenantId, []);
      unsubscribe.push(
        subscribeStreamEvents(sibling.runtimeTenantId, (event) =>
          observed.get(sibling.runtimeTenantId)!.push(event),
        ),
      );
    }
  });

  afterAll(async () => {
    unsubscribe.forEach((stop) => stop());
    const db = getDb();
    db.delete(domains).where(eq(domains.tenantId, owner.id)).run();
    db.delete(tenants)
      .where(
        inArray(tenants.id, [
          owner.id,
          ...siblings.map((domain) => domain.runtimeTenantId),
        ]),
      )
      .run();
    await Promise.all(
      modelDirs.map((dir) => rm(dir, { recursive: true, force: true })),
    );
  });

  it("deploys and executes identical sibling workflows without crossing event, storage or monitoring scopes", async () => {
    const db = getDb();
    for (const [index, sibling] of siblings.entries()) {
      const priorSiblingEvents = observed.get(
        siblings[1 - index]!.runtimeTenantId,
      )!.length;
      const dispatched = await executeChain(sibling.runtimeTenantSlug);
      expect(dispatched.map((event) => event.name)).toEqual([
        `${sibling.runtimeTenantSlug}/HANDOFF`,
        `${sibling.runtimeTenantSlug}/COMPLETED`,
      ]);
      expect(observed.get(siblings[1 - index]!.runtimeTenantId)).toHaveLength(
        priorSiblingEvents,
      );
      const ownEvents = observed.get(sibling.runtimeTenantId)!;
      expect(ownEvents.length).toBeGreaterThan(0);
      expect(
        ownEvents.every((event) => event.tenantId === sibling.runtimeTenantId),
      ).toBe(true);
      const ownRuns = db
        .select()
        .from(runs)
        .where(eq(runs.tenantId, sibling.runtimeTenantId))
        .all();
      expect(ownRuns).toHaveLength(2);
      expect(
        ownRuns.every(
          (run) => run.status === "ok" && run.subject === "same-subject",
        ),
      ).toBe(true);
      expect(new Set(ownRuns.map((run) => run.correlationId)).size).toBe(1);
      for (const run of ownRuns) {
        expect(run.logPath).toContain(
          `${path.sep}${sibling.runtimeTenantSlug}${path.sep}`,
        );
        expect((await readFile(run.logPath!, "utf8")).length).toBeGreaterThan(
          0,
        );
        const executionSteps = db
          .select()
          .from(steps)
          .where(eq(steps.runId, run.id))
          .all();
        expect(
          executionSteps.some(
            (step) => step.type === "tool" && step.status === "ok",
          ),
        ).toBe(true);
        const outputStep = executionSteps.find(
          (step) => step.type === "tool" && step.outputRef,
        )!;
        const output = await readFile(outputStep.outputRef!, "utf8");
        expect(output).toContain(sibling.runtimeTenantSlug);
        expect(output).toMatch(/"pong"\s*:\s*true/);
        expect(
          await getRun(siblings[1 - index]!.runtimeTenantSlug, run.id),
        ).toBeNull();
        expect(await getRun(sibling.runtimeTenantSlug, run.id)).toMatchObject({
          id: run.id,
          status: "ok",
        });
      }
      expect((await listRunsPaged(sibling.runtimeTenantSlug)).total).toBe(2);
      expect(
        db
          .select()
          .from(events)
          .where(eq(events.tenantId, sibling.runtimeTenantId))
          .all(),
      ).toHaveLength(2);
      expect(
        db
          .select()
          .from(eventStore)
          .where(eq(eventStore.tenantId, sibling.runtimeTenantId))
          .all(),
      ).toHaveLength(2);
      expect(
        db
          .select()
          .from(deployments)
          .where(
            and(
              eq(deployments.tenantId, sibling.runtimeTenantId),
              eq(deployments.target, "workflow"),
              eq(deployments.status, "live"),
            ),
          )
          .all(),
      ).toHaveLength(1);
      expect(
        await bootstrapTenantBySlug(sibling.runtimeTenantSlug),
      ).toHaveLength(2);
      expect(
        db
          .select()
          .from(workflows)
          .where(eq(workflows.tenantId, sibling.runtimeTenantId))
          .all(),
      ).toHaveLength(1);
    }
    expect((await listRunsPaged(owner.slug)).total).toBe(0);
  });

  it("inherits owning Tenant process scope without enabling an unrelated owner", () => {
    const scope = enabledTenantDeploymentScope({
      AGENTIC_ENABLED_TENANTS: owner.slug,
    })!;
    expect([...scope]).toEqual(
      expect.arrayContaining([
        owner.slug,
        ...siblings.map((domain) => domain.runtimeTenantSlug),
      ]),
    );
    expect(
      enabledTenantDeploymentScope({
        AGENTIC_ENABLED_TENANTS: "unrelated-owner",
      })!.has(siblings[0]!.runtimeTenantSlug),
    ).toBe(false);
  });

  it.each(["domain", "owner"] as const)(
    "rejects a new Run when its %s is archived during asynchronous payload hydration",
    async (scope) => {
      const sibling = siblings[0]!;
      const db = getDb();
      const priorRuns = db
        .select()
        .from(runs)
        .where(eq(runs.tenantId, sibling.runtimeTenantId))
        .all();
      const priorEvents = observed.get(sibling.runtimeTenantId)!.length;
      const previousBackend = activeBlobBackend();
      const content = `Hydration race ${scope} ${makeId("blob")}`;
      const hash = createHash("sha256").update(content).digest("hex");
      let fetched = false;
      let archived = false;
      const emitted: unknown[] = [];
      const ownerLifecycle = {
        tenantId: owner.id,
        slug: owner.slug,
        actorUserId: null,
        callerSlug: owner.slug,
      };
      setBlobRemoteBackend({
        name: "domain-archive-race",
        put: async () => undefined,
        get: async (requestedHash) => {
          expect(requestedHash).toBe(hash);
          fetched = true;
          if (scope === "domain") {
            await archiveDomain(
              owner.id,
              sibling.id,
              sibling.slug,
              null,
              async () => undefined,
            );
          } else {
            await transitionTenantLifecycle(
              { ...ownerLifecycle, action: "archive" },
              async () => undefined,
            );
          }
          archived = true;
          return content;
        },
      });
      try {
        await expect(
          (
            functions.get(
              sibling.runtimeTenantSlug,
            )![0] as unknown as RuntimeFunction
          ).fn({
            event: {
              name: `${sibling.runtimeTenantSlug}/REQUEST`,
              data: {
                subject: "archive-during-hydration",
                document: {
                  __ref: "blob",
                  hash,
                  bytes: Buffer.byteLength(content),
                },
              },
            },
            step: {
              run: async (
                _id: unknown,
                operation: (...args: unknown[]) => unknown,
                ...args: unknown[]
              ) => operation(...args),
              sendEvent: async (_id: unknown, payload: unknown) => {
                emitted.push(payload);
                return { ids: [] };
              },
            },
            logger: { info() {}, warn() {}, error() {} },
            attempt: 0,
          }),
        ).rejects.toThrow("Domain runtime is unavailable");
        expect(fetched).toBe(true);
        expect(archived).toBe(true);
        expect(
          db
            .select()
            .from(runs)
            .where(eq(runs.tenantId, sibling.runtimeTenantId))
            .all(),
        ).toEqual(priorRuns);
        expect(observed.get(sibling.runtimeTenantId)).toHaveLength(priorEvents);
        expect(emitted).toEqual([]);
      } finally {
        setBlobRemoteBackend(previousBackend);
        if (archived) {
          if (scope === "domain")
            await restoreDomain(
              owner.id,
              sibling.id,
              null,
              async () => undefined,
            );
          else
            await transitionTenantLifecycle(
              { ...ownerLifecycle, action: "restore" },
              async () => undefined,
            );
        }
      }
    },
  );

  it("keeps an archived Domain inert while its sibling and parent remain active", async () => {
    const sibling = siblings[0]!;
    const cron = registerCronTriggers({
      tenantSlug: sibling.runtimeTenantSlug,
      manifest: [AgentSchema.parse({ ...manifest()[0], cron: "@hourly" })],
    }).functions[0]!;
    const cronEmissions: unknown[] = [];
    const tick = () =>
      (cron as unknown as RuntimeFunction).fn({
        step: {
          sendEvent: async (_id: unknown, payload: unknown) => {
            cronEmissions.push(payload);
          },
        },
      });
    await expect(tick()).resolves.toMatchObject({ ok: true });
    expect(cronEmissions).toHaveLength(1);
    getDb()
      .update(domains)
      .set({ archivedAt: new Date() })
      .where(eq(domains.id, sibling.id))
      .run();
    try {
      expect(isDomainRuntimeActive(sibling.runtimeTenantId)).toBe(false);
      expect(isDomainRuntimeActive(siblings[1]!.runtimeTenantId)).toBe(true);
      expect(isDomainRuntimeActive(owner.id)).toBe(true);
      expect(
        await bootstrapTenantBySlug(sibling.runtimeTenantSlug),
      ).toHaveLength(0);
      const reloaded = await bootstrapAllByTenant(
        {},
        {
          enabledTenantSlugs: siblings.map(
            (domain) => domain.runtimeTenantSlug,
          ),
        },
      );
      expect(reloaded.get(sibling.runtimeTenantSlug)).toEqual([]);
      expect(reloaded.get(siblings[1]!.runtimeTenantSlug)).toHaveLength(2);
      // The old served closure itself must reject a late broker delivery.
      await expect(executeChain(sibling.runtimeTenantSlug)).rejects.toThrow(
        "Domain runtime is unavailable",
      );
      await expect(tick()).resolves.toMatchObject({
        skipped: true,
        reason: "domain_unavailable",
      });
      expect(cronEmissions).toHaveLength(1);
    } finally {
      getDb()
        .update(domains)
        .set({ archivedAt: null })
        .where(eq(domains.id, sibling.id))
        .run();
    }
  });

  it("archives/restores every child runtime registration and preserves individual Domain lifecycle", async () => {
    const synced: Array<{ slug: string; active: boolean }> = [];
    const sync = async (slug: string) => {
      const namespace = getDb()
        .select()
        .from(tenants)
        .where(eq(tenants.slug, slug))
        .get()!;
      synced.push({ slug, active: isDomainRuntimeActive(namespace.id) });
      return bootstrapTenantBySlug(slug);
    };
    const args = {
      tenantId: owner.id,
      slug: owner.slug,
      actorUserId: null,
      callerSlug: owner.slug,
    };
    await transitionTenantLifecycle({ ...args, action: "archive" }, sync);
    expect(synced).toHaveLength(3);
    expect(synced.every((entry) => !entry.active)).toBe(true);
    await expect(executeChain(siblings[1]!.runtimeTenantSlug)).rejects.toThrow(
      "Domain runtime is unavailable",
    );
    expect(
      getDb()
        .select()
        .from(domains)
        .where(eq(domains.tenantId, owner.id))
        .all()
        .every((row) => row.archivedAt === null),
    ).toBe(true);
    synced.length = 0;
    await transitionTenantLifecycle({ ...args, action: "restore" }, sync);
    expect(synced).toHaveLength(3);
    expect(synced.every((entry) => entry.active)).toBe(true);
  });

  it("blocks parent archive when a sibling has a held run", async () => {
    const db = getDb();
    const run = db
      .select()
      .from(runs)
      .where(eq(runs.tenantId, siblings[1]!.runtimeTenantId))
      .get()!;
    db.update(runs).set({ status: "paused" }).where(eq(runs.id, run.id)).run();
    try {
      await expect(
        transitionTenantLifecycle(
          {
            tenantId: owner.id,
            slug: owner.slug,
            action: "archive",
            actorUserId: null,
            callerSlug: owner.slug,
          },
          async () => {
            throw new Error(
              "No broker mutation should occur while active work exists",
            );
          },
        ),
      ).rejects.toMatchObject({ code: "has_active_work", statusCode: 409 });
      expect(isDomainRuntimeActive(siblings[1]!.runtimeTenantId)).toBe(true);
    } finally {
      db.update(runs)
        .set({ status: run.status })
        .where(eq(runs.id, run.id))
        .run();
    }
  });

  it("compensates every child registration when one child rejects parent archive", async () => {
    let failed = false;
    const synced: Array<{ slug: string; active: boolean }> = [];
    await expect(
      transitionTenantLifecycle(
        {
          tenantId: owner.id,
          slug: owner.slug,
          action: "archive",
          actorUserId: null,
          callerSlug: owner.slug,
        },
        async (slug) => {
          const namespace = getDb()
            .select()
            .from(tenants)
            .where(eq(tenants.slug, slug))
            .get()!;
          synced.push({ slug, active: isDomainRuntimeActive(namespace.id) });
          if (slug === siblings[0]!.runtimeTenantSlug && !failed) {
            failed = true;
            throw new Error("Rejected child registration");
          }
          return bootstrapTenantBySlug(slug);
        },
      ),
    ).rejects.toMatchObject({ code: "inngest_sync_failed", statusCode: 503 });
    expect(synced).toHaveLength(6);
    expect(synced.slice(0, 3).every((entry) => !entry.active)).toBe(true);
    expect(synced.slice(3).every((entry) => entry.active)).toBe(true);
  });

  it("preserves lifecycle enforcement for a legacy compatibility namespace without inventing a Domain", async () => {
    const db = getDb();
    const legacy = {
      id: makeId("ten"),
      slug: `compatibility-${suffix}`,
      name: "Legacy namespace",
    };
    db.insert(tenants).values(legacy).run();
    db.insert(tenantRuntimeNamespaces)
      .values({ tenantId: legacy.id, businessDomainTenantId: owner.id })
      .run();
    const dir = path.join(process.env.AGENTIC_MODELS_DIR!, `${legacy.slug}-v1`);
    const args = {
      tenantId: owner.id,
      slug: owner.slug,
      actorUserId: null,
      callerSlug: owner.slug,
    };
    const synchronized: string[] = [];
    const sync = async (slug: string) => {
      synchronized.push(slug);
      return bootstrapTenantBySlug(slug);
    };
    try {
      await mkdir(dir, { recursive: true });
      await writeFile(
        path.join(dir, "workflow.json"),
        JSON.stringify(manifest()),
      );
      functions.set(legacy.slug, await bootstrapTenantBySlug(legacy.slug));
      expect(functions.get(legacy.slug)).toHaveLength(2);
      expect(isDomainRuntimeActive(legacy.id)).toBe(true);
      expect(
        enabledTenantDeploymentScope({
          AGENTIC_ENABLED_TENANTS: owner.slug,
        })!.has(legacy.slug),
      ).toBe(true);
      await transitionTenantLifecycle({ ...args, action: "archive" }, sync);
      expect(synchronized).toContain(legacy.slug);
      expect(isDomainRuntimeActive(legacy.id)).toBe(false);
      expect(await bootstrapTenantBySlug(legacy.slug)).toHaveLength(0);
      await expect(executeChain(legacy.slug)).rejects.toThrow(
        "Domain runtime is unavailable",
      );
      await transitionTenantLifecycle({ ...args, action: "restore" }, sync);
      expect(isDomainRuntimeActive(legacy.id)).toBe(true);
      expect(await bootstrapTenantBySlug(legacy.slug)).toHaveLength(2);
      db.update(tenantRuntimeNamespaces)
        .set({ status: "archived", archivedAt: new Date() })
        .where(eq(tenantRuntimeNamespaces.tenantId, legacy.id))
        .run();
      expect(isDomainRuntimeActive(legacy.id)).toBe(false);
      expect(await bootstrapTenantBySlug(legacy.slug)).toHaveLength(0);
      expect(
        db
          .select()
          .from(domains)
          .where(eq(domains.runtimeTenantId, legacy.id))
          .all(),
      ).toHaveLength(0);
    } finally {
      db.update(tenants)
        .set({ archivedAt: null })
        .where(eq(tenants.id, owner.id))
        .run();
      db.delete(tenants).where(eq(tenants.id, legacy.id)).run();
      await rm(dir, { recursive: true, force: true });
    }
  });
});
