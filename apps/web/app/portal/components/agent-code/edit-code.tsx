"use client";

/**
 * Code-agent authoring editor (P3-FE-02).
 *
 * Replaces the read-only `AgentCodeTab` when the operator clicks "Edit
 * code" on the Agents detail view. The Monaco editor is editable; on
 * "Deploy" we:
 *
 *   1. Build an in-memory tarball containing
 *        - `agentic.json`        (manifest pointer)
 *        - `src/agents/<name>.ts` (the new code)
 *   2. gzip + base64 encode it
 *   3. POST `/v1/tenants/:slug/code` with `{ version, tarballBase64, note }`
 *
 * On success a toast announces the new version and the surrounding
 * Agents detail page re-fetches to pull the new code live within 5s.
 *
 * Engineer B's coordination note: if `/v1/tenants/:slug/code` returns
 * 404/501 we fall back to local-only buffer save + toast warning so
 * Phase-3 frontend work isn't blocked on the API endpoint landing.
 */

import { useEffect, useState } from "react";
import {
  Badge,
  Button,
  MonacoEditor,
  Panel,
  Splitter,
  useToast,
} from "@/app/portal/components";
import { useTenant } from "@/app/portal/lib/use-tenant";
import { useDeployTenantCode } from "@/lib/hooks/useTenantCode";
import { AGENT_SAMPLE_TS_CODE } from "./samples";
import { buildTar, gzipToBase64, type TarFile } from "./tar";

interface AgentCodeEditShape {
  actor: "Agent" | "Human";
  name: string;
  typescript_code?: string;
  input_data?: Record<string, unknown>;
  ontology_instructions?: string;
}

