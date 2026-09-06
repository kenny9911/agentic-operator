/**
 * HC 场景二「数字化员工的智能作业实践」end-to-end cascade.
 *
 * Companion to power-scm-scenario1.e2e.test.ts, same harness shape:
 *   - the REAL engine (registerAgent + step-engine) over the ontology-compiled
 *     manifest models/hc-digital-worker-v1/workflow_v1.json,
 *   - a real in-process mock Meta ERP (@agentic/mock-erp) on an ephemeral port,
 *     fed from the IN-REPO package data (no external dist path),
 *   - a scripted fake LLM gateway keyed by request.purpose,
 *   - a fake Inngest step whose waitForEvent auto-resolves each HITL task with
 *     a form answer, exactly like POST /v1/tasks/:id/resolve would,
 *   - a breadth-first cascade driver that redelivers emitted events to the
 *     manifest subscribers, mirroring Inngest name-based fan-out.
 *
 * Chain under test (14 agents):
 *   DAILY_DEMAND_PLAN_SCAN_SCHEDULED
 *     → scanApprovedDemandPlan       → APPROVED_DEMAND_PLAN_SCANNED
 *     → analyzeDemandMerge           → DEMAND_MERGE_ANALYZED | DEMAND_SPLIT_REQUIRED
 *         └ splitOversizedDemand【人工】 → DEMAND_SPLIT_CONFIRMED       (ERP splitDemandLine)
 *     → verifyInventoryAvailability  → INVENTORY_AVAILABILITY_VERIFIED
 *                                      + STOCK_SUFFICIENT_FOR_DEMAND | PURCHASE_REQUIRED_CONFIRMED
 *         ├ createInventoryTransferOrder (终止分支, ERP createTransactionOrder)
 *         └ derivePurchaseSchedule   → PURCHASE_SCHEDULE_DERIVED
 *     → generateExecutionPlanDraft   → EXECUTION_PLAN_DRAFT_GENERATED (ERP createPbp)
 *     → auditAnnualPlanCompliance    → ANNUAL_PLAN_AUDITED | PLAN_AUDIT_INTERCEPTED
 *         └ returnPlanForRectification【人工】→ PLAN_RECTIFICATION_SUBMITTED (回到 audit)
 *     → recommendPackagingScheme     → PACKAGING_SCHEME_RECOMMENDED | PACKAGING_COMPLIANCE_VIOLATED
 *         └ raisePackagingComplianceAlert → PACKAGING_ALERT_RAISED (回到 recommend)
 *     → annotateFrameAndCentralPurchase → FRAME_AND_CENTRAL_ANNOTATED
 *     → confirmPlanAndPackage【人工】 → PLAN_AND_PACKAGE_CONFIRMED | PLAN_AND_PACKAGE_REJECTED
 *     → submitPlanForApproval        → PLAN_SUBMITTED_FOR_APPROVAL   (ERP submitApproval)
 */

import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { desc, eq } from "drizzle-orm";
import {
  AgentSchema,
  getRuntimeGateway,
  registerAgent,
  setRuntimeGateway,
  type RegisterContext,
} from "@agentic/runtime";
import type { ChatRequest, ChatResponse, LLMGateway } from "@agentic/llm-gateway";
import { buildApp } from "@agentic/mock-erp";
import {
  agents as agentsTable,
  eventStore,
  getDb,
  runs,
  tasks as tasksTable,
  tenants,
  workflows,
} from "@agentic/db";
import { makeId } from "@agentic/shared";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../../..");
const MANIFEST_PATH = path.join(REPO_ROOT, "models/hc-digital-worker-v1/workflow_v1.json");
const PACKAGE_DIR = path.join(REPO_ROOT, "ontology-packages/hc-digital-worker/package");

const suffix = Date.now().toString(36).toLowerCase();
const tenantSlug = `hcdw-e2e-${suffix}`;

/** Seed rows the package ships (ontology-packages/.../mock-erp/ss_pbp_line_t.json). */
const PLAN_HEADER = "PBP-2027-0101";
const PLAN_LINE = "PBPL-2027-0101-02";
const PACKAGE_SCHEME = "PKG-2027-0101";

interface SentEvent {
  name: string;
  data: Record<string, unknown>;
}

