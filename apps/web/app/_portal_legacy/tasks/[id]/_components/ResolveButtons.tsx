"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components";

export function ResolveButtons({
  taskId,
  disabled,
}: {
  taskId: string;
  disabled?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function resolve(decision: "approve" | "reject") {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/v1/tasks/${taskId}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision }),
      });
      const body = await r.json();
      if (!body.ok) {
        setError(body.error?.message ?? "failed");
      } else {
        router.refresh();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "network error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
      <Button
        tone="primary"
        icon="check"
        onClick={() => resolve("approve")}
        disabled={busy || disabled}
      >
        Approve
      </Button>
      <Button
        tone="danger"
        icon="x"
        onClick={() => resolve("reject")}
        disabled={busy || disabled}
      >
        Reject
      </Button>
      {error && (
        <span style={{ color: "var(--red)", fontSize: 11.5 }}>{error}</span>
      )}
    </div>
  );
}
