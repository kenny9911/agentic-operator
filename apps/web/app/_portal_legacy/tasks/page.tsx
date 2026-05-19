import {
  ActorTag,
  Badge,
  Button,
  Empty,
  Icon,
  Kbd,
  Panel,
  ViewHeader,
} from "@/components";
import { fmtAgo } from "@/lib/format";
import { tasks as tasksApi } from "@/lib/api-client";
import type { TaskRow } from "@agentic/contracts";
import Link from "next/link";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

interface SearchParams {
  id?: string;
  pri?: "all" | "high" | "medium" | "low";
}

export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const all = await tasksApi.list();
  const pending = all.filter((t) => t.status === "open");
  const high = pending.filter((t) => t.priority === "high").length;

  const filter = params.pri ?? "all";
  const list =
    filter === "all" ? pending : pending.filter((t) => t.priority === filter);
  const selectedId = params.id ?? list[0]?.id ?? null;
  const selected = pending.find((t) => t.id === selectedId) ?? null;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <ViewHeader
        title="Human tasks"
        subtitle={`${pending.length} pending · ${high} high priority`}
        badge={<Badge tone="amber">{pending.length} OPEN</Badge>}
      />

      <div
        style={{
          flex: 1,
          display: "grid",
          gridTemplateColumns: "420px 1fr",
          minHeight: 0,
        }}
      >
        {/* List */}
        <aside
          style={{
            borderRight: "1px solid var(--border)",
            display: "flex",
            flexDirection: "column",
            minHeight: 0,
          }}
        >
          <div
            style={{
              padding: "10px 14px",
              borderBottom: "1px solid var(--border)",
              display: "flex",
              gap: 6,
            }}
          >
            {(["all", "high", "medium", "low"] as const).map((p) => (
              <PriChip key={p} active={filter === p} value={p} id={params.id} />
            ))}
          </div>
          <div style={{ flex: 1, overflow: "auto" }}>
            {list.length === 0 ? (
              <Empty title="Inbox zero" hint="No pending human tasks" />
            ) : (
              list.map((t) => (
                <TaskRowEl
                  key={t.id}
                  task={t}
                  active={selectedId === t.id}
                  pri={filter}
                />
              ))
            )}
          </div>
        </aside>

        {/* Detail */}
        <div style={{ overflow: "auto", minHeight: 0 }}>
          {selected ? (
            <TaskDetail task={selected} />
          ) : (
            <Empty title="Inbox zero" hint="No pending human tasks" />
          )}
        </div>
      </div>
    </div>
  );
}

function PriChip({
  active,
  value,
  id,
}: {
  active: boolean;
  value: "all" | "high" | "medium" | "low";
  id?: string;
}) {
  const sp = new URLSearchParams();
  if (value !== "all") sp.set("pri", value);
  if (id) sp.set("id", id);
  const label = value === "all" ? "All" : value.toUpperCase();
  return (
    <Link
      href={`/tasks${sp.toString() ? `?${sp.toString()}` : ""}`}
      style={{
        padding: "3px 9px",
        borderRadius: 4,
        border: `1px solid ${active ? "var(--signal-dim)" : "var(--border-2)"}`,
        background: active ? "rgba(208,255,0,0.08)" : "transparent",
        color: active ? "var(--signal)" : "var(--text-2)",
        fontFamily: "var(--mono)",
        fontSize: 10.5,
        textTransform: "uppercase",
        letterSpacing: "0.04em",
        textDecoration: "none",
      }}
    >
      {label}
    </Link>
  );
}

function TaskRowEl({
  task,
  active,
  pri,
}: {
  task: TaskRow;
  active: boolean;
  pri: string;
}) {
  const sp = new URLSearchParams();
  sp.set("id", task.id);
  if (pri && pri !== "all") sp.set("pri", pri);
  return (
    <Link
      href={`/tasks?${sp.toString()}`}
      style={{
        display: "block",
        textAlign: "left",
        padding: "12px 14px",
        borderBottom: "1px solid var(--border)",
        background: active ? "var(--panel-2)" : "transparent",
        borderLeft: active ? "2px solid var(--signal)" : "2px solid transparent",
        textDecoration: "none",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 5,
        }}
      >
        <Badge
          tone={
            task.priority === "high"
              ? "amber"
              : task.priority === "medium"
                ? "blue"
                : "muted"
          }
          style={{ fontSize: 9.5 }}
        >
          {task.priority.toUpperCase()}
        </Badge>
        <span
          className="mono"
          style={{ fontSize: 10.5, color: "var(--text-3)" }}
        >
          {task.id}
        </span>
        <span
          style={{
            marginLeft: "auto",
            fontSize: 10.5,
            color: "var(--text-3)",
            fontFamily: "var(--mono)",
          }}
        >
          {task.createdAt ? fmtAgo(task.createdAt.getTime()) : "—"}
        </span>
      </div>
      <div
        style={{
          fontSize: 12.5,
          color: "var(--text)",
          marginBottom: 3,
          fontWeight: 500,
          lineHeight: 1.3,
        }}
      >
        {task.title}
      </div>
      <div style={{ fontSize: 11, color: "var(--text-3)" }}>
        {task.awaitingRole ?? "operator"}
      </div>
    </Link>
  );
}

