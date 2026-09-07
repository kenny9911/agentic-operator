/**
 * The real Meta ERP transports, against local stand-ins for APIGW and the
 * portal.
 *
 * These cover the parts that cannot be checked by reading the code: that a
 * business failure carrying HTTP 200 fails the call, that the two gates keep
 * writes on the mock until they are opened deliberately, and that the UIAPI
 * login chain sends the four things the ablation study proved are load-bearing.
 */

import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  _clearMetaerpConfigCacheForTests,
  normalizeMetaerpPath,
  resolveMetaerpCredentials,
  resolveMetaerpPreset,
} from "./config";
import { normalizeMetaerpResponse } from "./envelope";
import { callMetaerpOpenapi, _clearMetaerpTokenCacheForTests } from "./openapi-transport";
import { callMetaerpUiapi, _clearMetaerpSessionCacheForTests } from "./uiapi-transport";
import { _clearMetaerpRoutesCacheForTests, resolveRoute } from "./routes";

interface Recorded {
  method: string;
  url: string;
  headers: http.IncomingHttpHeaders;
  body: string;
}

async function startServer(
  handler: (req: http.IncomingMessage, res: http.ServerResponse, body: string) => void,
): Promise<{ origin: string; seen: Recorded[]; close: () => Promise<void> }> {
  const seen: Recorded[] = [];
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      seen.push({
        method: req.method ?? "",
        url: req.url ?? "",
        headers: req.headers,
        body,
      });
      handler(req, res, body);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    origin: `http://127.0.0.1:${port}`,
    seen,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

const ENV_KEYS = [
  "METAERP_ENV",
  "METAERP_ACCOUNT",
  "METAERP_SECRET",
  "METAERP_PROJECT",
  "METAERP_RENTER_ID",
  "METAERP_PORTAL_USER",
  "METAERP_PORTAL_PASSWORD",
  "METAERP_APIGW_BASE",
  "METAERP_IAM_TOKEN_URL",
  "METAERP_CONSOLE_BASE",
  "METAERP_CSB_BASE",
  "METAERP_PORTAL_BASE",
  "METAERP_TRANSPORT_MODE",
  "METAERP_ALLOW_REAL_WRITES",
  "METAERP_CONFIG_FILE",
  "METAERP_DEFAULT_UNIT_CODE",
  "METAERP_DEFAULT_ORGANIZATION_CODE",
];

describe("metaerp real transports", () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of ENV_KEYS) saved[key] = process.env[key];
    // A config file that does not exist keeps the tests on env vars alone.
    process.env.METAERP_CONFIG_FILE = "/nonexistent/metaerp-config.local";
    process.env.METAERP_ENV = "v15";
    process.env.METAERP_ACCOUNT = "op_test";
    process.env.METAERP_SECRET = "s3cret";
    process.env.METAERP_PROJECT = "p0000000000000000000000000000001";
    process.env.METAERP_RENTER_ID = "1780520994662254112";
    delete process.env.METAERP_DEFAULT_UNIT_CODE;
    delete process.env.METAERP_DEFAULT_ORGANIZATION_CODE;
    _clearMetaerpConfigCacheForTests();
    _clearMetaerpTokenCacheForTests();
    _clearMetaerpSessionCacheForTests();
    _clearMetaerpRoutesCacheForTests();
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    _clearMetaerpConfigCacheForTests();
    _clearMetaerpRoutesCacheForTests();
  });

  // ── envelope ──────────────────────────────────────────────────────────────

  describe("response envelope", () => {
    const base = { operation: "queryPbpLine", status: 200, url: "http://erp/x" };

    it("unwraps data on SUCCESS", () => {
      expect(
        normalizeMetaerpResponse({ ...base, body: '{"status":"SUCCESS","data":{"rows":[1]}}' }),
      ).toEqual({ rows: [1] });
    });

    // The whole reason this module exists: the ERP reports business failures
    // with a 200, so status-code-only handling calls it a success and the agent
    // proceeds on nothing.
    it("throws on HTTP 200 + status:ERROR, quoting the business code", () => {
      expect(() =>
        normalizeMetaerpResponse({
          ...base,
          body: '{"status":"ERROR","message":"PBP-ServiceLogic-401069 采购业务计划头id,编号,行id不能同时为空"}',
        }),
      ).toThrow(/status=ERROR.*401069/s);
    });

    it("names the fix for an unauthorised appId", () => {
      expect(() =>
        normalizeMetaerpResponse({
          ...base,
          body: "AppId p000...1 couldn't access queryPbpLine",
        }),
      ).toThrow(/not authorised/);
    });

    it("names the fix for an unregistered path", () => {
      expect(() =>
        normalizeMetaerpResponse({ ...base, status: 404, body: "Service Not Found" }),
      ).toThrow(/not registered on this estate/);
    });

    it("tells a UI-form operation apart from an auth failure", () => {
      expect(() =>
        normalizeMetaerpResponse({
          ...base,
          body: '{"status":"ERROR","message":"userId is null! please check your x-meta-token"}',
        }),
      ).toThrow(/uiapi transport/);
    });

    it("fails a mock-shaped failure the same way a real one fails", () => {
      expect(() =>
        normalizeMetaerpResponse({ ...base, body: '{"ok":false,"error":"missing TASK_TYPE"}' }),
      ).toThrow(/missing TASK_TYPE/);
    });

    // A created document carries its own `status` — a plan comes back 草稿.
    // Reading that as an envelope verdict failed every successful create.
    it("does not mistake a business status field for an envelope verdict", () => {
      expect(
        normalizeMetaerpResponse({
          ...base,
          operation: "createPbp",
          body: '{"ok":true,"id":"PBP-1","status":"草稿","applied":true}',
        }),
      ).toEqual({ ok: true, id: "PBP-1", status: "草稿", applied: true });
    });

    it("passes through a bare array and an un-enveloped object", () => {
      expect(normalizeMetaerpResponse({ ...base, body: "[{\"a\":1}]" })).toEqual([{ a: 1 }]);
      expect(normalizeMetaerpResponse({ ...base, body: '{"ok":true,"id":"X"}' })).toEqual({
        ok: true,
        id: "X",
      });
    });
  });

  // ── path normalisation ────────────────────────────────────────────────────

  it("normalises registration paths onto the configured estate", () => {
    const preset = resolveMetaerpPreset("v15");
    // The inventory is recorded in /beta form; routes may carry either or none.
    expect(normalizeMetaerpPath("/beta/hsrm/srm/openapi/v1/queryPbpLine", preset)).toBe(
      "/v15/hsrm/srm/openapi/v1/queryPbpLine",
    );
    expect(normalizeMetaerpPath("/hsrm/srm/openapi/v1/queryPbpLine", preset)).toBe(
      "/v15/hsrm/srm/openapi/v1/queryPbpLine",
    );
    expect(normalizeMetaerpPath("/v15/hsrm/srm/openapi/v1/queryPbpLine", preset)).toBe(
      "/v15/hsrm/srm/openapi/v1/queryPbpLine",
    );
  });

  it("names the missing credential and the file it belongs in", () => {
    delete process.env.METAERP_RENTER_ID;
    _clearMetaerpConfigCacheForTests();
    expect(() => resolveMetaerpCredentials()).toThrow(/RENTER_ID.*config\.local/s);
  });

  // ── routing gates ─────────────────────────────────────────────────────────

  describe("routing gates", () => {
    it("keeps everything on the mock until the mode is 'real'", () => {
      const route = resolveRoute("queryPbpLine", "query");
      expect(route.transport).toBe("mock");
      expect(route.downgradedFrom).toBe("openapi");
      expect(route.downgradeReason).toMatch(/METAERP_TRANSPORT_MODE/);
    });

    it("lets reads through at mode 'real' but still holds writes back", () => {
      process.env.METAERP_TRANSPORT_MODE = "real";
      expect(resolveRoute("queryPbpLine", "query").transport).toBe("openapi");
      const write = resolveRoute("createPbp", "write");
      expect(write.transport).toBe("mock");
      expect(write.downgradeReason).toMatch(/METAERP_ALLOW_REAL_WRITES/);
    });

    it("releases writes only when that is said out loud too", () => {
      process.env.METAERP_TRANSPORT_MODE = "real";
      process.env.METAERP_ALLOW_REAL_WRITES = "true";
      expect(resolveRoute("createPbp", "write").transport).toBe("openapi");
    });

    it("leaves the operations ERP has no interface for on the mock", () => {
      process.env.METAERP_TRANSPORT_MODE = "real";
      process.env.METAERP_ALLOW_REAL_WRITES = "true";
      for (const operation of [
        "queryProcPackageHeader",
        "queryProcPackageLine",
        "queryTransactionOrders",
        "queryPurchaseCategory",
      ]) {
        const route = resolveRoute(operation, "query");
        expect(route.transport, operation).toBe("mock");
        // Not a downgrade — the table says mock on purpose.
        expect(route.downgradedFrom, operation).toBeUndefined();
      }
    });

    it("routes the two inventory reads through the portal, not APIGW", () => {
      process.env.METAERP_TRANSPORT_MODE = "real";
      expect(resolveRoute("queryReservation", "query").transport).toBe("uiapi");
      expect(resolveRoute("queryItemMinMaxLevel", "query").transport).toBe("uiapi");
    });
  });

  // ── openapi transport ─────────────────────────────────────────────────────

  describe("openapi transport", () => {
    it("mints a token once, sends it with the tenant header, and unwraps data", async () => {
      let mints = 0;
      const erp = await startServer((req, res) => {
        if (req.url?.endsWith("/iam/auth/token")) {
          mints += 1;
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ access_token: `tok-${mints}` }));
          return;
        }
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ status: "SUCCESS", data: { rows: [{ id: 1 }] } }));
      });
      process.env.METAERP_APIGW_BASE = erp.origin;
      process.env.METAERP_IAM_TOKEN_URL = `${erp.origin}/iam/auth/token`;
      _clearMetaerpConfigCacheForTests();

      const call = () =>
        callMetaerpOpenapi({
          operation: "queryPbpLine",
          path: "/hsrm/srm/openapi/v1/queryPbpLine",
          payload: { pbpNumber: "PBP202512030021" },
          credentials: resolveMetaerpCredentials(),
          timeoutMs: 5_000,
        });
      const first = await call();
      const second = await call();
      await erp.close();

      expect(first.data).toEqual({ rows: [{ id: 1 }] });
      expect(second.data).toEqual({ rows: [{ id: 1 }] });
      expect(mints, "token is cached across calls").toBe(1);
      const posted = erp.seen.filter((r) => r.url.includes("queryPbpLine"));
      expect(posted).toHaveLength(2);
      expect(posted[0]!.headers.authorization).toBe("tok-1");
      expect(posted[0]!.headers["x-renter-id"]).toBe("1780520994662254112");
      expect(posted[0]!.url).toBe("/v15/hsrm/srm/openapi/v1/queryPbpLine");
      expect(JSON.parse(posted[0]!.body)).toEqual({ pbpNumber: "PBP202512030021" });
    });

    // The first real run guessed the casing per call — unit_code, UNIT_CODE,
    // unitCode — and 12 of 13 calls failed. A deployment-wide constant in the
    // API's own spelling is the platform's job, not the model's.
    it("merges the deployment scope keys under the caller's payload", async () => {
      process.env.METAERP_DEFAULT_UNIT_CODE = "1000";
      process.env.METAERP_DEFAULT_ORGANIZATION_CODE = "YF1";
      const erp = await startServer((req, res) => {
        if (req.url?.endsWith("/iam/auth/token")) {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ access_token: "tok" }));
          return;
        }
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ status: "SUCCESS", data: {} }));
      });
      process.env.METAERP_APIGW_BASE = erp.origin;
      process.env.METAERP_IAM_TOKEN_URL = `${erp.origin}/iam/auth/token`;
      _clearMetaerpConfigCacheForTests();

      await callMetaerpOpenapi({
        operation: "queryPbpLine",
        path: "/hsrm/srm/openapi/v1/queryPbpLine",
        // An explicit value always wins over the deployment default.
        payload: { pbpNumber: "PBP-1", organizationCode: "OTHER" },
        credentials: resolveMetaerpCredentials(),
        timeoutMs: 5_000,
      });
      await erp.close();
      const sent = JSON.parse(
        erp.seen.find((r) => r.url.includes("queryPbpLine"))!.body,
      );
      expect(sent).toEqual({
        unitCode: "1000",
        organizationCode: "OTHER",
        pbpNumber: "PBP-1",
      });
    });

    it("re-mints once when a cached token has expired server-side", async () => {
      let mints = 0;
      let calls = 0;
      const erp = await startServer((req, res) => {
        if (req.url?.endsWith("/iam/auth/token")) {
          mints += 1;
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ access_token: `tok-${mints}` }));
          return;
        }
        calls += 1;
        if (calls === 1) {
          res.writeHead(401).end("token expired");
          return;
        }
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ status: "SUCCESS", data: { ok: true } }));
      });
      process.env.METAERP_APIGW_BASE = erp.origin;
      process.env.METAERP_IAM_TOKEN_URL = `${erp.origin}/iam/auth/token`;
      _clearMetaerpConfigCacheForTests();

      const result = await callMetaerpOpenapi({
        operation: "queryPbpLine",
        path: "/hsrm/srm/openapi/v1/queryPbpLine",
        payload: {},
        credentials: resolveMetaerpCredentials(),
        timeoutMs: 5_000,
      });
      await erp.close();
      expect(result.data).toEqual({ ok: true });
      expect(mints).toBe(2);
    });
  });

  // ── uiapi transport ───────────────────────────────────────────────────────

  describe("uiapi transport", () => {
    it("walks the login chain and sends cookie + csrf + referer", async () => {
      let logins = 0;
      const portal = await startServer((req, res) => {
        const url = req.url ?? "";
        if (url.includes("/gw/iam/auth/login")) {
          logins += 1;
          // The estate answers the first attempt with "already logged in"; the
          // client must retry asking for an additional session.
          if (logins === 1) {
            res.writeHead(401).end(JSON.stringify({ message: "Account logged in" }));
            return;
          }
          res.writeHead(200, {
            "set-cookie": ["X-Auth-Token=xat; Path=/", "login_flag=1; Path=/"],
            "content-type": "application/json",
          });
          res.end("{}");
          return;
        }
        if (url.includes("federation-callback")) {
          res.writeHead(302, {
            location: "/portal-landing",
            "set-cookie": ["CSB-Auth-Token=csb-abc; Path=/"],
          });
          res.end();
          return;
        }
        if (url === "/portal-landing") {
          res.writeHead(200).end("ok");
          return;
        }
        if (url.includes("getCurrentInfo")) {
          res.writeHead(200, { "x-csrf-token": "deadbeef", "content-type": "application/json" });
          res.end(JSON.stringify({ data: { user: { userId: "1" } } }));
          return;
        }
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ status: "SUCCESS", data: { totalRecords: "0" } }));
      });
      process.env.METAERP_CONSOLE_BASE = portal.origin;
      process.env.METAERP_CSB_BASE = portal.origin;
      process.env.METAERP_PORTAL_BASE = portal.origin;
      process.env.METAERP_PORTAL_USER = "admin@op";
      process.env.METAERP_PORTAL_PASSWORD = "pw";
      _clearMetaerpConfigCacheForTests();

      const result = await callMetaerpUiapi({
        operation: "queryReservation",
        path: "/gateway/hinv/minv/services/queryReservation",
        payload: { itemCode: "M-CAB-240" },
        credentials: resolveMetaerpCredentials(),
        timeoutMs: 5_000,
      });
      await portal.close();

      expect(result.data).toEqual({ totalRecords: "0" });
      expect(logins, "retries once with x-login-out:false").toBe(2);
      const retry = portal.seen.filter((r) => r.url.includes("/gw/iam/auth/login"))[1]!;
      expect(retry.headers["x-login-out"]).toBe("false");
      // Referer/Origin on login: without them the session cookie is planted on
      // the wrong domain and every later hop is anonymous.
      expect(retry.headers.referer).toBe(`${portal.origin}/epstenant/`);
      expect(retry.headers.origin).toBe(portal.origin);

      const call = portal.seen.find((r) => r.url.includes("queryReservation"))!;
      expect(call.headers["x-csrf-token"]).toBe("deadbeef");
      // The gateway reads the permission-point context from Referer; without it
      // the call fails as 权限点不存在, which reads like a permissions problem.
      expect(call.headers.referer).toBe(`${portal.origin}/`);
      expect(call.headers.cookie).toContain("CSB-Auth-Token=csb-abc");
      expect(JSON.parse(call.body)).toEqual({ itemCode: "M-CAB-240" });
    });

    it("says which credential is missing rather than failing as a 401 later", async () => {
      delete process.env.METAERP_PORTAL_USER;
      delete process.env.METAERP_PORTAL_PASSWORD;
      _clearMetaerpConfigCacheForTests();
      await expect(
        callMetaerpUiapi({
          operation: "queryReservation",
          path: "/gateway/hinv/minv/services/queryReservation",
          payload: {},
          credentials: resolveMetaerpCredentials(),
          timeoutMs: 5_000,
        }),
      ).rejects.toThrow(/PORTAL_USER\/PORTAL_PASSWORD/);
    });

    it("fails closed when federation plants no session cookie", async () => {
      const portal = await startServer((req, res) => {
        if ((req.url ?? "").includes("/gw/iam/auth/login")) {
          res.writeHead(200, { "content-type": "application/json" }).end("{}");
          return;
        }
        res.writeHead(200).end("no cookie for you");
      });
      process.env.METAERP_CONSOLE_BASE = portal.origin;
      process.env.METAERP_CSB_BASE = portal.origin;
      process.env.METAERP_PORTAL_BASE = portal.origin;
      process.env.METAERP_PORTAL_USER = "admin@op";
      process.env.METAERP_PORTAL_PASSWORD = "pw";
      _clearMetaerpConfigCacheForTests();

      await expect(
        callMetaerpUiapi({
          operation: "queryReservation",
          path: "/gateway/hinv/minv/services/queryReservation",
          payload: {},
          credentials: resolveMetaerpCredentials(),
          timeoutMs: 5_000,
        }),
      ).rejects.toThrow(/CSB-Auth-Token/);
      await portal.close();
    });
  });
});
