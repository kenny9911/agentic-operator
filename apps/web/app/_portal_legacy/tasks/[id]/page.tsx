import { Badge, Panel, ViewHeader } from "@/components";
import { fmtAgo } from "@/lib/format";
import { tasks as tasksApi } from "@/lib/api-client";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ResolveButtons } from "./_components/ResolveButtons";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function TaskDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const row = await tasksApi.get(id).catch(() => null);
  if (!row) notFound();
  const payload = (row.payloadJson ?? {}) as Record<string, unknown>;
  const resolution = (row.resolutionJson ?? {}) as Record<string, unknown>;

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
        title={row.title}
        subtitle={
          <span>
            <code className="mono">{row.id}</code> · type{" "}
            <span className="mono">{row.type}</span>{" "}
            {row.runId && (
              <>
                · run{" "}
                <Link
                  className="mono"
                  href={`/runs?id=${encodeURIComponent(row.runId)}`}
                  style={{ color: "var(--text-2)" }}
                >
                  {row.runId.slice(0, 14)}…
                </Link>
              </>
            )}
          </span>
        }
        badge={
          <Badge
            tone={
              row.status === "open"
                ? "amber"
                : row.status === "resolved"
                  ? "green"
                  : "muted"
            }
          >
            {row.status}
          </Badge>
        }
        action={
          row.status === "open" ? (
            <ResolveButtons taskId={row.id} />
          ) : (
            <Link
              href="/tasks"
              style={{ fontSize: 11.5, color: "var(--text-3)" }}
            >
              ← back
            </Link>
          )
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
        <Panel title="Context" padded>
          <dl
            style={{
              margin: 0,
              display: "grid",
              gridTemplateColumns: "120px 1fr",
              rowGap: 8,
              columnGap: 14,
              fontSize: 12,
            }}
          >
            <KV label="created" value={row.createdAt ? fmtAgo(row.createdAt.getTime()) : "—"} />
            <KV label="priority" value={row.priority} />
            <KV label="awaiting" value={row.awaitingRole ?? "any operator"} />
            {row.resolvedAt && (
              <KV
                label="resolved"
                value={fmtAgo(row.resolvedAt.getTime())}
              />
            )}
          </dl>
        </Panel>

        <Panel title="Payload" subtitle="from the agent" padded>
          <pre
            style={{
              margin: 0,
              fontFamily: "var(--mono)",
              fontSize: 11.5,
              color: "var(--text-2)",
              background: "var(--panel-2)",
              padding: 10,
              borderRadius: 4,
              overflow: "auto",
              maxHeight: 280,
            }}
          >
            {JSON.stringify(payload, null, 2)}
          </pre>
        </Panel>

        {row.status !== "open" && (
          <Panel
            title="Resolution"
            subtitle={resolution.decision ? String(resolution.decision) : "—"}
            padded
            style={{ gridColumn: "span 2" }}
          >
            <pre
              style={{
                margin: 0,
                fontFamily: "var(--mono)",
                fontSize: 11.5,
                color: "var(--text-2)",
                background: "var(--panel-2)",
                padding: 10,
                borderRadius: 4,
                overflow: "auto",
              }}
            >
              {JSON.stringify(resolution, null, 2)}
            </pre>
          </Panel>
        )}
      </div>
    </div>
  );
}

function KV({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt
        style={{
          color: "var(--text-3)",
          fontFamily: "var(--mono)",
          fontSize: 10.5,
          textTransform: "uppercase",
          letterSpacing: "0.06em",
        }}
      >
        {label}
      </dt>
      <dd style={{ margin: 0, color: "var(--text)" }}>{value}</dd>
    </>
  );
}
