import {
  ActorTag,
  Badge,
  Panel,
  StatusDot,
  ViewHeader,
  type StatusName,
} from "@/components";
import { fmtAgo, fmtDur } from "@/lib/format";
import { readPrefs } from "@/lib/prefs";
import { agents as agentsApi } from "@/lib/api-client";
import { notFound } from "next/navigation";
import Link from "next/link";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATUS_TO_DOT: Record<string, StatusName> = {
  running: "running",
  ok: "ok",
  failed: "failed",
  waiting: "waiting",
  queued: "waiting",
  cancelled: "paused",
};

export default async function AgentDetailPage({
  params,
}: {
  params: Promise<{ kebab: string }>;
}) {
  const { kebab } = await params;
  await readPrefs();
  const detail = await agentsApi.get(kebab).catch(() => null);
  if (!detail) notFound();
  const agent = detail;
  const recentRuns = detail.recentRuns;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        overflow: "auto",
      }}
    >
      <ViewHeader
        title={agent.title ?? agent.name}
        subtitle={
          <span>
            <code className="mono">{agent.kebabId}</code> · workflow{" "}
            <span className="mono">{agent.workflowSlug}</span> v
            <span className="mono">{agent.workflowVersion}</span>
          </span>
        }
        badge={<ActorTag actor={agent.actor} />}
        action={
          <Link
            href="/agents"
            style={{ fontSize: 11.5, color: "var(--text-3)" }}
          >
            ← back to agents
          </Link>
        }
      />

      <div
        style={{
          padding: 24,
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 18,
        }}
      >
        <Panel title="Triggers" subtitle={`${agent.triggers.length} listed`} padded>
          {agent.triggers.length === 0 ? (
            <span style={{ color: "var(--text-3)", fontSize: 12 }}>
              none — fired only via manual entry
            </span>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {agent.triggers.map((t) => (
                <Badge key={t} tone="blue">
                  {t}
                </Badge>
              ))}
            </div>
          )}
        </Panel>

        <Panel
          title="Emits"
          subtitle={`${agent.triggeredEvents.length} possible`}
          padded
        >
          {agent.triggeredEvents.length === 0 ? (
            <span style={{ color: "var(--text-3)", fontSize: 12 }}>—</span>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {agent.triggeredEvents.map((t) => (
                <Badge key={t} tone="green">
                  {t}
                </Badge>
              ))}
            </div>
          )}
        </Panel>

        <Panel
          title="Actions"
          subtitle={`${agent.actions.length} steps in order`}
          padded={false}
          style={{ gridColumn: "span 2" }}
        >
          {agent.actions.length === 0 ? (
            <div
              style={{
                padding: 30,
                textAlign: "center",
                color: "var(--text-3)",
                fontSize: 12,
              }}
            >
              No actions defined.
            </div>
          ) : (
            <ol style={{ margin: 0, padding: 0, listStyle: "none" }}>
              {agent.actions.map((a, i) => (
                <li
                  key={i}
                  style={{
                    padding: "12px 14px",
                    borderTop: i === 0 ? "none" : "1px solid var(--border)",
                    fontSize: 12,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      marginBottom: 4,
                    }}
                  >
                    <span
                      className="mono"
                      style={{
                        fontSize: 10,
                        color: "var(--text-3)",
                        textTransform: "uppercase",
                      }}
                    >
                      step {a.order}
                    </span>
                    <span style={{ fontSize: 13, color: "var(--text)" }}>
                      {a.name}
                    </span>
                    <Badge
                      tone={
                        a.type === "tool"
                          ? "signal"
                          : a.type === "manual"
                            ? "violet"
                            : "blue"
                      }
                    >
                      {a.type}
                    </Badge>
                  </div>
                  <div style={{ color: "var(--text-3)", lineHeight: 1.5 }}>
                    {a.description}
                  </div>
                  {a.condition && (
                    <div
                      style={{
                        fontSize: 11,
                        color: "var(--text-3)",
                        marginTop: 4,
                        fontFamily: "var(--mono)",
                      }}
                    >
                      ⊢ {a.condition}
                    </div>
                  )}
                </li>
              ))}
            </ol>
          )}
        </Panel>

        <Panel
          title="Recent runs"
          subtitle={`${recentRuns.length}`}
          padded={false}
          style={{ gridColumn: "span 2" }}
        >
          {recentRuns.length === 0 ? (
            <div
              style={{
                padding: 30,
                textAlign: "center",
                color: "var(--text-3)",
                fontSize: 12,
              }}
            >
              No runs for this agent yet.
            </div>
          ) : (
            <table
              style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}
            >
              <tbody>
                {recentRuns.map((r) => (
                  <tr key={r.id} style={{ borderTop: "1px solid var(--border)" }}>
                    <td style={{ padding: "8px 14px", width: 24 }}>
                      <StatusDot status={STATUS_TO_DOT[r.status] ?? "idle"} />
                    </td>
                    <td style={{ padding: "8px 14px" }} className="mono">
                      <Link
                        href={`/runs?id=${encodeURIComponent(r.id)}`}
                        style={{ color: "var(--text)" }}
                      >
                        {r.id.slice(0, 14)}…
                      </Link>
                    </td>
                    <td
                      style={{
                        padding: "8px 14px",
                        color: "var(--text-3)",
                        fontFamily: "var(--mono)",
                      }}
                    >
                      {r.subject ?? "—"}
                    </td>
                    <td
                      style={{
                        padding: "8px 14px",
                        textAlign: "right",
                        color: "var(--text-3)",
                        fontFamily: "var(--mono)",
                      }}
                    >
                      {fmtDur(r.durationMs)}
                    </td>
                    <td
                      style={{
                        padding: "8px 14px",
                        textAlign: "right",
                        color: "var(--text-3)",
                      }}
                    >
                      {r.startedAt ? fmtAgo(r.startedAt.getTime()) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
      </div>
    </div>
  );
}
