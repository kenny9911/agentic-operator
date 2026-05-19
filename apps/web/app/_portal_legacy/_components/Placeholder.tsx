import { Badge, Panel, ViewHeader } from "@/components";

export function Placeholder({
  title,
  subtitle,
  milestone,
}: {
  title: string;
  subtitle: string;
  milestone: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        overflow: "auto",
      }}
    >
      <ViewHeader
        title={title}
        subtitle={subtitle}
        badge={<Badge tone="muted">{milestone} scaffold</Badge>}
      />
      <div style={{ padding: 24 }}>
        <Panel title="Coming soon" subtitle={milestone}>
          <div
            style={{
              fontSize: 13,
              color: "var(--text-2)",
              lineHeight: 1.6,
            }}
          >
            This view is scaffolded but not yet implemented. Tracked under{" "}
            <span
              style={{ fontFamily: "var(--mono)", color: "var(--signal)" }}
            >
              {milestone}
            </span>{" "}
            in the build plan.
          </div>
        </Panel>
      </div>
    </div>
  );
}
