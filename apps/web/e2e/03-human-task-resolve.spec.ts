/**
 * P4-TEST-03 — E2E: human task creation + resolve.
 *
 * Target: the 采购-HC-Formal manifest agent `approveAdjustmentOption`
 * (领导审阅并拍板), whose FIRST step is a human gate:
 *
 *   trigger:        ADJUSTMENT_OPTIONS_GENERATED
 *   actions[0]:     type=manual (selectOption); awaiting_role=部门领导;
 *                   task_type=adjustment.select
 *
 * It used to target raas `jdReview`, but the live raas manifest is
 * workflow_v5, which has no human-first agent at all — the spec waited for a
 * task that no registered function could create. The CI e2e job seeds the
 * 采购-HC-Formal tenant (`pnpm hcf:seed`, membership for the seeded admin).
 *
 * The runtime creates a `tasks` row, fires `task.created` on SSE, then
 * waits for `task.resolved` matching `taskId`. POSTing to
 * `/v1/tasks/:id/resolve` injects that event and the workflow continues
 * past the human gate (into the planner's confirmation, another human step —
 * not asserted here).
 *
 * This spec:
 *   1. POSTs an `ADJUSTMENT_OPTIONS_GENERATED` event to kick the agent.
 *   2. Polls /v1/tasks until an open task for that agent, created after the
 *      test started, appears.
 *   3. POSTs resolve { decision: 'approve', payload: <the selectOption form> }
 *      — the resolve route validates the payload against the task's form
 *      schema, so the four required fields are supplied.
 *   4. Polls /v1/tasks/:id and asserts the status left `open`.
 */

import { test, expect } from "@playwright/test";
import { apiFetch, waitFor } from "./helpers";

const TENANT = "procurement-hc-formal";
const AGENT = "approveAdjustmentOption";

test.describe("P4-TEST-03: human task resolve E2E", () => {
  test("event → manual task row → resolve flips status", async () => {
    test.setTimeout(process.env.CI ? 180_000 : 60_000);
    const startedAt = Date.now();
    const stamp = `${startedAt}-${Math.random().toString(36).slice(2, 8)}`;
    const subject = `e2e-adjust-${stamp}`;
    const alertId = `ALT-E2E-${stamp}`;
    const chainId = `CHN-E2E-${stamp}`;

    // 1) Fire the trigger with every field the event declares as required.
    const ingest = await apiFetch<{ event_id: string }>("/v1/events", {
      method: "POST",
      tenantSlug: TENANT,
      body: JSON.stringify({
        name: "ADJUSTMENT_OPTIONS_GENERATED",
        subject,
        // `payload`, not `data`: IngestEventBody declares {name, subject,
        // payload} and the `data` shape is a RAAS/zhaopin-gated compatibility
        // form. Under any other tenant Zod strips the unknown key, so the event
        // still ingests 200 but the agent runs on an empty payload.
        payload: {
          alert_id: alertId,
          chain_id: chainId,
          option_ids: ["OPT-E2E-1", "OPT-E2E-2", "OPT-E2E-3"],
          recommended_option_type: "执行调拨",
          generated_at: new Date(startedAt).toISOString(),
          alert_context: { alert_id: alertId, chain_id: chainId, alert_level: "红色", notified_role: "分管领导" },
          options: [
            { option_id: "OPT-E2E-1", option_type: "压缩后续周期", alert_id: alertId, chain_id: chainId, is_recommended: false, is_high_risk: false },
            { option_id: "OPT-E2E-2", option_type: "调整需求日期", alert_id: alertId, chain_id: chainId, is_recommended: false, is_high_risk: false },
            { option_id: "OPT-E2E-3", option_type: "执行调拨", alert_id: alertId, chain_id: chainId, is_recommended: true, is_high_risk: false },
          ],
        },
      }),
    });
    expect(ingest.status, JSON.stringify(ingest.body)).toBe(200);

    // 2) The human gate materialises as an open task for our agent. Filter
    //    by creation time so a long-lived dev database with older open
    //    tasks for the same agent cannot satisfy the wait.
    interface TaskRow {
      id: string;
      type: string;
      status: string;
      createdAt: string | number | null;
      payloadJson?: { agentName?: string } | null;
    }
    const task = await waitFor<TaskRow>(
      async () => {
        const res = await apiFetch<TaskRow[]>("/v1/tasks?limit=50", { tenantSlug: TENANT });
        if (!res.body.ok) return null;
        const match = res.body.data.find(
          (t) =>
            t.status === "open" &&
            t.payloadJson?.agentName === AGENT &&
            t.createdAt != null &&
            new Date(t.createdAt).getTime() >= startedAt - 5_000,
        );
        return match ?? null;
      },
      // On a CI runner the Inngest dev server dispatches a step in tens of
      // seconds, not milliseconds.
      { timeoutMs: process.env.CI ? 120_000 : 30_000, label: `${AGENT} open task`, intervalMs: 500 },
    );
    expect(task.id).toMatch(/^(tsk-|TASK-)/);
    expect(task.status).toBe("open");
    expect(task.type).toBe("adjustment.select");

    // 3) Resolve with the form the gate declares (all four required fields).
    const resolve = await apiFetch<{ task_id: string; decision: string }>(
      `/v1/tasks/${task.id}/resolve`,
      {
        method: "POST",
        tenantSlug: TENANT,
        body: JSON.stringify({
          decision: "approve",
          payload: {
            option_id: "OPT-E2E-3",
            option_type: "执行调拨",
            decision_role: "分管领导",
            decided_by: "E2E 分管领导",
            comment: "e2e: 按推荐方案执行",
          },
        }),
      },
    );
    expect(resolve.status).toBe(200);
    if (!resolve.body.ok) {
      throw new Error(`resolve failed: ${resolve.body.error.code} — ${resolve.body.error.message}`);
    }
    expect(resolve.body.data.task_id).toBe(task.id);
    expect(resolve.body.data.decision).toBe("approve");

    // 4) The row leaves `open` (resolving → resolved once the runtime resumes).
    const after = await waitFor<{ id: string; status: string }>(
      async () => {
        const res = await apiFetch<{ id: string; status: string }>(`/v1/tasks/${task.id}`, { tenantSlug: TENANT });
        if (!res.body.ok) return null;
        return res.body.data.status === "open" ? null : res.body.data;
      },
      { timeoutMs: 15_000, label: "task status left open" },
    );
    expect(after.id).toBe(task.id);
    expect(["resolving", "resolved"]).toContain(after.status);
  });
});