function TaskDetail({ task }: { task: TaskRow }) {
  const p = (task.payloadJson ?? {}) as Record<string, unknown>;
  return (
    <div style={{ padding: 24, maxWidth: 920 }}>
      <header style={{ marginBottom: 16 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginBottom: 8,
          }}
        >
          <Badge
            tone={
              task.priority === "high"
                ? "amber"
                : task.priority === "medium"
                  ? "blue"
                  : "muted"
            }
          >
            {task.priority.toUpperCase()} PRIORITY
          </Badge>
          <Badge tone="muted">{task.id}</Badge>
          <ActorTag actor="Human" />
          <span style={{ fontSize: 11, color: "var(--text-3)" }}>
            created{" "}
            {task.createdAt ? fmtAgo(task.createdAt.getTime()) : "—"}
          </span>
        </div>
        <h2
          style={{
            margin: "6px 0 4px 0",
            fontSize: 24,
            fontFamily: "var(--display)",
            fontWeight: 400,
          }}
        >
          {task.title}
        </h2>
        <div style={{ fontSize: 12.5, color: "var(--text-2)" }}>
          Pending {task.type} · awaiting{" "}
          <span style={{ color: "var(--text)" }}>
            {task.awaitingRole ?? "operator"}
          </span>
        </div>
      </header>

      {/* Type-specific payload */}
      <TaskPayload type={task.type} payload={p} />

      {/* Decision actions */}
      <div
        style={{
          marginTop: 20,
          padding: 16,
          background: "var(--panel)",
          border: "1px solid var(--border)",
          borderRadius: 6,
        }}
      >
        <div
          style={{
            fontSize: 10.5,
            fontFamily: "var(--mono)",
            textTransform: "uppercase",
            color: "var(--text-3)",
            letterSpacing: "0.08em",
            marginBottom: 10,
          }}
        >
          Decide
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <Button tone="primary" icon="check">
            {decisionLabel(task.type, "primary")}
          </Button>
          {decisionLabel(task.type, "secondary") && (
            <Button>{decisionLabel(task.type, "secondary")}</Button>
          )}
          <Button tone="ghost">Snooze</Button>
          <span
            style={{
              marginLeft: "auto",
              fontSize: 11,
              color: "var(--text-3)",
            }}
          >
            <Kbd>⌘</Kbd> <Kbd>↵</Kbd> approve · <Kbd>⌘</Kbd> <Kbd>R</Kbd> reject
          </span>
        </div>
      </div>
    </div>
  );
}

function decisionLabel(
  type: string,
  slot: "primary" | "secondary",
): string | null {
  const map: Record<string, { primary: string; secondary: string | null }> = {
    jdReview: { primary: "Approve JD", secondary: "Reject with notes" },
    packageReview: {
      primary: "Approve & submit",
      secondary: "Send back to recruiter",
    },
    resumeFix: { primary: "Mark fixed", secondary: "Re-upload" },
    requirementReClarification: { primary: "Submit answers", secondary: null },
    packageSupplement: { primary: "Mark complete", secondary: null },
    manualPublish: { primary: "Confirm published", secondary: null },
  };
  return map[type]?.[slot] ?? (slot === "primary" ? "Approve" : null);
}

function TaskPayload({
  type,
  payload,
}: {
  type: string;
  payload: Record<string, unknown>;
}) {
  if (type === "jdReview") return <JDReviewPayload payload={payload} />;
  if (type === "packageReview") return <PackagePayload payload={payload} />;
  if (type === "resumeFix") return <ResumeFixPayload payload={payload} />;
  if (type === "requirementReClarification")
    return <ClarificationPayload payload={payload} />;
  if (type === "packageSupplement")
    return <SupplementPayload payload={payload} />;
  if (type === "manualPublish")
    return <ManualPublishPayload payload={payload} />;
  return (
    <Panel title="Payload" padded>
      <pre
        style={{
          margin: 0,
          padding: 10,
          background: "var(--panel-2)",
          border: "1px solid var(--border)",
          borderRadius: 4,
          fontFamily: "var(--mono)",
          fontSize: 11.5,
          color: "var(--text-2)",
          overflow: "auto",
          maxHeight: 320,
        }}
      >
        {JSON.stringify(payload, null, 2)}
      </pre>
    </Panel>
  );
}

