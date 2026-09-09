"use client";

/**
 * 运行历史 — the executions list.
 *
 * The runs table is per-agent: one procurement chain is fifteen rows, so it
 * answers "which agent ran" but never "how did that execution go". Every agent
 * in a chain carries the same subject, and the server groups on it; this view
 * is that list, and opening a row hands the subject to the canvas so the whole
 * path is drawn from the persisted runs.
 */

import { useState } from "react";
import { Button, Empty, Icon } from "@/app/portal/components";
import { useI18n } from "@/app/portal/lib/preferences-context";
import { fmtAgo } from "@/app/portal/lib/format";
import { useRunExecutions, type RunExecutionRow } from "@/lib/hooks/useRuns";
import { LiveWorkflowView } from "./LiveWorkflowView";

const PAGE_SIZE = 25;

function statusTone(status: RunExecutionRow["status"]): string {
  switch (status) {
    case "running":
      return "var(--signal)";
    case "waiting":
      return "var(--amber)";
    case "failed":
      return "var(--red)";
    case "cancelled":
      return "var(--text-3)";
    default:
      return "var(--green)";
  }
}

export function ExecutionHistory() {
  const { t, language } = useI18n();
  const copy = (zh: string, en: string) => (language === "zh" ? zh : en);
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null);
  const executions = useRunExecutions({ page, pageSize: PAGE_SIZE });

  if (open) {
    return (
      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "8px 14px",
            borderBottom: "1px solid var(--border)",
          }}
        >
          <Button small tone="ghost" icon="chevron-left" onClick={() => setOpen(null)}>
            {t("runs.executionBack")}
          </Button>
          <span style={{ fontSize: 12, color: "var(--text-3)" }}>
            {t("runs.executionViewing")}
          </span>
          <strong style={{ fontSize: 12.5 }}>{open}</strong>
        </div>
        <LiveWorkflowView historySubject={open} />
      </div>
    );
  }

  const rows = executions.data?.rows ?? [];
  const total = executions.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "12px 16px" }}>
      <div style={{ fontSize: 11.5, color: "var(--text-3)", marginBottom: 10 }}>
        {t("runs.executionHistoryHint")}
      </div>

      {executions.isLoading && (
        <div style={{ fontSize: 12, color: "var(--text-3)" }}>…</div>
      )}

      {!executions.isLoading && rows.length === 0 && (
        <Empty title={t("runs.executionEmpty")} />
      )}

      {rows.length > 0 && (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
          <thead>
            <tr style={{ color: "var(--text-3)", textAlign: "left" }}>
              <th style={{ padding: "6px 8px", fontWeight: 500 }}>
                {t("runs.executionSubject")}
              </th>
              <th style={{ padding: "6px 8px", fontWeight: 500 }}>
                {t("runs.executionAgents")}
              </th>
              <th style={{ padding: "6px 8px", fontWeight: 500 }}>
                {t("runs.executionRuns")}
              </th>
              <th style={{ padding: "6px 8px", fontWeight: 500 }}>
                {t("runs.executionLastActivity")}
              </th>
              <th style={{ padding: "6px 8px", fontWeight: 500 }} />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.subject}
                style={{ borderTop: "1px solid var(--border)" }}
              >
                <td style={{ padding: "8px" }}>
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 7,
                    }}
                  >
                    <span
                      aria-hidden
                      style={{
                        width: 7,
                        height: 7,
                        borderRadius: "50%",
                        background: statusTone(row.status),
                      }}
                    />
                    <strong>{row.subject}</strong>
                  </span>
                </td>
                <td style={{ padding: "8px", color: "var(--text-2)" }}>
                  {row.firstAgentName ?? "—"}
                  {row.lastAgentName && row.lastAgentName !== row.firstAgentName
                    ? ` → ${row.lastAgentName}`
                    : ""}
                  <span style={{ color: "var(--text-3)" }}> · {row.agentCount}</span>
                </td>
                <td style={{ padding: "8px", color: "var(--text-2)" }}>
                  {row.runCount}
                  {row.failedCount > 0 && (
                    <span style={{ color: "var(--red)" }}>
                      {" "}
                      · {copy(`${row.failedCount} 失败`, `${row.failedCount} failed`)}
                    </span>
                  )}
                </td>
                <td style={{ padding: "8px", color: "var(--text-3)" }}>
                  {row.lastActivityAt ? fmtAgo(row.lastActivityAt, language) : "—"}
                </td>
                <td style={{ padding: "8px", textAlign: "right" }}>
                  <Button small tone="ghost" onClick={() => setOpen(row.subject)}>
                    {t("runs.executionOpen")}
                    <Icon name="chevron-right" size={12} />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {pages > 1 && (
        <div
          style={{
            display: "flex",
            gap: 8,
            alignItems: "center",
            marginTop: 12,
            fontSize: 12,
          }}
        >
          <Button small tone="ghost" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            {t("runs.prevPage")}
          </Button>
          <span style={{ color: "var(--text-3)" }}>
            {t("runs.pageOf", { page, pages, total })}
          </span>
          <Button
            small
            tone="ghost"
            disabled={page >= pages}
            onClick={() => setPage((p) => p + 1)}
          >
            {t("runs.nextPage")}
          </Button>
        </div>
      )}
    </div>
  );
}
