/**
 * TC-27 — P3-API-01 POST /v1/tenants/:slug/code + P3-API-02 rollback.
 *
 * End-to-end: builds a synthetic tar.gz with a single `agentic.json`,
 * POSTs to /v1/tenants/raas/code, asserts:
 *   - 201 with a deployment id + version
 *   - On-disk `data/tenants/raas/<version>/agentic.json` exists
 *   - A `deployments` row with target='tenant_code' status='live' lands.
 *   - A second upload of a NEW version flips the prior to rolled_back.
 *   - Rollback of the first deployment flips it back to live.
 *
 * Uses the in-process auth dev mode pinned to RAAS so the tenant matches
 * the route's `:slug` param.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";
import zlib from "node:zlib";
import { promisify } from "node:util";
import { and, eq } from "drizzle-orm";

const gzip = promisify(zlib.gzip);

// Build a minimal POSIX tar with a single agentic.json entry, then gzip it.
// Compatible with our tenant-code route's parser.
function buildSingleFileTar(name: string, content: string): Buffer {
  const data = Buffer.from(content, "utf8");
  const header = Buffer.alloc(512);
  // name (100)
  header.write(name, 0, 100, "utf8");
  // mode (8) — "0000644 "
  header.write("0000644", 100, 7, "utf8");
  header.write("\0", 107, 1, "utf8");
  // uid (8)
  header.write("0000000", 108, 7, "utf8");
  header.write("\0", 115, 1, "utf8");
  // gid (8)
  header.write("0000000", 116, 7, "utf8");
  header.write("\0", 123, 1, "utf8");
  // size (12, octal) — padded with leading zeros
  const sizeOct = data.length.toString(8).padStart(11, "0") + " ";
  header.write(sizeOct, 124, 12, "utf8");
  // mtime (12) — zero is fine
  header.write("00000000000 ", 136, 12, "utf8");
  // checksum (8) — fill with spaces first, compute, write
  for (let i = 148; i < 156; i++) header[i] = 0x20;
  // typeflag (1) — '0' = regular file
  header.write("0", 156, 1, "utf8");
  // linkname (100) — empty
  // magic + version "ustar\0" + "00"
  header.write("ustar\0", 257, 6, "utf8");
  header.write("00", 263, 2, "utf8");
  // checksum: sum of header bytes
  let sum = 0;
  for (let i = 0; i < 512; i++) sum += header[i] ?? 0;
  const cksum = sum.toString(8).padStart(6, "0") + "\0 ";
  header.write(cksum, 148, 8, "utf8");
  // Pad data to 512
  const padded = Buffer.alloc(Math.ceil(data.length / 512) * 512);
  data.copy(padded, 0);
  // 2x 512-byte zero blocks terminate the archive
  const tail = Buffer.alloc(1024);
  return Buffer.concat([header, padded, tail]);
}

const FIXTURE_DIR = path.join(os.tmpdir(), "agentic-tc27-tenants-");
let tmpRoot: string;
const ORIG_TENANTS_DIR = process.env.AGENTIC_TENANTS_DIR;
const ORIG_DEV_TENANT = process.env.AGENTIC_DEV_TENANT;

beforeAll(async () => {
  tmpRoot = await fs.mkdtemp(FIXTURE_DIR);
  process.env.AGENTIC_TENANTS_DIR = tmpRoot;
  process.env.AGENTIC_DEV_TENANT = "raas";
});

afterAll(async () => {
  if (ORIG_TENANTS_DIR === undefined) delete process.env.AGENTIC_TENANTS_DIR;
  else process.env.AGENTIC_TENANTS_DIR = ORIG_TENANTS_DIR;
  if (ORIG_DEV_TENANT === undefined) delete process.env.AGENTIC_DEV_TENANT;
  else process.env.AGENTIC_DEV_TENANT = ORIG_DEV_TENANT;
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

describe("TC-27: P3-API-01 + P3-API-02 tenant code upload + rollback", () => {
  it("POST /v1/tenants/raas/code accepts a tarball and lands a deployment", async () => {
    const { buildTestEnv } = await import("./harness");
    const env = await buildTestEnv();
    const version = "0.1.0";

    const manifest = JSON.stringify({
      slug: "raas",
      name: "RAAS dynamic",
      schemaVersion: 1,
    });
    const tar = buildSingleFileTar("agentic.json", manifest);
    const gzipped = await gzip(tar);
    const tarballBase64 = gzipped.toString("base64");

    const res = await env.fetch("/v1/tenants/raas/code", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ version, tarballBase64, note: "tc-27" }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      ok: boolean;
      data: { deployment_id: string; slug: string; version: string };
    };
    expect(body.ok).toBe(true);
    expect(body.data.slug).toBe("raas");
    expect(body.data.version).toBe(version);

    // On-disk fixture lands.
    const expectedDir = path.join(tmpRoot, "raas", version);
    const manifestPath = path.join(expectedDir, "agentic.json");
    const onDisk = JSON.parse(await fs.readFile(manifestPath, "utf8")) as {
      slug: string;
    };
    expect(onDisk.slug).toBe("raas");

    // DB row exists with target='tenant_code' and status='live'.
    const { getDb, deployments } = await import("@agentic/db");
    const db = getDb();
    const row = db
      .select()
      .from(deployments)
      .where(eq(deployments.id, body.data.deployment_id))
      .all()[0];
    expect(row).toBeDefined();
    expect(row?.target).toBe("tenant_code");
    expect(row?.status).toBe("live");
  });

  it("uploading a new version flips the prior to rolled_back", async () => {
    const { buildTestEnv } = await import("./harness");
    const env = await buildTestEnv();
    const version = "0.2.0";

    const manifest = JSON.stringify({
      slug: "raas",
      name: "RAAS dynamic v2",
      schemaVersion: 1,
    });
    const tar = buildSingleFileTar("agentic.json", manifest);
    const gzipped = await gzip(tar);
    const tarballBase64 = gzipped.toString("base64");

    const res = await env.fetch("/v1/tenants/raas/code", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ version, tarballBase64 }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      ok: boolean;
      data: { deployment_id: string };
    };
    expect(body.ok).toBe(true);

    const { getDb, deployments, tenants } = await import("@agentic/db");
    const db = getDb();
    const tenant = db.select().from(tenants).where(eq(tenants.slug, "raas")).all()[0];
    expect(tenant).toBeDefined();

    // Exactly one tenant_code deployment is live for raas.
    const live = db
      .select()
      .from(deployments)
      .where(
        and(
          eq(deployments.tenantId, tenant!.id),
          eq(deployments.target, "tenant_code"),
          eq(deployments.status, "live"),
        ),
      )
      .all();
    expect(live.length).toBe(1);
    expect(live[0]?.id).toBe(body.data.deployment_id);
  });

  it("rollback flips the live pointer back to the prior deployment", async () => {
    const { buildTestEnv } = await import("./harness");
    const env = await buildTestEnv();

    const { getDb, deployments, tenants } = await import("@agentic/db");
    const db = getDb();
    const tenant = db.select().from(tenants).where(eq(tenants.slug, "raas")).all()[0]!;

    // Find the most recently-rolled-back tenant_code deployment (the v0.1.0
    // one demoted by the v0.2.0 upload above) and try to rollback to it.
    const rolledBack = db
      .select()
      .from(deployments)
      .where(
        and(
          eq(deployments.tenantId, tenant.id),
          eq(deployments.target, "tenant_code"),
          eq(deployments.status, "rolled_back"),
        ),
      )
      .all();
    expect(rolledBack.length).toBeGreaterThanOrEqual(1);
    const targetId = rolledBack[rolledBack.length - 1]!.id;

    const res = await env.fetch(`/v1/deployments/${targetId}/rollback`, {
      method: "POST",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      data: { status: string; target: string };
    };
    expect(body.ok).toBe(true);
    expect(body.data.status).toBe("live");
    expect(body.data.target).toBe("tenant_code");

    // DB reflects the flip.
    const after = db
      .select()
      .from(deployments)
      .where(eq(deployments.id, targetId))
      .all()[0];
    expect(after?.status).toBe("live");
  });
});
