import { Badge, Button, Panel, ViewHeader } from "@/components";
import { fmtAgo } from "@/lib/format";
import { deployments as deploymentsApi } from "@/lib/api-client";
import { RollbackButton } from "./_components/RollbackButton";
import { DeployWizard } from "./_components/DeployWizard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function DeploymentsPage() {
  const { live, list: history } = await deploymentsApi.list();
  const agentCount = live?.agentCount ?? 22;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
      }}
    >
      <ViewHeader
        title="Deployments"
        subtitle="Every agent and workflow version, with rollback. Files in /var/agentic/deploys."
        action={<DeployWizard />}
      />

      <div style={{ flex: 1, overflow: "auto", padding: 20 }}>
        {/* Live versions panel */}
        <Panel
          title="Live versions"
          padded={false}
          style={{ marginBottom: 16 }}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, 1fr)",
              gap: 1,
              background: "var(--border)",
            }}
          >
            <LiveCard
              label="Workflow"
              name={live?.workflowSlug ?? "raas"}
              version={live?.versionString ?? "—"}
              agentCount={agentCount}
              deployedBy={live?.deployedBy ?? "Ops"}
              at={live?.deployedAt ?? null}
            />
            <LiveCard
              label="Runtime"
              name="agentic-operator"
              version="0.6.2"
              agentCount={null}
              deployedBy="Ops"
              at={new Date(Date.now() - 4 * 86_400_000)}
            />
            <LiveCard
              label="Inngest worker"
              name="raas-worker"
              version="prod-08"
              agentCount={null}
              deployedBy="Ops"
              at={new Date(Date.now() - 11 * 3_600_000)}
            />
          </div>
        </Panel>

        <Panel
          title="Deployment history"
          subtitle={`${history.length} deployments`}
          padded={false}
          action={
            <Button small icon="filter" tone="ghost">
              Filter
            </Button>
          }
        >
          {history.length === 0 ? (
            <div
              style={{
                padding: 30,
                textAlign: "center",
                color: "var(--text-3)",
                fontSize: 12,
              }}
            >
              No deployments yet.
            </div>
          ) : (
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                fontSize: 12.5,
              }}
            >
              <thead>
                <tr
                  style={{
                    borderBottom: "1px solid var(--border)",
                    background: "var(--panel)",
                  }}
                >
                  <Th>Status</Th>
                  <Th>Version</Th>
                  <Th>Workflow</Th>
                  <Th>By</Th>
                  <Th>When</Th>
                  <Th>Notes</Th>
                  <Th align="right" />
                </tr>
              </thead>
              <tbody>
                {history.map((d) => (
                  <tr
                    key={d.id}
                    style={{ borderBottom: "1px solid var(--border)" }}
                  >
                    <Td>
                      {d.status === "live" ? (
                        <Badge tone="signal">LIVE</Badge>
                      ) : d.status === "rolled_back" ? (
                        <Badge tone="muted">ROLLED BACK</Badge>
                      ) : (
                        <Badge tone="muted">{d.status}</Badge>
                      )}
                    </Td>
                    <Td>
                      <span className="mono">{d.versionString}</span>
                    </Td>
                    <Td>
                      <span
                        className="mono"
                        style={{ color: "var(--text-2)" }}
                      >
                        {d.workflowSlug}
                      </span>
                    </Td>
                    <Td>
                      <span style={{ color: "var(--text-2)" }}>
                        {d.deployedBy ?? "—"}
                      </span>
                    </Td>
                    <Td>
                      <span style={{ color: "var(--text-3)" }}>
                        {d.deployedAt ? fmtAgo(d.deployedAt.getTime()) : "—"}
                      </span>
                    </Td>
                    <Td>
                      <span style={{ color: "var(--text-2)" }}>
                        {d.note ?? "—"}
                      </span>
                    </Td>
                    <Td align="right">
                      <div
                        style={{
                          display: "flex",
                          gap: 6,
                          justifyContent: "flex-end",
                        }}
                      >
                        <Button small tone="ghost" icon="external">
                          Diff
                        </Button>
                        {d.status === "rolled_back" ? (
                          <RollbackButton
                            deploymentId={d.id}
                            versionString={d.versionString}
                          />
                        ) : d.status === "live" ? (
                          <span
                            style={{
                              fontSize: 11,
                              color: "var(--text-3)",
                              fontFamily: "var(--mono)",
                            }}
                          >
                            (live)
                          </span>
                        ) : (
                          <Button small tone="ghost">
                            Restore
                          </Button>
                        )}
                      </div>
                    </Td>
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

function LiveCard({
  label,
  name,
  version,
  agentCount,
  deployedBy,
  at,
}: {
  label: string;
  name: string;
  version: string;
  agentCount: number | null;
  deployedBy: string;
  at: Date | null;
}) {
  return (
    <div style={{ padding: "14px 16px", background: "var(--panel)" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          marginBottom: 6,
        }}
      >
        <Badge tone="signal">LIVE</Badge>
        <span
          style={{
            fontSize: 10.5,
            fontFamily: "var(--mono)",
            textTransform: "uppercase",
            color: "var(--text-3)",
            letterSpacing: "0.08em",
          }}
        >
          {label}
        </span>
      </div>
      <div
        style={{
          fontSize: 16,
          fontWeight: 500,
          color: "var(--text)",
          lineHeight: 1.2,
          marginBottom: 2,
        }}
      >
        {name}
      </div>
      <div
        className="mono"
        style={{ fontSize: 12, color: "var(--signal)" }}
      >
        {version}
      </div>
      <div
        style={{
          display: "flex",
          gap: 14,
          marginTop: 8,
          fontSize: 11,
          color: "var(--text-3)",
          fontFamily: "var(--mono)",
        }}
      >
        {agentCount != null && <span>{agentCount} agents</span>}
        <span>{at ? fmtAgo(at.getTime()) : "—"}</span>
        <span>· {deployedBy}</span>
      </div>
    </div>
  );
}

function Th({
  children,
  align = "left",
}: {
  children?: React.ReactNode;
  align?: "left" | "right";
}) {
  return (
    <th
      style={{
        textAlign: align,
        padding: "8px 14px",
        fontWeight: 500,
        fontSize: 10,
        fontFamily: "var(--mono)",
        textTransform: "uppercase",
        letterSpacing: "0.08em",
        color: "var(--text-3)",
      }}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  align = "left",
}: {
  children: React.ReactNode;
  align?: "left" | "right";
}) {
  return (
    <td
      style={{
        padding: "8px 14px",
        textAlign: align,
        fontSize: 12,
      }}
    >
      {children}
    </td>
  );
}