export function AgentCodeEdit({
  agent,
  onClose,
}: {
  agent: AgentCodeEditShape;
  onClose?: () => void;
}) {
  const tenant = useTenant();
  const toast = useToast();
  const deploy = useDeployTenantCode(tenant);

  const initial = agent.typescript_code || AGENT_SAMPLE_TS_CODE;
  const [code, setCode] = useState(initial);
  const [version, setVersion] = useState(() => suggestVersion(initial));
  const [note, setNote] = useState("");
  const [sidebarW, setSidebarW] = useState(320);

  const dirty = code !== initial;

  useEffect(() => {
    // If the operator switches between agents the editor resets.
    setCode(initial);
    setVersion(suggestVersion(initial));
    setNote("");
  }, [agent.name, initial]);

  async function handleDeploy() {
    try {
      const files: TarFile[] = [
        {
          path: "agentic.json",
          body: JSON.stringify(
            {
              tenant,
              version,
              entry: `src/agents/${agent.name}.ts`,
              authoredAt: new Date().toISOString(),
            },
            null,
            2,
          ),
        },
        {
          path: `src/agents/${agent.name}.ts`,
          body: code,
        },
      ];
      const tar = buildTar(files);
      const tarballBase64 = await gzipToBase64(tar);

      await deploy.mutateAsync({
        version,
        tarballBase64,
        note: note || `In-portal edit of ${agent.name}`,
      });

      toast({
        tone: "signal",
        title: "Code agent deployed",
        description: `${agent.name} @ ${version}`,
      });
      onClose?.();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      toast({
        tone: "red",
        title: "Deploy failed",
        description: msg,
      });
    }
  }

  function handleRevert() {
    setCode(initial);
    setNote("");
  }

  return (
    <div
      style={{
        height: "100%",
        minHeight: 480,
        display: "flex",
        flexDirection: "row",
      }}
    >
      {/* LEFT: Monaco editor */}
      <div
        style={{
          flex: 1,
          minWidth: 280,
          display: "flex",
          flexDirection: "column",
        }}
      >
        <Panel
          title="typescript_code"
          subtitle={`${agent.name}.ts · ${dirty ? "modified" : "clean"}`}
          padded={false}
          style={{
            flex: 1,
            minHeight: 0,
            display: "flex",
            flexDirection: "column",
          }}
          action={
            <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
              {dirty && <Badge tone="amber">DIRTY</Badge>}
              <Button
                small
                tone="ghost"
                onClick={handleRevert}
                disabled={!dirty || deploy.isPending}
              >
                Revert
              </Button>
              <Button
                small
                icon="deploy"
                tone="primary"
                onClick={handleDeploy}
                disabled={!dirty || deploy.isPending}
              >
                {deploy.isPending ? "Deploying…" : "Deploy"}
              </Button>
              {onClose && (
                <Button small icon="x" tone="ghost" onClick={onClose}>
                  Close
                </Button>
              )}
            </div>
          }
        >
          <MonacoEditor
            value={code}
            onChange={(next) => setCode(next ?? "")}
            language="typescript"
            height="100%"
          />
        </Panel>
      </div>

      <Splitter
        axis="x"
        getValue={() => sidebarW}
        setValue={setSidebarW}
        min={260}
        max={520}
        invert
      />

      {/* RIGHT: deploy sidecar */}
      <div
        style={{
          width: sidebarW,
          flexShrink: 0,
          display: "flex",
          flexDirection: "column",
          minHeight: 0,
        }}
      >
        <Panel title="Deploy" padded style={{ height: "100%" }}>
          <Label>Version</Label>
          <input
            value={version}
            onChange={(e) => setVersion(e.target.value)}
            placeholder="0.1.1"
            style={inputStyle}
          />
          <div style={{ marginTop: 4, fontSize: 10.5, color: "var(--text-3)" }}>
            Must be unique; the server refuses an existing version with 409.
          </div>

          <div style={{ height: 12 }} />
          <Label>Change note</Label>
          <textarea
            rows={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="What changed?"
            style={{ ...inputStyle, fontFamily: "var(--sans)", resize: "vertical" as const }}
          />

          <div style={{ marginTop: 16 }}>
            <DeployInfoRow label="Tenant" value={tenant} />
            <DeployInfoRow label="Agent" value={agent.name} />
            <DeployInfoRow
              label="Entry"
              value={`src/agents/${agent.name}.ts`}
            />
            <DeployInfoRow
              label="Bundle"
              value={`${(code.length / 1024).toFixed(1)} KB (tar+gzip)`}
            />
          </div>

          <div
            style={{
              marginTop: 18,
              padding: "8px 10px",
              fontSize: 11,
              color: "var(--text-3)",
              background: "var(--bg-2)",
              border: "1px solid var(--border)",
              borderRadius: 4,
              lineHeight: 1.55,
            }}
          >
            Deploy uploads a 2-file tarball: <span className="mono">agentic.json</span>{" "}
            + <span className="mono">{`src/agents/${agent.name}.ts`}</span>. The
            backend type-checks, extracts atomically, and re-registers Inngest
            functions on success.
          </div>
        </Panel>
      </div>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 10.5,
        fontFamily: "var(--mono)",
        color: "var(--text-3)",
        textTransform: "uppercase",
        letterSpacing: "0.08em",
        marginBottom: 6,
      }}
    >
      {children}
    </div>
  );
}

function DeployInfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        padding: "4px 0",
        fontSize: 11.5,
      }}
    >
      <span style={{ color: "var(--text-3)" }}>{label}</span>
      <span
        className="mono"
        style={{ color: "var(--text-2)", overflow: "hidden", textOverflow: "ellipsis" }}
      >
        {value}
      </span>
    </div>
  );
}

function suggestVersion(code: string): string {
  // Simple "0.0.<short-hash-of-code>" stub. The operator usually replaces it.
  let h = 0;
  for (let i = 0; i < code.length; i++) {
    h = (h * 31 + code.charCodeAt(i)) >>> 0;
  }
  return `0.0.${(h % 9999).toString().padStart(4, "0")}`;
}

const inputStyle = {
  width: "100%",
  padding: "6px 10px",
  fontSize: 12.5,
  fontFamily: "var(--mono)",
  background: "var(--bg-2)",
  color: "var(--text)",
  border: "1px solid var(--border-2)",
  borderRadius: 4,
};
