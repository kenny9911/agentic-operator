import { readPrefs } from "@/lib/prefs";
import { counts } from "@/lib/api-client";
import { Sidebar } from "./_components/Sidebar";
import { TopBar } from "./_components/TopBar";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Portal shell — sidebar (232px) + main column (topbar + view).
 * Server component: reads prefs cookie + fetches live counts from apps/api.
 */
export default async function PortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const prefs = await readPrefs();
  const c = await counts().catch(() => ({
    agents: 0,
    runningRuns: 0,
    openTasks: 0,
  } as Awaited<ReturnType<typeof counts>>));

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "232px 1fr",
        height: "100vh",
        background: "var(--bg)",
        overflow: "hidden",
      }}
    >
      <Sidebar
        activeTenantId={prefs.tenant}
        agentCount={c.agents}
        liveRunCount={c.runningRuns}
        taskCount={c.openTasks}
      />
      <main
        style={{
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          minWidth: 0,
        }}
      >
        <TopBar initialLiveStream={prefs.liveStream} />
        <div
          style={{
            flex: 1,
            overflow: "hidden",
            minHeight: 0,
            position: "relative",
          }}
        >
          {children}
        </div>
      </main>
    </div>
  );
}