/** Fields every downstream `payload_from: event.data` hop needs to keep carrying. */
function carry(extra: Record<string, unknown> = {}) {
  return {
    plan_id: PLAN_HEADER,
    plan_line_id: PLAN_LINE,
    pbp_header_id: PLAN_HEADER,
    package_scheme_id: PACKAGE_SCHEME,
    scan_date: "2027-01-05",
    ...extra,
  };
}

describe.sequential("hc-digital-worker scenario 2 digital-employee cascade (E2E)", () => {
  const db = getDb();
  const priorGateway = (() => {
    try {
      return getRuntimeGateway();
    } catch {
      return undefined;
    }
  })();

  let tenantId: string;
  let erp: ReturnType<typeof buildApp>;
  let erpBase = "";
  const registeredByTrigger = new Map<
    string,
    Array<{ name: string; fn: (i: unknown) => Promise<unknown> }>
  >();
  const agentDbIds = new Map<string, string>();

  // ── gateway scripting state ───────────────────────────────────────────────
  /** analyzeDemandMerge asks for a split on the first pass only. */
  let splitRequired = true;
  /** verifyInventoryAvailability: true → purchase branch, false → transfer branch. */
  let purchaseRequired = true;
  /** auditAnnualPlanCompliance intercepts once, then passes (rectification loop). */
  let auditPasses: boolean[] = [false, true];
  /** recommendPackagingScheme violates once, then complies (alert loop). */
  let packagingCompliant: boolean[] = [false, true];
  let auditCalls = 0;
  let packagingCalls = 0;

  function scriptedOutput(purpose: string): Record<string, unknown> | null {
    if (purpose.includes("scanApprovedDemandPlan")) {
      return {
        demand_plan: { pbp_header_id: PLAN_HEADER, status: "已批准" },
        demand_plan_line: [
          { plan_line_id: PLAN_LINE, material_code: "M-CAB-240", quantity: 12000 },
        ],
        scanned_line_count: 4,
        coverage_note: "已全量纳入状态=已批准的计划行。",
        scan_date: "2027-01-05",
        ...carry(),
      };
    }
    if (purpose.includes("analyzeDemandMerge")) {
      const required = splitRequired;
      splitRequired = false; // a re-entry after the split must not loop forever
      return {
        demand_plan_line: [{ plan_line_id: PLAN_LINE }],
        merge_suggestion: [
          {
            merge_suggestion_id: "MRG-001",
            // What the split gate's form records, and how the option reads to a
            // planner — see the analyzeDemandMerge output contract.
            plan_line_id: PLAN_LINE,
            split_option_label: required ? "M-CAB-240 跨期拆分" : "M-CAB-240 三行合并",
            merge_reason: "同物料、同标准采购类型，需求日期跨度超出合并窗口。",
            suggestion: required ? "split_required" : "mergeable",
          },
        ],
        split_required: required,
        thresholds_used: { date_gap_days: 30 },
        scan_date: "2027-01-05",
        ...carry(),
      };
    }
    if (purpose.includes("verifyInventoryAvailability")) {
      return {
        demand_plan_line: [{ plan_line_id: PLAN_LINE }],
        stock_check_result: [
          { plan_line_id: PLAN_LINE, onhand_qty: 200, required_qty: 12000, gap_qty: 11800 },
        ],
        purchase_required: purchaseRequired,
        scan_date: "2027-01-05",
        ...carry({
          material_id: "M-CAB-240",
          from_warehouse: "WH-HD-01",
          to_warehouse: "WH-HD-02",
          qty: 200,
        }),
      };
    }
    if (purpose.includes("derivePurchaseSchedule")) {
      return {
        demand_plan_line: [{ plan_line_id: PLAN_LINE }],
        backward_schedule_plan: { schedule_id: "BSP-001", plan_line_id: PLAN_LINE },
        backward_schedule_stage: [
          { stage_node: "招标", planned_finish_date: "2027-02-20" },
          { stage_node: "签约", planned_finish_date: "2027-03-15" },
        ],
        schedule_derived: true,
        time_conflict: false,
        scan_date: "2027-01-05",
        ...carry(),
      };
    }
    if (purpose.includes("auditAnnualPlanCompliance")) {
      const passed = auditPasses[Math.min(auditCalls, auditPasses.length - 1)] ?? true;
      auditCalls += 1;
      return {
        demand_plan_line: [{ plan_line_id: PLAN_LINE }],
        audit_opinion: { audit_opinion_id: "AOP-001", opinion: passed ? "通过" : "退回整改" },
        audit_finding: passed
          ? []
          : [{ finding_id: "AFD-001", rule_id: "BR2-AUDIT-01", detail: "超年度计划金额" }],
        audit_passed: passed,
        thresholds_used: { over_plan_ratio: 0.1 },
        scan_date: "2027-01-05",
        ...carry({ audit_opinion_id: "AOP-001" }),
      };
    }
    if (purpose.includes("recommendPackagingScheme")) {
      const compliant = packagingCompliant[Math.min(packagingCalls, packagingCompliant.length - 1)] ?? true;
      packagingCalls += 1;
      return {
        package_scheme: { package_scheme_id: PACKAGE_SCHEME, scheme_name: "2027 年一季度电缆组包" },
        packaging_finding: compliant
          ? []
          : [{ finding_id: "PFD-001", rule_id: "BR2-PKG-02", detail: "跨品类混包" }],
        packaging_compliant: compliant,
        thresholds_used: { max_lines_per_package: 20 },
        scan_date: "2027-01-05",
        ...carry({ alert_id: "PKA-001" }),
      };
    }
    return null;
  }

  const scriptedGateway = {
    chat: async (request: ChatRequest): Promise<ChatResponse> => {
      const purpose = request.purpose ?? "";
      const base = {
        provider: "mock",
        model: "scripted",
        tokensIn: 100,
        tokensOut: 50,
        finishReason: "stop",
        latencyMs: 1,
      };
      // Rule-gate judges compiled as `logic rule-gate:<id>` steps.
      const gate = /rule-gate:([A-Z0-9-]+)/.exec(purpose)?.[1];
      if (gate) {
        return {
          ...base,
          text: JSON.stringify({ ruleId: gate, status: "pass", reason: "满足业务规则" }),
        } as ChatResponse;
      }
      const output = scriptedOutput(purpose);
      if (output) return { ...base, text: JSON.stringify(output) } as ChatResponse;
      return { ...base, text: "{}" } as ChatResponse;
    },
  } as unknown as LLMGateway;

  beforeAll(async () => {
    // 1) mock Meta ERP on an ephemeral port, from the in-repo package data.
    erp = buildApp({
      dataDir: path.join(PACKAGE_DIR, "mock-erp"),
      transformMapsPath: path.join(PACKAGE_DIR, "transform-maps/transform-maps.json"),
      stateDir: mkdtempSync(path.join(tmpdir(), "hcdw-e2e-erp-")),
      logger: false,
    });
    await erp.app.listen({ port: 0, host: "127.0.0.1" });
    const address = erp.app.server.address();
    if (!address || typeof address === "string") throw new Error("mock-erp address unavailable");
    erpBase = `http://127.0.0.1:${address.port}`;
    // The compiled manifest binds metaerp.invoke to this env var (base_url_env),
    // which is exactly why scenario 2 can coexist with scenario 1's :3620.
    process.env.METAERP_DIGITAL_WORKER_BASE_URL = erpBase;

    // 2) tenant + workflow + agent rows
    tenantId = makeId("ten");
    const workflowId = makeId("wf");
    db.insert(tenants).values({ id: tenantId, slug: tenantSlug, name: "HC-数字员工 E2E" }).run();
    db.insert(workflows)
      .values({ id: workflowId, tenantId, slug: "hc-digital-worker", name: "数字化员工的智能作业实践" })
      .run();

    // 3) register every compiled manifest agent against the REAL engine
    const raw = JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as unknown;
    const manifestAgents: unknown[] = Array.isArray(raw)
      ? raw
      : ((raw as { agents?: unknown[] }).agents ?? []);
    expect(manifestAgents.length).toBe(14);
    const context: RegisterContext = {
      tenantId,
      tenantSlug,
      workflowVersionId: makeId("wfv"),
      tenantRegistry: { tools: {} },
    } as unknown as RegisterContext;
    for (const entry of manifestAgents) {
      const agent = AgentSchema.parse(entry);
      const agentDbId = makeId("agt");
      agentDbIds.set(agent.name, agentDbId);
      db.insert(agentsTable)
        .values({
          id: agentDbId,
          workflowId,
          kebabId: agent.name,
          name: agent.name,
          actor: "Agent",
          kind: "manifest",
          enabled: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .run();
      const registered = registerAgent(agent, context) as unknown as {
        fn: (i: unknown) => Promise<unknown>;
      } | null;
      if (!registered) continue;
      for (const trigger of agent.trigger) {
        const list = registeredByTrigger.get(trigger) ?? [];
        list.push({ name: agent.name, fn: registered.fn });
        registeredByTrigger.set(trigger, list);
      }
    }
    setRuntimeGateway(scriptedGateway);
  });

  afterAll(async () => {
    if (priorGateway) setRuntimeGateway(priorGateway);
    await erp.app.close();
    db.delete(tenants).where(eq(tenants.id, tenantId)).run();
  });

  /**
   * Form answers the auto-resolver submits, keyed by the manual action name.
   * `decision` is a FORM field: a compiled (legacy-mode) manifest exposes
   * `results.manual-N` as the form payload, not the resolution envelope, so the
   * branch conditions read it from here — same encoding scenario 1 uses.
   */
  const formAnswers: Record<string, Record<string, unknown>> = {
    confirmSplitByPlanner: {
      decision: "approved",
      plan_line_id: PLAN_LINE,
      split_reason: "需求日期差超限",
      remark: "E2E",
    },
    acceptRectification: {
      decision: "approved",
      audit_opinion_id: "AOP-001",
      rectification_note: "已按审核意见调整金额与到货日期。",
      plan_id: PLAN_HEADER,
    },
    confirmByPlanner: {
      decision: "approved",
      plan_id: PLAN_HEADER,
      package_scheme_id: PACKAGE_SCHEME,
      confirmed_by: "计划员-张伟",
      remark: "E2E",
    },
    captureRejectionReason: { rejection_reason: "组包不合规" },
  };
  /** Overridden per-test to drive the reject branch. */
  let formOverrides: Record<string, Record<string, unknown>> = {};

  function invocation(eventName: string, data: Record<string, unknown>, sink: SentEvent[]) {
    return {
      event: { name: `${tenantSlug}/${eventName}`, data },
      step: {
        run: async (
          _id: string | { id: string },
          fn: (...args: unknown[]) => unknown,
          ...args: unknown[]
        ) => fn(...args),
        sendEvent: async (_id: string, payload: { name: string; data?: Record<string, unknown> }) => {
          // Inngest carries the event over the wire as JSON, so every hop hands
          // the next agent a FRESHLY PARSED object graph. Reproduce that here:
          // passing the live graph through in-process would keep shared object
          // identities (the runtime attaches `last_result`, whose members alias
          // the top-level fields), and the runtime's tool-argument cloner
          // treats a repeated reference as a cycle and rejects the payload.
          sink.push({
            name: payload.name,
            data: JSON.parse(JSON.stringify(payload.data ?? {})) as Record<string, unknown>,
          });
        },
        sleep: async () => undefined,
        waitForEvent: async (_id: string, opts: { if?: string }) => {
          const cond = opts?.if ?? "";
          const taskId = /async\.data\.taskId == "([^"]+)"/.exec(cond)?.[1];
          const resumeMarker = /async\.data\.resumeMarker == "([^"]+)"/.exec(cond)?.[1];
          if (!taskId || !resumeMarker) throw new Error(`unparseable waitForEvent condition: ${cond}`);
          // Read the real task row to answer the form the runtime actually asked.
          const taskRow = db.select().from(tasksTable).where(eq(tasksTable.id, taskId)).all()[0];
          const actionName = String(
            (taskRow?.payloadJson as { actionName?: string } | null)?.actionName ?? "",
          );
          const answer = formOverrides[actionName] ?? formAnswers[actionName] ?? {};
          // Mirror the resolve route's own cross-check: a form carrying
          // `decision: "rejected"` CANNOT be submitted as an approval — the API
          // answers `task_decision_mismatch`. Deriving the task decision from
          // the form here keeps the harness to combinations the product can
          // actually produce.
          const formDecision = String(answer.decision ?? "").toLowerCase();
          const decision =
            formDecision === "rejected" || formDecision === "reject"
              ? "reject"
              : "approve";
          // Mirror POST /v1/tasks/:id/resolve persistence: open → resolving.
          db.update(tasksTable).set({ status: "resolving" }).where(eq(tasksTable.id, taskId)).run();
          return { data: { taskId, tenantId, resumeMarker, decision, payload: answer } };
        },
      },
      logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
    };
  }

  /** Breadth-first cascade: deliver an event to every subscribed agent, then
   * redeliver whatever they emitted (Inngest name-based fan-out stand-in). */
  async function dispatchCascade(
    rootEvent: string,
    rootData: Record<string, unknown>,
    opts?: { only?: string[] },
  ): Promise<string[]> {
    const delivered: string[] = [];
    const queue: SentEvent[] = [{ name: rootEvent, data: rootData }];
    let hops = 0;
    while (queue.length > 0) {
      if (++hops > 60) throw new Error(`cascade runaway: ${delivered.join(" → ")}`);
      const evt = queue.shift()!;
      const bare = evt.name.includes("/") ? evt.name.split("/").slice(1).join("/") : evt.name;
      delivered.push(bare);
      for (const listener of registeredByTrigger.get(bare) ?? []) {
        if (opts?.only && !opts.only.includes(listener.name)) continue;
        const sink: SentEvent[] = [];
        await listener.fn(
          invocation(bare, { subject: String(rootData.subject ?? "dw"), ...evt.data }, sink),
        );
        queue.push(...sink);
      }
    }
    return delivered;
  }

  function runsFor(agentName: string) {
    const agentDbId = agentDbIds.get(agentName);
    if (!agentDbId) throw new Error(`unknown agent ${agentName}`);
    return db
      .select()
      .from(runs)
      .where(eq(runs.agentId, agentDbId))
      .orderBy(desc(runs.startedAt))
      .all();
  }

  async function journalOps(): Promise<
    Array<{ op: string; payload: Record<string, unknown>; result: { ok?: boolean; id?: string } }>
  > {
    const res = await fetch(`${erpBase}/__journal`);
    expect(res.ok).toBe(true);
    const body = (await res.json()) as { entries?: unknown[] } | unknown[];
    const entries = Array.isArray(body) ? body : (body.entries ?? []);
    return entries as Array<{
      op: string;
      payload: Record<string, unknown>;
      result: { ok?: boolean; id?: string };
    }>;
  }

  function resetScript() {
    splitRequired = true;
    purchaseRequired = true;
    auditPasses = [false, true];
    packagingCompliant = [false, true];
    auditCalls = 0;
    packagingCalls = 0;
    formOverrides = {};
  }

  it("runs the full digital-employee cascade: scan → merge/split → inventory → schedule → plan draft → audit → packaging → confirm → submit", async () => {
    resetScript();
    await fetch(`${erpBase}/__reset`, { method: "POST" });

    const delivered = await dispatchCascade("DAILY_DEMAND_PLAN_SCAN_SCHEDULED", {
      subject: "dw-e2e-happy",
      scan_date: "2027-01-05",
      scan_batch_id: "DW-E2E-HAPPY",
    });

    // Every stage of the scenario was reached, including both remediation loops.
    for (const expected of [
      "DAILY_DEMAND_PLAN_SCAN_SCHEDULED",
      "APPROVED_DEMAND_PLAN_SCANNED",
      "DEMAND_SPLIT_REQUIRED",
      "DEMAND_SPLIT_CONFIRMED",
      "INVENTORY_AVAILABILITY_VERIFIED",
      "PURCHASE_REQUIRED_CONFIRMED",
      "PURCHASE_SCHEDULE_DERIVED",
      "EXECUTION_PLAN_DRAFT_GENERATED",
      "PLAN_AUDIT_INTERCEPTED",
      "PLAN_RECTIFICATION_SUBMITTED",
      "ANNUAL_PLAN_AUDITED",
      "PACKAGING_COMPLIANCE_VIOLATED",
      "PACKAGING_ALERT_RAISED",
      "PACKAGING_SCHEME_RECOMMENDED",
      "FRAME_AND_CENTRAL_ANNOTATED",
      "PLAN_AND_PACKAGE_CONFIRMED",
      "PLAN_SUBMITTED_FOR_APPROVAL",
    ]) {
      expect(delivered, `delivered ${expected}`).toContain(expected);
    }

    // Every agent on the happy path completed ok against the real engine.
    for (const name of [
      "scanApprovedDemandPlan",
      "analyzeDemandMerge",
      "splitOversizedDemand",
      "verifyInventoryAvailability",
      "derivePurchaseSchedule",
      "generateExecutionPlanDraft",
      "auditAnnualPlanCompliance",
      "returnPlanForRectification",
      "recommendPackagingScheme",
      "raisePackagingComplianceAlert",
      "annotateFrameAndCentralPurchase",
      "confirmPlanAndPackage",
      "submitPlanForApproval",
    ]) {
      const [latest] = runsFor(name);
      expect(latest, `run row for ${name}`).toBeDefined();
      expect(latest!.status, `status of ${name}`).toBe("ok");
    }

    // Real ERP side effects for each external action.
    const opNames = (await journalOps()).map((entry) => entry.op);
    for (const op of [
      "splitDemandLine",
      "createPbp",
      "pushTask",
      "createProcPackageLines",
      "writeOperationLog",
      "submitApproval",
    ]) {
      expect(opNames, `ERP op ${op}`).toContain(op);
    }

    // HITL: exactly the three modelled gates, all resolved.
    const taskRows = db.select().from(tasksTable).where(eq(tasksTable.tenantId, tenantId)).all();
    const actionNames = taskRows
      .map((t) => String((t.payloadJson as { actionName?: string } | null)?.actionName ?? ""))
      .sort();
    expect(actionNames).toEqual(["acceptRectification", "confirmByPlanner", "confirmSplitByPlanner"]);
    for (const task of taskRows) expect(["resolved", "resolving"]).toContain(task.status);

    // Durable event records exist for the emitted chain.
    const storeNames = new Set(
      db.select().from(eventStore).where(eq(eventStore.tenantId, tenantId)).all().map((r) => r.name),
    );
    for (const expected of [
      "APPROVED_DEMAND_PLAN_SCANNED",
      "DEMAND_SPLIT_CONFIRMED",
      "PURCHASE_SCHEDULE_DERIVED",
      "ANNUAL_PLAN_AUDITED",
      "PLAN_SUBMITTED_FOR_APPROVAL",
    ]) {
      expect(storeNames.has(expected), `event_store has ${expected}`).toBe(true);
    }
  });

  it("takes the transfer branch (no purchase) when stock covers the demand: BR2-STOCK-01 gate passes, no purchase schedule", async () => {
    resetScript();
    purchaseRequired = false;
    splitRequired = false; // straight to the inventory check
    await fetch(`${erpBase}/__reset`, { method: "POST" });

    const delivered = await dispatchCascade("APPROVED_DEMAND_PLAN_SCANNED", {
      subject: "dw-e2e-transfer",
      ...carry(),
    });

    expect(delivered).toContain("STOCK_SUFFICIENT_FOR_DEMAND");
    expect(delivered).toContain("INVENTORY_TRANSFER_ORDER_CREATED");
    // The purchase branch never opened.
    expect(delivered).not.toContain("PURCHASE_REQUIRED_CONFIRMED");
    expect(delivered).not.toContain("PURCHASE_SCHEDULE_DERIVED");

    const [transfer] = runsFor("createInventoryTransferOrder");
    expect(transfer!.status).toBe("ok");
    expect((await journalOps()).map((e) => e.op)).toContain("createTransactionOrder");
  });

  it("stops the gate on a planner rejection: run fails, no ERP write, no downstream event", async () => {
    resetScript();
    formOverrides = {
      confirmByPlanner: {
        decision: "rejected",
        plan_id: PLAN_HEADER,
        package_scheme_id: PACKAGE_SCHEME,
        confirmed_by: "计划员-张伟",
      },
    };
    await fetch(`${erpBase}/__reset`, { method: "POST" });

    // A compiled manifest runs in the engine's legacy mode, where a human
    // rejection FAILS the run at the manual step — it never reaches the write
    // or the authored emissions. The ontology models a rejection loop back to
    // repackaging; the runtime cannot take it. See D-06 in
    // docs/hc-digital-worker-ontology-corrections.md.
    await expect(
      dispatchCascade(
        "FRAME_AND_CENTRAL_ANNOTATED",
        { subject: "dw-e2e-reject", ...carry({ confirmed_by: "计划员-张伟" }) },
        { only: ["confirmPlanAndPackage"] },
      ),
    ).rejects.toThrow(/rejected by human/);

    const [latest] = runsFor("confirmPlanAndPackage");
    expect(latest!.status).toBe("failed");
    expect((await journalOps()).map((entry) => entry.op)).not.toContain("writeOperationLog");
    const emitted = db
      .select()
      .from(eventStore)
      .where(eq(eventStore.sourceRunId, latest!.id))
      .all()
      .map((row) => row.name);
    expect(emitted).not.toContain("PLAN_AND_PACKAGE_CONFIRMED");
    expect(emitted).not.toContain("PLAN_AND_PACKAGE_REJECTED");
  });
});
