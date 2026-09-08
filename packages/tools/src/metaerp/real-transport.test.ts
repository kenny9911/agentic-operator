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
import {
  _applyLineScopeForTests,
  _assertWriteReceiptForTests,
  _markAppliedForTests,
} from "./invoke";

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

    // 全局开关是「全放行」，粒度太粗：演示只要调拨单落进真实 ERP，而同一批路由里
    // 还有 changePbp——那会改掉一张真实的采购计划。
    it("lets one named write through while the global gate stays shut", () => {
      process.env.METAERP_TRANSPORT_MODE = "real";
      expect(resolveRoute("createTransactionOrder", "write").transport).toBe("openapi");
      const held = resolveRoute("changePbp", "write");
      expect(held.transport).toBe("mock");
      expect(held.downgradeReason).toMatch(/METAERP_ALLOW_REAL_WRITES/);
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

    // queryPbpHeader 不支持全量列举，所以路由表替它钉住范围；调用方给了单号则以
    // 调用方为准，否则演示至少查得到东西而不是收一个 401069。
    it("carries per-operation defaults, under the caller and over the deployment keys", () => {
      process.env.METAERP_TRANSPORT_MODE = "real";
      // 演示锚点用 overrides 而非 defaults：defaults 是「没给才补」，挡不住模型
      // 自己编一个过滤条件——实测它编过 PR-2026-11832 这个不存在的单号。
      expect(resolveRoute("queryPr", "query").overrides).toEqual({
        prNumberList: ["100020260902000001"],
      });
      expect(resolveRoute("queryPbpHeader", "query").defaults).toBeUndefined();
    });

    // 需求来自真实 ERP（物料 10000007/8/9），可调库存却查的是 mock 的三行种子
    // （M-BRK-126…）——两套编码体系，调拨量因此恒为 0。
    it("takes transferable stock from the real on-hand endpoint", () => {
      process.env.METAERP_TRANSPORT_MODE = "real";
      const route = resolveRoute("queryTransferableStock", "query");
      expect(route.transport).toBe("openapi");
      expect(route.path).toContain("multiOnhandQuantityQuery");
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

    // defaults 让调用方赢，overrides 让平台赢——演示范围不能被模型编的过滤条件顶掉。
    it("lets the platform's overrides beat the caller's own filter", async () => {
      const erp = await startServer((req, res) => {
        if (req.url?.endsWith("/iam/auth/token")) {
          res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ access_token: "tok" }));
          return;
        }
        res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ status: "SUCCESS", data: {} }));
      });
      process.env.METAERP_APIGW_BASE = erp.origin;
      process.env.METAERP_IAM_TOKEN_URL = `${erp.origin}/iam/auth/token`;
      _clearMetaerpConfigCacheForTests();

      await callMetaerpOpenapi({
        operation: "queryPr",
        path: "/hpo/mpr/openapi/v1/queryPr",
        payload: { prNumberList: ["PR-2026-11832"], unitCode: "9999" },
        defaults: { unitCode: "1000" },
        overrides: { prNumberList: ["100020260902000001"] },
        credentials: resolveMetaerpCredentials(),
        timeoutMs: 5_000,
      });
      await erp.close();
      const sent = JSON.parse(erp.seen.find((r) => r.url.includes("queryPr"))!.body);
      // 平台强制项赢过调用方；而 defaults 仍然输给调用方。
      expect(sent.prNumberList).toEqual(["100020260902000001"]);
      expect(sent.unitCode).toBe("9999");
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

