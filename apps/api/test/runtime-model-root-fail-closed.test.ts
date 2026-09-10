import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { eq } from "drizzle-orm";
import { deployments, getDb, tenants } from "@agentic/db";
import { makeId } from "@agentic/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  bootstrapAll,
  bootstrapAllByTenant,
  FatalRuntimeBootstrapError,
} from "@agentic/runtime";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("runtime model discovery readiness", () => {
  it("boots a readable empty model root so the first workflow can be authored", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "empty-domain-models-"));
    const owner = {
      id: makeId("ten"),
      slug: makeId("empty-models"),
      name: "Empty model owner",
    };
    getDb().insert(tenants).values(owner).run();
    vi.stubEnv("AGENTIC_MODELS_DIR", root);
    try {
      expect(
        (await bootstrapAllByTenant({}, { enabledTenantSlugs: [owner.slug] }))
          .size,
      ).toBe(0);
      getDb()
        .insert(deployments)
        .values({
          id: makeId("dpl"),
          tenantId: owner.id,
          target: "workflow",
          versionId: makeId("wfv"),
          status: "live",
        })
        .run();
      await expect(
        bootstrapAllByTenant({}, { enabledTenantSlugs: [owner.slug] }),
      ).rejects.toThrow(
        "no tenant model folders found for enabled live workflows",
      );
    } finally {
      getDb().delete(tenants).where(eq(tenants.id, owner.id)).run();
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails startup when the configured models root is unreadable", async () => {
    vi.stubEnv(
      "AGENTIC_MODELS_DIR",
      path.join(
        "/definitely-missing-agentic-model-root",
        `${process.pid}-${Date.now()}`,
      ),
    );

    await expect(bootstrapAll()).rejects.toBeInstanceOf(
      FatalRuntimeBootstrapError,
    );
  });
});