function JDReviewPayload({ payload }: { payload: Record<string, unknown> }) {
  const resp = (payload.responsibilities ?? []) as string[];
  const req = (payload.requirements ?? []) as string[];
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: 12,
      }}
    >
      <Panel
        title="Generated JD"
        padded
        action={<Badge tone="muted">draft</Badge>}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 14,
            fontSize: 13,
            color: "var(--text)",
          }}
        >
          <div>
            <Lbl>Title</Lbl>
            <div style={{ fontSize: 14, fontWeight: 500 }}>
              {String(payload.title ?? "—")}
            </div>
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 12,
            }}
          >
            <KV label="Level" value={String(payload.level ?? "—")} mono />
            <KV label="City" value={String(payload.city ?? "—")} />
            <KV label="Salary" value={String(payload.salary ?? "—")} />
            <KV label="Status" value={<Badge tone="signal">DRAFT</Badge>} />
          </div>
          {resp.length > 0 && (
            <div>
              <Lbl>Responsibilities</Lbl>
              <ul
                style={{
                  margin: 0,
                  paddingLeft: 18,
                  fontSize: 12.5,
                  lineHeight: 1.55,
                  display: "flex",
                  flexDirection: "column",
                  gap: 6,
                }}
              >
                {resp.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            </div>
          )}
          {req.length > 0 && (
            <div>
              <Lbl>Requirements</Lbl>
              <ul
                style={{
                  margin: 0,
                  paddingLeft: 18,
                  fontSize: 12.5,
                  lineHeight: 1.55,
                  display: "flex",
                  flexDirection: "column",
                  gap: 6,
                }}
              >
                {req.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </Panel>
      <Panel title="Agent reasoning" padded>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 10,
            fontSize: 12,
            color: "var(--text-2)",
            lineHeight: 1.6,
          }}
        >
          <p style={{ margin: 0 }}>
            Drafted from{" "}
            <span className="mono" style={{ color: "var(--text)" }}>
              {String(payload.subject ?? "—")}
            </span>{" "}
            after clarification.
          </p>
          <div
            style={{
              marginTop: 6,
              padding: 10,
              background: "var(--panel-2)",
              border: "1px dashed var(--border-2)",
              borderRadius: 4,
              fontSize: 11.5,
            }}
          >
            <strong style={{ color: "var(--amber)" }}>Heads up · </strong>
            <span style={{ color: "var(--text-2)" }}>
              Review the JD against the client's most recent feedback before
              approving.
            </span>
          </div>
        </div>
      </Panel>
    </div>
  );
}

