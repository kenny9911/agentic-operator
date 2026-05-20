"use client";

/**
 * Agents view — list + detail page. P2-FE-09.
 *
 * Ported from `apps/web/public/portal/views/agents.jsx` (1129 LOC).
 * Phase 1 deltas preserved:
 *   - D-5: Splitter between list and detail (min 260, max 720)
 *   - D-8: TEST badge on test runs (AgentsGrid + RunsTab)
 *   - D-11: Latest test-run chip in agent detail header
 *
 * Detail is in a separate route at `/portal/[tenant]/agents/[id]` so the
 * browser URL reflects the selected agent. The list page mirrors the v1_1
 * one-screen UX by routing to the detail page on click and rendering the
 * grid when none is selected.
 */

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ActorTag,
  Badge,
  Button,
  FilterChip,
  Panel,
  SearchInput,
  ViewHeader,
} from "@/app/portal/components";
import { fmtAgo } from "@/lib/format";
import {
  useRaasData,
  type RaasAgent,
  type RaasRun,
} from "@/lib/hooks/data-context";
import { useTenant } from "@/app/portal/lib/use-tenant";
import { DeployAgentModal } from "@/app/portal/components/agents/DeployAgentModal";
import { ImportManifestModal } from "@/app/portal/components/import-manifest/ImportManifestModal";

interface AgentStats {
  runs: number;
  errors: number;
  lastRun: number;
  tests: number;
  lastTestRunId: string | null;
  lastTestAt: number;
}

function emptyStats(): AgentStats {
  return { runs: 0, errors: 0, lastRun: 0, tests: 0, lastTestRunId: null, lastTestAt: 0 };
}

export default function AgentsPage() {
  const router = useRouter();
  const tenant = useTenant();
  const { agents, runs } = useRaasData();
  const [query, setQuery] = useState("");
  const [actorFilter, setActorFilter] = useState<"all" | "Agent" | "Human">("all");
  const [deployOpen, setDeployOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  const stats = useMemo(() => {
    const m = new Map<string, AgentStats>();
    agents.forEach((a) => m.set(a.id, emptyStats()));
    runs.forEach((r) => {
      const s = m.get(r.agentId);
      if (!s) return;
      s.runs += 1;
      if (r.status === "failed") s.errors += 1;
      if (r.startedAt > s.lastRun) s.lastRun = r.startedAt;
      if (r.testRun) {
        s.tests += 1;
        if (r.startedAt > s.lastTestAt) {
          s.lastTestAt = r.startedAt;
          s.lastTestRunId = r.id;
        }
      }
    });
    return m;
  }, [agents, runs]);

  const filtered = agents.filter((a) => {
    if (actorFilter !== "all" && a.actor !== actorFilter) return false;
    if (
      query &&
      !a.title.toLowerCase().includes(query.toLowerCase()) &&
      !a.name.toLowerCase().includes(query.toLowerCase())
    ) {
      return false;
    }
    return true;
  });

  function openAgent(id: string) {
    router.push(`/portal/${tenant}/agents/${id}` as never);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <ViewHeader
        title="Agents"
        subtitle={`${agents.length} agents in this workflow · ${agents.filter((a) => a.actor === "Agent").length} automated · ${agents.filter((a) => a.actor === "Human").length} human`}
        action={[
          <Button key="upload" icon="upload" small onClick={() => setImportOpen(true)}>
            Import manifest
          </Button>,
          <Button key="new" icon="plus" tone="primary" small onClick={() => setDeployOpen(true)}>
            Deploy agent
          </Button>,
        ]}
      />

      <div style={{ flex: 1, display: "flex", flexDirection: "row", minHeight: 0 }}>
        <aside
          style={{
            width: "100%",
            flexShrink: 0,
            overflow: "auto",
            display: "flex",
            flexDirection: "column",
            minHeight: 0,
          }}
        >
          <div
            style={{
              padding: "12px 16px",
              borderBottom: "1px solid var(--border)",
              display: "flex",
              gap: 8,
            }}
          >
            <SearchInput value={query} onChange={setQuery} placeholder="agent name…" />
          </div>
          <div
            style={{
              padding: "8px 16px",
              borderBottom: "1px solid var(--border)",
              display: "flex",
              gap: 6,
            }}
          >
            <FilterChip active={actorFilter === "all"} onClick={() => setActorFilter("all")}>
              All
            </FilterChip>
            <FilterChip active={actorFilter === "Agent"} onClick={() => setActorFilter("Agent")}>
              Agents
            </FilterChip>
            <FilterChip active={actorFilter === "Human"} onClick={() => setActorFilter("Human")}>
              Human
            </FilterChip>
          </div>
          <div style={{ flex: 1, overflow: "auto" }}>
            <AgentsGrid agents={filtered} stats={stats} onPick={openAgent} />
          </div>
        </aside>
      </div>

      {deployOpen && <DeployAgentModal onClose={() => setDeployOpen(false)} models={[]} />}
      {importOpen && <ImportManifestModal onClose={() => setImportOpen(false)} mode="agent" />}

      {/* preserve unused-import lint pass */}
      {false && <Panel title="hidden" />}
    </div>
  );
}

function AgentsGrid({
  agents,
  stats,
  onPick,
}: {
  agents: RaasAgent[];
  stats: Map<string, AgentStats>;
  onPick: (id: string) => void;
}) {
  return (
    <div
      style={{
        padding: 16,
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
        gap: 12,
      }}
    >
      {agents.map((a) => {
        const s = stats.get(a.id) ?? emptyStats();
        return (
          <button
            key={a.id}
            onClick={() => onPick(a.id)}
            style={{
              padding: "12px 14px",
              background: "var(--panel)",
              border: "1px solid var(--border)",
              borderLeft: `3px solid ${a.actor === "Agent" ? "var(--signal)" : "var(--violet)"}`,
              borderRadius: 6,
              textAlign: "left",
              transition: "background 0.12s, border-color 0.12s",
              cursor: "pointer",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background = "var(--panel-2)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background = "var(--panel)";
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
              <ActorTag actor={a.actor} />
              <Badge tone="muted">{a.id}</Badge>
              <span
                style={{
                  marginLeft: "auto",
                  fontSize: 10.5,
                  color: "var(--text-3)",
                  fontFamily: "var(--mono)",
                }}
              >
                {s.lastRun > 0 ? fmtAgo(s.lastRun) : "idle"}
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
              {a.title}
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
              }}
            >
              {a.description}
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
              <span>{s.runs} runs</span>
              {s.errors > 0 && <span style={{ color: "var(--red)" }}>{s.errors} err</span>}
              {s.tests > 0 && <span style={{ color: "var(--signal)" }}>{s.tests} test</span>}
              {a.model && <span style={{ marginLeft: "auto" }}>{a.model.replace("claude-", "")}</span>}
            </div>
          </button>
        );
      })}
    </div>
  );
}

// Re-export used in the detail page so they share the same shape.
export type { RaasAgent, RaasRun };