describe("createTransactionOrder · 单据行由平台补齐", () => {
  const LINE_ENV = {
    METAERP_DEFAULT_UNIT_CODE: "1000",
    METAERP_DEFAULT_ORGANIZATION_CODE: "YF1",
    METAERP_SOURCE_SYSTEM_CODE: "LYY2",
    METAERP_TRANSFER_SOURCE_CODE: "INV",
    METAERP_TRANSFER_TXN_ORDER_TYPE_CODE: "INOT",
    METAERP_TRANSFER_TRANSACTION_TYPE_CODE: "ORGANIZATION_TRANSFER",
    METAERP_TRANSFER_ACTION_CODE: "ORGANIZATION_TRANSFER",
    METAERP_TRANSFER_TO_ORGANIZATION_CODE: "YF2",
    METAERP_TRANSFER_SUBMITTED_BY: "10000422",
    METAERP_TRANSFER_FROM_LOCATOR_CODE: "LC001",
    METAERP_TRANSFER_TO_STOREHOUSE_CODE: "1000",
    METAERP_TRANSFER_UOM_CODE: "EA",
    METAERP_TRANSFER_FIXED_QUANTITY: "5",
  } as const;

  beforeEach(() => {
    for (const [key, value] of Object.entries(LINE_ENV)) process.env[key] = value;
    _clearMetaerpRoutesCacheForTests();
  });
  afterEach(() => {
    for (const key of Object.keys(LINE_ENV)) delete process.env[key];
    _clearMetaerpRoutesCacheForTests();
  });

  /** The model authors only business values; every code comes from the route. */
  function scope(payload: Record<string, unknown>) {
    process.env.METAERP_TRANSPORT_MODE = "real";
    process.env.METAERP_ALLOW_REAL_WRITES = "true";
    const route = resolveRoute("createTransactionOrder", "write");
    return _applyLineScopeForTests("createTransactionOrder", route, payload, "run-abc123");
  }

  it("injects the deployment codes into every line and overwrites what the model guessed", () => {
    const out = scope({
      lineList: [
        {
          itemCode: "10000009",
          transactionQuantity: "100",
          storehouseCode: "300000",
          sourceObjectNumber: "100020260902000003",
          sourceObjectLineId: "2033239140312683600",
          // 实跑里模型填的业务单号——必须被覆盖成 INV
          sourceCode: "100020260902000003",
        },
      ],
    });
    const line = (out.lineList as Record<string, unknown>[])[0]!;
    expect(line.sourceCode).toBe("INV");
    expect(line.transactionTypeCode).toBe("ORGANIZATION_TRANSFER");
    expect(line.txnOrderTypeCode).toBe("INOT");
    expect(line.transferOrganizationCode).toBe("YF2");
    expect(line.submittedBy).toBe("10000422");
    expect(line.unitCode).toBe("1000");
    expect(line.propertyCode).toBe("YF1");
    expect(line.privateType).toBe("NORM");
    // 幂等键与头同值，而不是行自己生成一个
    expect(line.uniqueSequenceNumber).toBe("run-abc123");
    // 业务值保持模型给的
    expect(line.itemCode).toBe("10000009");
    expect(line.storehouseCode).toBe("300000");
    // 演示期数量被钉死：模型报 100 也按 5 发出，可调库存够、能反复重跑
    expect(line.transactionQuantity).toBe("5");
    // 缺省补齐：模型没给的收货库与货位
    expect(line.transferStorehouseCode).toBe("1000");
    expect(line.locatorCode).toBe("LC001");
    expect(line.lineNumber).toBe("10");
    expect(line.operationType).toBe("ADD");
  });

  it("stamps requiredDate in local time, with the line strictly earlier than the header", () => {
    process.env.METAERP_TRANSPORT_MODE = "real";
    process.env.METAERP_ALLOW_REAL_WRITES = "true";
    const route = resolveRoute("createTransactionOrder", "write");
    const header = route.overrides?.requiredDate as string;
    const line = route.line_overrides?.requiredDate as string;
    expect(header).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    expect(line).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    expect(Date.parse(line.replace(" ", "T"))).toBeLessThan(
      Date.parse(header.replace(" ", "T")),
    );
    // 本地时间，不是 UTC：模型曾用 ISO 时间戳，让 17:14 的申请在 ERP 里显示成 09:14
    const localHour = String(new Date().getHours()).padStart(2, "0");
    expect(header.slice(11, 13)).toBe(localHour);
  });

  it("names the empty line array instead of letting ERP answer with its opaque 430138", () => {
    expect(() => scope({ requiredDate: "2026-09-08 17:00:00" })).toThrow(/lineList 为空/);
    expect(() => scope({ lineList: [] })).toThrow(/lineList 为空/);
  });
});

