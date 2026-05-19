"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components";

export function RollbackButton({
  deploymentId,
  versionString,
}: {
  deploymentId: string;
  versionString: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function go() {
    if (
      !confirm(
        `Roll back to ${versionString}? New events will route to this version's agents. In-flight runs are unaffected.`,
      )
    )
      return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/v1/deployments/${deploymentId}/rollback`, {
        method: "POST",
      });
      const body = await r.json();
      if (!body.ok) setError(body.error?.message ?? "failed");
      else router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "network error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button tone="default" small icon="replay" onClick={go} disabled={busy}>
        Roll back
      </Button>
      {error && (
        <span style={{ color: "var(--red)", fontSize: 11.5, marginLeft: 8 }}>
          {error}
        </span>
      )}
    </>
  );
}
