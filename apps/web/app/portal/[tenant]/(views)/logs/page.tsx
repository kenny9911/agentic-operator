"use client";

/**
 * Logs — file-tree log explorer (P2-FE-13).
 *
 * Tree-based exploration is currently unwired: no `/v1/logs?listFiles`
 * endpoint exists yet. To avoid the previous behaviour of showing a
 * hardcoded RAAS tree (`run-01000.log` from 2026-05-16 etc.) and a
 * synthetic matchResume body for every tenant — making the view look like
 * it had real data when it didn't — we render a clear empty state that
 * points operators at the Runs view, where per-run SSE log tailing
 * (`/v1/runs/:runId/logs?follow=1`) actually works against live data.
 */

import Link from "next/link";
import { Button, Empty, ViewHeader } from "@/app/portal/components";
import { useTenant } from "@/app/portal/lib/use-tenant";

export default function LogsPage() {
  const tenant = useTenant();
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <ViewHeader
        title="Logs"
        subtitle="Per-run logs are streamed via SSE on each run detail page (`/v1/runs/:runId/logs?follow=1`). A workspace-wide log explorer is not yet wired up."
      />
      <div
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 32,
        }}
      >
        <div style={{ maxWidth: 480 }}>
          <Empty
            title="Log explorer pending"
            hint={`File-backed logs live under data/logs/${tenant}/ (events ndjson + per-run .log files). The tree view + grep/tail UI is on the roadmap — for now, open a run from the Runs view to follow its log over SSE in real time.`}
          />
          <div style={{ display: "flex", justifyContent: "center", marginTop: 16 }}>
            <Link
              href={`/portal/${tenant}/runs` as never}
              style={{ textDecoration: "none" }}
            >
              <Button icon="external" small>
                Go to Runs
              </Button>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