function PackagePayload({ payload }: { payload: Record<string, unknown> }) {
  const highlights = (payload.highlights ?? []) as string[];
  const missing = (payload.missingItems ?? []) as string[];
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1.4fr 1fr",
        gap: 12,
      }}
    >
      <Panel
        title="Candidate package"
        padded
        action={
          <Badge tone="signal">SCORE {String(payload.matchScore ?? "—")}</Badge>
        }
      >
        <div
          style={{
            fontSize: 18,
            fontFamily: "var(--display)",
            marginBottom: 12,
          }}
        >
          {String(payload.candidate ?? "—")}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <KV
            label="Match"
            value={`${payload.matchScore ?? "—"}/100`}
            mono
          />
          <KV
            label="Missing items"
            value={
              missing.length === 0 ? (
                <Badge tone="green">COMPLETE</Badge>
              ) : (
                missing.join(", ")
              )
            }
          />
          {highlights.length > 0 && (
            <div>
              <Lbl>Highlights</Lbl>
              <ul
                style={{
                  margin: 0,
                  paddingLeft: 18,
                  fontSize: 12.5,
                  lineHeight: 1.55,
                }}
              >
                {highlights.map((h, i) => (
                  <li key={i}>{h}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
        <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
          <Button small icon="external">
            Resume.pdf
          </Button>
          <Button small icon="external">
            Interview clip
          </Button>
          <Button small icon="external">
            Eval report
          </Button>
        </div>
      </Panel>
      <Panel title="Submission preview" padded>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 8,
            fontSize: 12,
            color: "var(--text)",
          }}
        >
          <KV label="Target" value="Client ATS · WXG queue" />
          <KV label="Method" value="API auto-submit" />
          <KV
            label="Mock dry-run"
            value={<Badge tone="green">OK · req-ack received</Badge>}
          />
          <KV
            label="Will emit"
            value={<Badge tone="green">APPLICATION_SUBMITTED</Badge>}
          />
        </div>
      </Panel>
    </div>
  );
}

function ResumeFixPayload({ payload }: { payload: Record<string, unknown> }) {
  return (
    <Panel
      title="Parse error"
      padded
      action={<Badge tone="red">PARSE FAIL</Badge>}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <KV
          label="File"
          value={
            <span className="mono">{String(payload.file ?? "—")}</span>
          }
        />
        <div>
          <Lbl>Error</Lbl>
          <div
            style={{
              fontSize: 12.5,
              color: "var(--red)",
              padding: 10,
              background: "rgba(255,100,112,0.06)",
              border: "1px solid rgba(255,100,112,0.25)",
              borderRadius: 4,
            }}
          >
            {String(payload.error ?? "—")}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
          <Button small icon="upload">
            Re-upload PDF
          </Button>
          <Button small>Edit parsed fields</Button>
        </div>
      </div>
    </Panel>
  );
}

function ClarificationPayload({
  payload,
}: {
  payload: Record<string, unknown>;
}) {
  const questions = (payload.questions ?? []) as string[];
  return (
    <Panel title="Open questions for client" padded>
      <ol
        style={{
          margin: 0,
          paddingLeft: 18,
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        {questions.map((q, i) => (
          <li
            key={i}
            style={{
              fontSize: 13,
              color: "var(--text)",
              lineHeight: 1.5,
            }}
          >
            {q}
            <input
              placeholder="answer…"
              style={{
                display: "block",
                marginTop: 6,
                width: "100%",
                padding: "6px 10px",
                fontSize: 12,
                background: "var(--panel-2)",
                border: "1px solid var(--border)",
                borderRadius: 4,
                color: "var(--text)",
                fontFamily: "var(--sans)",
                boxSizing: "border-box",
              }}
            />
          </li>
        ))}
      </ol>
    </Panel>
  );
}

function SupplementPayload({
  payload,
}: {
  payload: Record<string, unknown>;
}) {
  const missing = (payload.missing ?? []) as string[];
  return (
    <Panel title="Items requested" padded>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {missing.map((m) => (
          <div
            key={m}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "8px 10px",
              background: "var(--panel-2)",
              border: "1px dashed var(--border-2)",
              borderRadius: 4,
            }}
          >
            <Icon name="upload" size={12} style={{ color: "var(--text-3)" }} />
            <span className="mono" style={{ fontSize: 12, color: "var(--text)" }}>
              {m}
            </span>
            <Button small style={{ marginLeft: "auto" }}>
              Attach
            </Button>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function ManualPublishPayload({
  payload,
}: {
  payload: Record<string, unknown>;
}) {
  return (
    <Panel title="Manual publish required" padded>
      <KV
        label="Channel"
        value={<Badge tone="amber">{String(payload.channel ?? "—")}</Badge>}
      />
      <KV label="Reason" value={String(payload.reason ?? "—")} />
      <div
        style={{
          marginTop: 10,
          padding: 12,
          background: "var(--panel-2)",
          border: "1px dashed var(--border-2)",
          borderRadius: 4,
          fontSize: 12,
          color: "var(--text-2)",
        }}
      >
        Open the generated helper page → copy each field into the channel's
        post composer → return here and confirm.
      </div>
      <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
        <Button small icon="external" tone="primary">
          Open helper page
        </Button>
      </div>
    </Panel>
  );
}

function Lbl({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="mono"
      style={{
        fontSize: 10.5,
        color: "var(--text-3)",
        textTransform: "uppercase",
        letterSpacing: "0.06em",
        marginBottom: 6,
      }}
    >
      {children}
    </div>
  );
}

function KV({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "120px 1fr",
        gap: 8,
        fontSize: 12.5,
        alignItems: "center",
      }}
    >
      <span
        style={{
          fontSize: 10.5,
          fontFamily: "var(--mono)",
          textTransform: "uppercase",
          color: "var(--text-3)",
          letterSpacing: "0.06em",
        }}
      >
        {label}
      </span>
      <span
        style={{
          color: "var(--text)",
          fontFamily: mono ? "var(--mono)" : "var(--sans)",
        }}
      >
        {value}
      </span>
    </div>
  );
}
