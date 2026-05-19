"use client";

import { useEffect, useRef, useState } from "react";

interface Props {
  runId: string;
}

export function LiveLogTail({ runId }: Props) {
  const [lines, setLines] = useState<string[]>([]);
  const [connected, setConnected] = useState(false);
  const ref = useRef<HTMLPreElement>(null);

  useEffect(() => {
    if (!runId) return;
    setLines([]);
    const url = `/v1/runs/${runId}/logs?follow=1`;
    const es = new EventSource(url);
    setConnected(true);
    es.addEventListener("log", (ev) => {
      setLines((prev) => [...prev, ev.data]);
    });
    es.addEventListener("info", (ev) => {
      setLines((prev) => [...prev, `[info] ${ev.data}`]);
    });
    es.addEventListener("error", () => {
      setConnected(false);
    });
    return () => {
      es.close();
      setConnected(false);
    };
  }, [runId]);

  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [lines]);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        minHeight: 0,
      }}
    >
      <div
        style={{
          padding: "8px 14px",
          borderBottom: "1px solid var(--border)",
          fontSize: 11,
          color: "var(--text-3)",
          fontFamily: "var(--mono)",
          display: "flex",
          alignItems: "center",
          gap: 8,
          flexShrink: 0,
        }}
      >
        <span
          className="live-dot"
          style={{
            width: 5,
            height: 5,
            background: connected ? "var(--signal)" : "var(--red)",
            boxShadow: `0 0 6px ${connected ? "var(--signal)" : "var(--red)"}`,
          }}
        />
        {connected ? "LIVE TAIL" : "DISCONNECTED"}
        <span style={{ marginLeft: "auto", color: "var(--text-4)" }}>
          {lines.length} lines
        </span>
      </div>
      <pre
        ref={ref}
        style={{
          flex: 1,
          margin: 0,
          padding: "10px 14px",
          fontFamily: "var(--mono)",
          fontSize: 11,
          color: "var(--text-2)",
          background: "var(--panel-2)",
          overflow: "auto",
          whiteSpace: "pre-wrap",
          wordBreak: "break-all",
          minHeight: 0,
        }}
      >
        {lines.length === 0 ? (
          <span style={{ color: "var(--text-3)" }}>
            No log lines yet for {runId}. Fire an event that triggers this run
            and lines will stream live.
          </span>
        ) : (
          lines.join("\n")
        )}
      </pre>
    </div>
  );
}
