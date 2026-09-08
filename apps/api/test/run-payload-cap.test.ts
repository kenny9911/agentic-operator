/**
 * The run-detail payload cap.
 *
 * A real procurement chain's trigger payload is ~42KB against a 24KB cap. The
 * cap used to replace the whole object with `{_truncated, _bytes, _preview}`,
 * and the approval panel filters those markers as plumbing — so the approver
 * got an empty 「采购概况」/「判断依据」 and had to decide with no evidence on
 * screen. The bulk was never the evidence: 19KB of the 42KB was a 28-row
 * per-stage list plus the previous step's echo.
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolvePayloadRef } from "../src/queries/runs";

function refTo(value: unknown): string {
  const dir = mkdtempSync(path.join(tmpdir(), "payload-cap-"));
  const file = path.join(dir, "payload.json");
  writeFileSync(file, JSON.stringify(value), "utf8");
  return file;
}

/** Shaped after ADJUSTMENT_OPTIONS_GENERATED: small decision evidence next to
 *  two bulk branches that dwarf it. */
function procurementPayload() {
  const row = (i: number) => ({
    stage_progress_id: `SP-${i}`,
    stage_node: "组包",
    stage_status: "已完成",
    actual_finish_date: "2026-09-03T10:11:04+08:00",
    note: "x".repeat(200),
  });
  return {
    alert_context: { alert_id: "ALT-1", alert_level: "红色", notified_role: "分管领导" },
    recommended_option: { option_type: "执行调拨", arrival_impact_days: -112 },
    chain_id: "100020260902000003",
    stage_progress_list: Array.from({ length: 28 }, (_, i) => row(i)),
    last_result: { echo: "y".repeat(9000) },
  };
}

describe("run payload cap", () => {
  it("keeps the decision evidence and sheds the bulk branches", async () => {
    const payload = procurementPayload();
    const capped = (await resolvePayloadRef(refTo(payload), 4_000)) as Record<
      string,
      unknown
    >;

    expect(capped.alert_context).toEqual(payload.alert_context);
    expect(capped.recommended_option).toEqual(payload.recommended_option);
    expect(capped.chain_id).toBe("100020260902000003");
    // The two heavyweights are gone, and the reader is told so — "not shown"
    // must be distinguishable from "not present".
    expect(capped._droppedKeys).toEqual(["last_result", "stage_progress_list"]);
    expect(capped._truncated).toBe(true);
    expect(capped._bytes).toBeGreaterThan(4_000);
    expect(capped.stage_progress_list).toBeUndefined();
    expect(Buffer.byteLength(JSON.stringify(capped), "utf8")).toBeLessThanOrEqual(
      4_000 + 200,
    );
  });

  it("leaves a payload that already fits completely untouched", async () => {
    const payload = { alert_level: "红色", chain_id: "C-1" };
    expect(await resolvePayloadRef(refTo(payload), 24_000)).toEqual(payload);
  });

  it("falls back to a preview when no single branch can be shed to fit", async () => {
    // One giant scalar: there is nothing to drop but the payload itself.
    const capped = (await resolvePayloadRef(refTo({ blob: "z".repeat(9_000) }), 1_000)) as Record<
      string,
      unknown
    >;
    expect(capped._truncated).toBe(true);
    expect(typeof capped._preview).toBe("string");
    expect(capped.blob).toBeUndefined();
  });
});