describe("写操作成功后补 applied 标记", () => {
  it("marks a real write applied — the mock-only field three emit gates depend on", () => {
    // 真实 ERP 的建单回执里没有 applied，切到真实通道后三个方案分支的
    // `lastResult.applied == true` 全部静默变 false，单据建出来了流程却不往下走。
    const receipt = { txnOrderHeaderNumber: "INOT20260908YF100013", affectedRows: 1 };
    expect(_markAppliedForTests("write", receipt)).toEqual({ ...receipt, applied: true });
  });

  it("leaves a mock write that reported applied:false alone", () => {
    const skipped = { ok: true, id: "SKIPPED", applied: false, skipped_reason: "压缩后续周期" };
    expect(_markAppliedForTests("write", skipped)).toEqual(skipped);
  });

  it("does not touch query results or non-objects", () => {
    expect(_markAppliedForTests("query", { records: [] })).toEqual({ records: [] });
    expect(_markAppliedForTests("write", [1, 2])).toEqual([1, 2]);
    expect(_markAppliedForTests("write", null)).toBeNull();
  });
});

describe("写回执判据：ERP 用 200 回一张没落库的单", () => {
  const route = {
    transport: "openapi" as const,
    line_field: "lineList",
    write_receipt: {
      require_fields: ["txnOrderHeaderNumber"],
      line_status_field: "txnOrderLineStatus",
      line_failed_values: ["FAILED", "ERROR"],
      line_error_fields: ["errorMessage"],
    },
  };

  it("rejects the real receipt that reported success with nothing written", () => {
    // run-66b191a09941 的原始回执：affectedRows 0、没有单号、两行 FAILED。
    expect(() =>
      _assertWriteReceiptForTests("createTransactionOrder", route, {
        affectedRows: 0,
        txnOrderHeaderId: "1992897911985607954",
        lineList: [
          { itemCode: "10000008", txnOrderLineStatus: "FAILED", errorMessage: "The outbound quantity is not enough." },
          { itemCode: "10000008", txnOrderLineStatus: "FAILED", errorMessage: "The outbound quantity is not enough." },
          { itemCode: "10000007", txnOrderLineStatus: "DRAFT", errorMessage: null },
        ],
      }),
    ).toThrow(/txnOrderHeaderNumber[\s\S]*The outbound quantity is not enough/);
  });

  it("accepts the receipt of an order that really landed", () => {
    expect(() =>
      _assertWriteReceiptForTests("createTransactionOrder", route, {
        affectedRows: 1,
        txnOrderHeaderNumber: "INOT20260908YF100013",
        lineList: [{ txnOrderLineStatus: "DRAFT", errorMessage: null, txnOrderLineId: "199289791" }],
      }),
    ).not.toThrow();
  });

  it("does nothing for a route that declares no receipt rule", () => {
    expect(() =>
      _assertWriteReceiptForTests("whatever", { transport: "openapi" }, { anything: true }),
    ).not.toThrow();
  });
});

describe("stub 通道", () => {
  beforeEach(() => _clearMetaerpRoutesCacheForTests());
  afterEach(() => _clearMetaerpRoutesCacheForTests());

  it("returns the declared answer without either gate downgrading it", () => {
    process.env.METAERP_TRANSPORT_MODE = "mock";
    process.env.METAERP_ALLOW_REAL_WRITES = "false";
    const route = resolveRoute("updateTransactionOrder", "write", "hc-procurement");
    // 桩不碰任何系统，所以两道闸口都不适用——降级到 mock 反而会发出一次 HTTP 调用
    expect(route.transport).toBe("stub");
    expect(route.downgradedFrom).toBeUndefined();
    expect(route.stub_response?.fulfilled).toBe(true);
  });
});

