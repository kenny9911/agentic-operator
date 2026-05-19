import { ActorTag, Badge, Empty, ViewHeader } from "@/components";
import { fmtAgo } from "@/lib/format";
import { agents as agentsApi } from "@/lib/api-client";
import type { ListAgentRow } from "@agentic/contracts";
import Link from "next/link";
import { AgentsHeaderActions } from "./_components/HeaderActions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

/** Numeric sort for kebab ids like "1-1", "1-2", "2", "11-1": rank = major*1000 + minor. */
function kebabSortKey(k: string): number {
  const m = k.match(/^(\d+)(?:-(\d+))?/);
  if (!m) return 999_999;
  const major = parseInt(m[1]!, 10);
  const minor = m[2] ? parseInt(m[2], 10) : 0;
  return major * 1000 + minor;
}

interface SearchParams {
  q?: string;
  actor?: "all" | "Agent" | "Human";
}

export default async function AgentsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const q = (params.q ?? "").trim();
  const actorFilter = params.actor ?? "all";

  const all = await agentsApi.list();
  // Sort by kebabId numerically (1-1, 1-2, 2, 3, 3-2, 4, …) so the grid
  // reads in workflow order, like the prototype.
  all.sort((a, b) => kebabSortKey(a.kebabId) - kebabSortKey(b.kebabId));
  const automated = all.filter((a) => a.actor === "Agent").length;
  const human = all.filter((a) => a.actor === "Human").length;

  const filtered = all.filter((a) => {
    if (actorFilter !== "all" && a.actor !== actorFilter) return false;
    if (q) {
      const ql = q.toLowerCase();
      if (
        !(a.title ?? "").toLowerCase().includes(ql) &&
        !a.name.toLowerCase().includes(ql) &&
        !a.kebabId.toLowerCase().includes(ql)
      ) {
        return false;
      }
    }
    return true;
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <ViewHeader
        title="Agents"
        subtitle={`${all.length} agents in this workflow · ${automated} automated · ${human} human`}
        action={<AgentsHeaderActions />}
      />

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          flex: 1,
          minHeight: 0,
        }}
      >
        <form
          action="/agents"
          method="get"
          style={{
            padding: "12px 16px",
            borderBottom: "1px solid var(--border)",
            display: "flex",
            gap: 8,
          }}
        >
          {actorFilter !== "all" && (
            <input type="hidden" name="actor" value={actorFilter} />
          )}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              flex: 1,
              maxWidth: 380,
              padding: "5px 8px",
              background: "var(--panel-2)",
              border: "1px solid var(--border)",
              borderRadius: 4,
            }}
          >
            <svg
              width={12}
              height={12}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              style={{ color: "var(--text-3)" }}
            >
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.35-4.35" />
            </svg>
            <input
              name="q"
              defaultValue={q}
              placeholder="agent name…"
              style={{
                flex: 1,
                background: "transparent",
                border: "none",
                outline: "none",
                color: "var(--text)",
                fontSize: 12,
                fontFamily: "var(--sans)",
              }}
            />
          </div>
        </form>
        <div
          style={{
            padding: "8px 16px",
            borderBottom: "1px solid var(--border)",
            display: "flex",
            gap: 6,
          }}
        >
          {(["all", "Agent", "Human"] as const).map((a) => (
            <ActorChip key={a} active={actorFilter === a} value={a} q={q} />
          ))}
        </div>

        <div style={{ flex: 1, overflow: "auto", padding: 16 }}>
          {filtered.length === 0 ? (
            <Empty title="No agents match" hint="Try clearing the filter" />
          ) : (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
                gap: 12,
              }}
            >
              {filtered.map((a) => (
                <AgentCard key={a.id} agent={a} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ActorChip({
  active,
  value,
  q,
}: {
  active: boolean;
  value: "all" | "Agent" | "Human";
  q?: string;
}) {
  const sp = new URLSearchParams();
  if (value !== "all") sp.set("actor", value);
  if (q) sp.set("q", q);
  const label = value === "all" ? "All" : value === "Agent" ? "Agents" : "Human";
  return (
    <Link
      href={`/agents${sp.toString() ? `?${sp.toString()}` : ""}`}
      style={{
        padding: "3px 9px",
        fontSize: 11,
        fontFamily: "var(--mono)",
        textTransform: "uppercase",
        letterSpacing: "0.04em",
        color: active ? "#000" : "var(--text-2)",
        background: active ? "var(--signal)" : "transparent",
        border: `1px solid ${active ? "var(--signal)" : "var(--border-2)"}`,
        borderRadius: 3,
        textDecoration: "none",
      }}
    >
      {label}
    </Link>
  );
}

function AgentCard({ agent }: { agent: ListAgentRow }) {
  return (
    <Link
      href={`/agents/${agent.kebabId}`}
      style={{
        display: "block",
        textDecoration: "none",
        padding: "12px 14px",
        background: "var(--panel)",
        border: "1px solid var(--border)",
        borderLeft: `3px solid ${agent.actor === "Agent" ? "var(--signal)" : "var(--violet)"}`,
        borderRadius: 6,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          marginBottom: 6,
        }}
      >
        <ActorTag actor={agent.actor} />
        <Badge tone="muted">{agent.kebabId}</Badge>
        <span
          style={{
            marginLeft: "auto",
            fontSize: 10.5,
            color: "var(--text-3)",
            fontFamily: "var(--mono)",
          }}
        >
          {agent.lastRunAt ? fmtAgo(agent.lastRunAt.getTime()) : "idle"}
        </span>
      </div>
      <div
        style={{
          fontSize: 13.5,
          color: "var(--text)",
          fontWeight: 500,
          marginBottom: 4,
          lineHeight: 1.3,
        }}
      >
        {agent.title ?? agent.name}
      </div>
      <div
        style={{
          fontSize: 11.5,
          color: "var(--text-2)",
          lineHeight: 1.5,
          display: "-webkit-box",
          WebkitLineClamp: 2,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
          minHeight: 32,
        }}
      >
        {agent.description ?? "No description provided in the manifest."}
      </div>
      <div
        style={{
          marginTop: 10,
          display: "flex",
          alignItems: "center",
          gap: 10,
          fontSize: 11,
          fontFamily: "var(--mono)",
          color: "var(--text-3)",
        }}
      >
        <span>{agent.runCount} runs</span>
        {agent.errorCount > 0 && (
          <span style={{ color: "var(--red)" }}>{agent.errorCount} err</span>
        )}
        <span style={{ marginLeft: "auto" }} className="mono">
          {agent.name}
        </span>
      </div>
    </Link>
  );
}
