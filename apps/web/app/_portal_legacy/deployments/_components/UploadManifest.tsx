"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Panel } from "@/components";

export function UploadManifest() {
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    version?: string;
    diff?: { added: string[]; modified: string[]; removed: string[] };
  } | null>(null);
  const router = useRouter();

  async function onUpload() {
    setBusy(true);
    setError(null);
    setResult(null);
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      setError("manifest is not valid JSON");
      setBusy(false);
      return;
    }
    const body = Array.isArray(parsed)
      ? { manifest: parsed }
      : { ...(parsed as object) };
    try {
      const r = await fetch("/v1/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await r.json();
      if (!j.ok) {
        setError(j.error?.message ?? "upload failed");
      } else {
        setResult(j.data);
        router.refresh();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "network error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel
      title="Mode 1 — Manifest upload"
      subtitle="paste workflow JSON"
      padded
    >
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder='[{"id":"1","name":"...","actor":["Agent"],"trigger":["..."],"actions":[...],"triggered_event":["..."]}]'
        rows={10}
        style={{
          width: "100%",
          background: "var(--panel-2)",
          color: "var(--text)",
          fontFamily: "var(--mono)",
          fontSize: 11,
          border: "1px solid var(--border-2)",
          borderRadius: 4,
          padding: 10,
          boxSizing: "border-box",
          resize: "vertical",
        }}
      />
      <div
        style={{
          marginTop: 10,
          display: "flex",
          alignItems: "center",
          gap: 10,
        }}
      >
        <Button
          tone="primary"
          icon="upload"
          onClick={onUpload}
          disabled={busy || !text.trim()}
        >
          {busy ? "Uploading…" : "Validate & deploy"}
        </Button>
        {error && (
          <span style={{ color: "var(--red)", fontSize: 11.5 }}>{error}</span>
        )}
      </div>
      {result && (
        <div
          style={{
            marginTop: 14,
            fontSize: 11.5,
            fontFamily: "var(--mono)",
            color: "var(--text-2)",
          }}
        >
          <div style={{ color: "var(--signal)" }}>
            ✓ deployed version <strong>{result.version}</strong>
          </div>
          {result.diff && (
            <div style={{ marginTop: 6 }}>
              <span style={{ color: "var(--green)" }}>
                +{result.diff.added.length} added
              </span>{" "}
              <span style={{ color: "var(--amber)" }}>
                ~{result.diff.modified.length} modified
              </span>{" "}
              <span style={{ color: "var(--red)" }}>
                −{result.diff.removed.length} removed
              </span>
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}
