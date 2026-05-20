"use client";

/**
 * Agent detail view — header + 4-stat strip + 5 tabs (config|io|code|versions|runs).
 *
 * Ported from `apps/web/public/portal/views/agents.jsx:171-256`.
 * Phase 1/2 deltas:
 *   - D-5: Splitter between list aside and detail (min 260, max 720)
 *   - D-8: TEST badge on test runs
 *   - D-11: TEST · {ago} chip in header that opens the latest test run
 *   - D-4: Test run button uses POST /v1/agents/:name/invoke?testRun=1
 *
 * The page renders the list aside on the left (re-uses compact list) so URL
 * params and direct deep-links land you in the same UX as v1_1.
 */

import { useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ActorTag,
  Badge,
  Button,
  Empty,
  FilterChip,
  SearchInput,
  Splitter,
  StatusDot,
  ViewHeader,
} from "@/app/portal/components";
import { fmtAgo } from "@/lib/format";
import {
  useRaasData,
  type RaasAgent,
  type RaasRun,
} from "@/lib/hooks/data-context";
import { useInvokeAgent } from "@/lib/hooks/useAgents";
import { useTenant } from "@/app/portal/lib/use-tenant";
import { AgentCodeTab } from "@/app/portal/components/agent-code/AgentCodeTab";
import { AgentCodeEdit } from "@/app/portal/components/agent-code/edit-code";
import {
  ConfigTab,
  EditConfigTab,
  IOConfigTab,
  RunsTab,
  VersionsTab,
} from "@/app/portal/components/agents/AgentTabs";
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

export default function AgentDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const tenant = useTenant();
  const selectedId = params?.id ?? "";
  const { agents, runs } = useRaasData();
  const [query, setQuery] = useState("");
  const [actorFilter, setActorFilter] = useState<"all" | "Agent" | "Human">("all");
  const [listW, setListW] = useState(440);
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
  function openRun(id: string) {
    router.push(`/portal/${tenant}/runs/${id}` as never);
  }

  const agent = agents.find((a) => a.id === selectedId);

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
        {/* List aside */}
        <aside
          style={{
            width: listW,
            flexShrink: 0,
            borderRight: "1px solid var(--border)",
            overflow: "auto",
            display: "flex",
            flexDirection: "column",
            minHeight: 0,
          }}
        >
          <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)", display: "flex", gap: 8 }}>
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
            <AgentsListCompact
              agents={filtered}
              stats={stats}
              selectedId={selectedId}
              onPick={openAgent}
            />
          </div>
        </aside>

        <Splitter axis="x" getValue={() => listW} setValue={setListW} min={260} max={720} />

        <div style={{ flex: 1, minWidth: 0, overflow: "auto", minHeight: 0 }}>
          <AgentDetail
            agent={agent}
            stats={stats.get(selectedId)}
            tenant={tenant}
            onOpenWorkflow={() => router.push(`/portal/${tenant}/workflows` as never)}
            onOpenRun={openRun}
            allRuns={runs}
          />
        </div>
      </div>

      {deployOpen && <DeployAgentModal onClose={() => setDeployOpen(false)} models={[]} />}
      {importOpen && <ImportManifestModal onClose={() => setImportOpen(false)} mode="agent" />}
    </div>
  );
}