describe("演示期固定调拨数量", () => {
  beforeEach(() => {
    process.env.METAERP_TRANSPORT_MODE = "real";
    process.env.METAERP_ALLOW_REAL_WRITES = "true";
    _clearMetaerpRoutesCacheForTests();
  });
  afterEach(() => {
    delete process.env.METAERP_TRANSFER_FIXED_QUANTITY;
    _clearMetaerpRoutesCacheForTests();
  });

  const lines = () => [{ itemCode: "10000008", transactionQuantity: "300" }];

  it("pins every line to the configured quantity", () => {
    process.env.METAERP_TRANSFER_FIXED_QUANTITY = "5";
    _clearMetaerpRoutesCacheForTests();
    const route = resolveRoute("createTransactionOrder", "write");
    const out = _applyLineScopeForTests("createTransactionOrder", route, { lineList: lines() }, null);
    expect((out.lineList as Record<string, unknown>[])[0]!.transactionQuantity).toBe("5");
  });

  it("falls back to the caller's quantity when the pin is unset", () => {
    delete process.env.METAERP_TRANSFER_FIXED_QUANTITY;
    _clearMetaerpRoutesCacheForTests();
    const route = resolveRoute("createTransactionOrder", "write");
    const out = _applyLineScopeForTests("createTransactionOrder", route, { lineList: lines() }, null);
    expect((out.lineList as Record<string, unknown>[])[0]!.transactionQuantity).toBe("300");
  });
});

describe("租户级路由覆盖", () => {
  beforeEach(() => _clearMetaerpRoutesCacheForTests());
  afterEach(() => _clearMetaerpRoutesCacheForTests());

  it("leaves other tenants on the declared transport", () => {
    // 采购-HC-Formal 的端到端测试断言这个操作必须真的打到 ERP；演示口径属于
    // hc-procurement 一家，不能变成全域默认。
    process.env.METAERP_TRANSPORT_MODE = "real";
    process.env.METAERP_ALLOW_REAL_WRITES = "true";
    _clearMetaerpRoutesCacheForTests();
    expect(resolveRoute("updateTransactionOrder", "write", "procurement-hc-formal").transport)
      .toBe("openapi");
    expect(resolveRoute("updateTransactionOrder", "write").transport).toBe("openapi");
    expect(resolveRoute("updateTransactionOrder", "write", "hc-procurement").transport)
      .toBe("stub");
  });
});

describe("租户级默认通道", () => {
  beforeEach(() => _clearMetaerpRoutesCacheForTests());
  afterEach(() => _clearMetaerpRoutesCacheForTests());

  it("pins a whole tenant to the mock while the same operations stay real for everyone else", () => {
    process.env.METAERP_TRANSPORT_MODE = "real";
    process.env.METAERP_ALLOW_REAL_WRITES = "true";
    _clearMetaerpRoutesCacheForTests();
    // 场景一与场景二共用这些操作名；场景一切到真实 ERP 后，场景二曾跟着一起指向 v15。
    for (const op of ["queryPbpHeader", "queryPr", "createPbp", "createTransactionOrder"]) {
      const kind = op.startsWith("query") ? "query" : "write";
      expect(resolveRoute(op, kind, "hc-digital-worker").transport, op).toBe("mock");
      expect(resolveRoute(op, kind, "hc-procurement").transport, op).not.toBe("mock");
    }
    // 不在表里的操作对该租户依旧是 mock，不会因为租户默认而出错。
    expect(resolveRoute("queryAuditThresholdConfig", "query", "hc-digital-worker").transport).toBe("mock");
  });

  it("lets an operation-level tenant override beat the tenant default", () => {
    process.env.METAERP_TRANSPORT_MODE = "real";
    _clearMetaerpRoutesCacheForTests();
    // hc-procurement 没有租户默认，但 updateTransactionOrder 有操作级覆盖 → stub
    expect(resolveRoute("updateTransactionOrder", "write", "hc-procurement").transport).toBe("stub");
  });
});