function AgentsListCompact({
  agents,
  stats,
  selectedId,
  onPick,
}: {
  agents: RaasAgent[];
  stats: Map<string, AgentStats>;
  selectedId: string;
  onPick: (id: string) => void;
}) {
  return (
    <div>
      {agents.map((a) => {
        const s = stats.get(a.id) ?? emptyStats();
        const active = a.id === selectedId;
        return (
          <button
            key={a.id}
            onClick={() => onPick(a.id)}
            style={{
              display: "block",
              width: "100%",
              textAlign: "left",
              padding: "10px 14px",
              borderBottom: "1px solid var(--border)",
              background: active ? "var(--panel-2)" : "transparent",
              borderLeft: active ? "2px solid var(--signal)" : "2px solid transparent",
              transition: "background 0.1s",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
              <ActorTag actor={a.actor} />
              <span className="mono" style={{ fontSize: 10.5, color: "var(--text-3)" }}>{a.id}</span>
              <span
                style={{
                  marginLeft: "auto",
                  fontSize: 10.5,
                  color: "var(--text-3)",
                  fontFamily: "var(--mono)",
                }}
              >
                {s.runs}r{s.errors > 0 && <span style={{ color: "var(--red)" }}> · {s.errors}e</span>}
              </span>
            </div>
            <div style={{ fontSize: 12.5, color: "var(--text)", fontWeight: 500 }}>{a.title}</div>
          </button>
        );
      })}
    </div>
  );
}

function AgentDetail({
  agent,
  stats,
  tenant,
  onOpenWorkflow,
  onOpenRun,
  allRuns,
}: {
  agent: RaasAgent | undefined;
  stats: AgentStats | undefined;
  tenant: string;
  onOpenWorkflow: () => void;
  onOpenRun: (id: string) => void;
  allRuns: RaasRun[];
}) {
  const invoke = useInvokeAgent();
  const [tab, setTab] = useState<"config" | "io" | "code" | "versions" | "runs">("config");
  const [editing, setEditing] = useState(false);
  void tenant; // tenant is in URL via the layout

  if (!agent) return <Empty title="Agent not found" />;

  const recentRuns = allRuns.filter((r) => r.agentId === agent.id).slice(0, 10);
  const testRuns = recentRuns.filter((r) => r.testRun);
  const lastTest = testRuns[0];

  async function handleTestRun() {
    try {
      const data = await invoke.mutateAsync({
        name: agent!.name,
        testRun: true,
        input: agent!.input_data ?? {},
      });
      const id = data.runId ?? data.run_id;
      if (id) onOpenRun(id);
    } catch (err) {
      // Toast wiring lands later — log to console for now.
      console.error("Test run failed", err);
    }
  }

  return (
    <div
      style={{
        padding: 24,
        height: "100%",
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
      }}
    >
      <header style={{ marginBottom: 16, flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
          <ActorTag actor={agent.actor} />
          <Badge tone="muted">{agent.id}</Badge>
          <span className="mono" style={{ fontSize: 11.5, color: "var(--text-3)" }}>{agent.name}</span>
          {lastTest && (
            <button
              onClick={() => onOpenRun(lastTest.id)}
              title={`Latest test run · ${lastTest.id}`}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                padding: "2px 7px",
                fontSize: 10.5,
                fontFamily: "var(--mono)",
                color: "var(--signal)",
                background: "rgba(208,255,0,0.06)",
                border: "1px solid rgba(208,255,0,0.32)",
                borderRadius: 3,
                cursor: "pointer",
              }}
            >
              <StatusDot status={(lastTest.status as never) ?? "idle"} size={6} />
              TEST · {fmtAgo(lastTest.startedAt)}
            </button>
          )}
          <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
            <Button small icon="external" tone="ghost" onClick={onOpenWorkflow}>
              View in graph
            </Button>
            {editing ? (
              <>
                <Button small tone="ghost" onClick={() => setEditing(false)}>
                  Cancel
                </Button>
                <Button small icon="check" tone="primary" onClick={() => setEditing(false)}>
                  Save & deploy
                </Button>
              </>
            ) : (
              <>
                <Button small icon="code" onClick={() => setEditing(true)}>
                  Edit
                </Button>
                <Button small icon="run" tone="primary" onClick={handleTestRun}>
                  Test run
                </Button>
              </>
            )}
          </div>
        </div>
        <h2
          style={{
            margin: "4px 0 6px 0",
            fontSize: 26,
            fontFamily: "var(--display)",
            fontWeight: 400,
          }}
        >
          {agent.title}
        </h2>
        <p
          style={{
            margin: 0,
            fontSize: 13,
            color: "var(--text-2)",
            maxWidth: 720,
            lineHeight: 1.55,
          }}
        >
          {agent.description}
        </p>
      </header>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: 0,
          border: "1px solid var(--border)",
          borderRadius: 6,
          background: "var(--panel)",
          marginBottom: 16,
          flexShrink: 0,
        }}
      >
        <StatCellA label="Runs 24h" value={stats?.runs ?? 0} />
        <StatCellA
          label="Errors"
          value={stats?.errors ?? 0}
          accent={(stats?.errors ?? 0) > 0 ? "var(--red)" : undefined}
        />
        <StatCellA label="P50 latency" value={agent.actor === "Agent" ? "2.4s" : "—"} />
        <StatCellA
          label="Last run"
          value={stats?.lastRun && stats.lastRun > 0 ? fmtAgo(stats.lastRun) : "—"}
        />
      </div>

      <div
        style={{
          display: "flex",
          gap: 0,
          borderBottom: "1px solid var(--border)",
          marginBottom: 16,
          flexShrink: 0,
        }}
      >
        {(["config", "io", "code", "versions", "runs"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              padding: "8px 14px",
              fontSize: 12,
              fontFamily: "var(--mono)",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              color: tab === t ? "var(--text)" : "var(--text-3)",
              borderBottom: `2px solid ${tab === t ? "var(--signal)" : "transparent"}`,
              marginBottom: -1,
            }}
          >
            {t}
          </button>
        ))}
      </div>

      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflow: tab === "code" ? "hidden" : "auto",
        }}
      >
        {tab === "config" && (editing ? <EditConfigTab agent={agent} models={[]} /> : <ConfigTab agent={agent} />)}
        {tab === "io" && <IOConfigTab agent={agent} />}
        {tab === "code" &&
          (editing ? (
            <AgentCodeEdit
              agent={{
                actor: agent.actor,
                name: agent.name,
                typescript_code: agent.typescript_code,
                input_data: agent.input_data,
                ontology_instructions: agent.ontology_instructions,
              }}
              onClose={() => setEditing(false)}
            />
          ) : (
            <AgentCodeTab agent={agent} />
          ))}
        {tab === "versions" && <VersionsTab agent={agent} />}
        {tab === "runs" && <RunsTab runs={recentRuns} onOpenRun={onOpenRun} />}
      </div>
    </div>
  );
}

function StatCellA({
  label,
  value,
  accent,
}: {
  label: string;
  value: string | number;
  accent?: string;
}) {
  return (
    <div style={{ padding: "12px 16px", borderRight: "1px solid var(--border)" }}>
      <div
        style={{
          fontSize: 10,
          fontFamily: "var(--mono)",
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          color: "var(--text-3)",
        }}
      >
        {label}
      </div>
      <div
        style={{
          marginTop: 4,
          fontSize: 18,
          fontFamily: "var(--mono)",
          color: accent ?? "var(--text)",
        }}
      >
        {value}
      </div>
    </div>
  );
}
