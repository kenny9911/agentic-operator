import { Badge, Button, ViewHeader } from "@/components";
import { fmtAgo, fmtTime } from "@/lib/format";
import {
  events as eventsApi,
  ontology,
  type EventTypeRow as EventTypeCatalogRow,
} from "@/lib/api-client";
import type { EventRow } from "@agentic/contracts";
import Link from "next/link";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

interface SearchParams {
  name?: string;
  cat?: string;
}

function badgeTone(
  color: string | null | undefined,
): "default" | "green" | "blue" | "amber" | "red" | "muted" {
  const map: Record<
    string,
    "default" | "green" | "blue" | "amber" | "red" | "muted"
  > = {
    green: "green",
    blue: "blue",
    amber: "amber",
    red: "red",
    muted: "muted",
  };
  return color ? (map[color] ?? "default") : "default";
}

function colorDotBg(color: string | null | undefined): string {
  const map: Record<string, string> = {
    green: "var(--green)",
    blue: "var(--blue)",
    amber: "var(--amber)",
    red: "var(--red)",
    muted: "var(--text-3)",
  };
  return color ? (map[color] ?? "var(--text-3)") : "var(--text-3)";
}

export default async function EventsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const [allEvents, eventTypesList] = await Promise.all([
    eventsApi.list({ limit: 200 }),
    ontology.eventTypes().catch(() => [] as EventTypeCatalogRow[]),
  ]);

  let filtered = allEvents;
  if (params.name && params.name !== "all") {
    filtered = filtered.filter((e) => e.name === params.name);
  }
  if (params.cat && params.cat !== "all") {
    filtered = filtered.filter((e) => e.category === params.cat);
  }

  // Histogram (60 buckets, 1 min each)
  const now = Date.now();
  const buckets = new Array(60).fill(0);
  for (const e of filtered) {
    if (!e.receivedAt) continue;
    const idx = Math.floor((now - e.receivedAt.getTime()) / 60_000);
    if (idx >= 0 && idx < 60) buckets[59 - idx]++;
  }
  const peak = Math.max(1, ...buckets);

  // Counts per event name (for sidebar)
  const countByName = new Map<string, number>();
  for (const e of allEvents)
    countByName.set(e.name, (countByName.get(e.name) ?? 0) + 1);

  // Categories from the event_types catalog
  const cats = Array.from(new Set(eventTypesList.map((e) => e.category ?? "other"))).sort();

  const selected = filtered[0];

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <ViewHeader
        title="Events"
        subtitle={`${filtered.length} events · ${eventTypesList.length} event types · live tail`}
        badge={
          <Badge tone="signal">
            <span className="live-dot" style={{ width: 5, height: 5 }} /> LIVE
          </Badge>
        }
        action={<Button icon="replay" small>Replay window</Button>}
      />

      {/* Histogram strip */}
      <div
        style={{
          padding: "12px 24px",
          borderBottom: "1px solid var(--border)",
          background: "var(--panel)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "flex-end",
            gap: 1,
            height: 38,
          }}
        >
          {buckets.map((v, i) => (
            <div
              key={i}
              style={{
                flex: 1,
                height: `${Math.max(2, (v / peak) * 100)}%`,
                background:
                  i === buckets.length - 1
                    ? "var(--signal)"
                    : v > 0
                      ? `rgba(208,255,0,${0.25 + (v / peak) * 0.55})`
                      : "var(--border)",
              }}
            />
          ))}
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            marginTop: 4,
            fontSize: 10,
            fontFamily: "var(--mono)",
            color: "var(--text-3)",
          }}
        >
          <span>60m ago</span>
          <span>events / minute · peak {peak}</span>
          <span>now</span>
        </div>
      </div>

      <div
        style={{
          flex: 1,
          display: "grid",
          gridTemplateColumns: "260px 1fr 360px",
          minHeight: 0,
        }}
      >
        {/* Filter sidebar */}
        <aside
          style={{
            borderRight: "1px solid var(--border)",
            overflow: "auto",
            padding: "14px 16px",
          }}
        >
          <div
            style={{
              fontSize: 10.5,
              fontFamily: "var(--mono)",
              textTransform: "uppercase",
              color: "var(--text-3)",
              letterSpacing: "0.08em",
              marginBottom: 6,
            }}
          >
            Category
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
            <CatChip
              active={!params.cat || params.cat === "all"}
              label="All"
              q={{ name: params.name, cat: undefined }}
            />
            {cats.map((c) => (
              <CatChip
                key={c}
                active={params.cat === c}
                label={c}
                q={{ name: params.name, cat: c }}
              />
            ))}
          </div>

          <div style={{ marginTop: 18 }}>
            <div
              style={{
                fontSize: 10.5,
                fontFamily: "var(--mono)",
                textTransform: "uppercase",
                color: "var(--text-3)",
                letterSpacing: "0.08em",
                marginBottom: 8,
              }}
            >
              Event type
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <EventTypeBtn
                active={!params.name || params.name === "all"}
                name="All event types"
                count={allEvents.length}
                q={{ name: undefined, cat: params.cat }}
              />
              {eventTypesList.map((et) => (
                <EventTypeBtn
                  key={et.name}
                  active={params.name === et.name}
                  name={et.name}
                  color={et.color}
                  count={countByName.get(et.name) ?? 0}
                  q={{ name: et.name, cat: params.cat }}
                />
              ))}
            </div>
          </div>
        </aside>

        {/* Event list */}
        <div
          style={{
            overflow: "auto",
            borderRight: "1px solid var(--border)",
          }}
        >
          <div
            style={{
              position: "sticky",
              top: 0,
              background: "var(--bg)",
              borderBottom: "1px solid var(--border)",
              zIndex: 1,
              padding: "8px 16px",
              display: "flex",
              alignItems: "center",
              gap: 10,
            }}
          >
            <span
              style={{
                fontSize: 11,
                fontFamily: "var(--mono)",
                color: "var(--text-3)",
              }}
            >
              SHOWING
            </span>
            <span className="mono" style={{ fontSize: 12, color: "var(--text)" }}>
              {filtered.length}
            </span>
            {params.name && params.name !== "all" && (
              <Badge tone="muted">{params.name}</Badge>
            )}
          </div>
          <table
            style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}
          >
            <thead>
              <tr>
                <Th>Time</Th>
                <Th>Event</Th>
                <Th>Source</Th>
                <Th>Subject</Th>
                <Th>Size</Th>
              </tr>
            </thead>
            <tbody>
              {filtered.slice(0, 80).map((e) => (
                <tr
                  key={e.id}
                  style={{
                    background:
                      selected?.id === e.id ? "var(--panel-2)" : "transparent",
                    borderLeft:
                      selected?.id === e.id
                        ? "2px solid var(--signal)"
                        : "2px solid transparent",
                    borderBottom: "1px solid var(--border)",
                  }}
                >
                  <Td>
                    <span
                      className="mono"
                      style={{ color: "var(--text-3)", fontSize: 10.5 }}
                    >
                      {e.receivedAt ? fmtTime(e.receivedAt.getTime()) : "—"}
                    </span>
                  </Td>
                  <Td>
                    <Badge tone={badgeTone(e.color)}>{e.name}</Badge>
                  </Td>
                  <Td>
                    <span style={{ fontSize: 11.5, color: "var(--text-2)" }}>
                      {e.sourceAgentTitle ?? e.sourceAgentName ?? "external"}
                    </span>
                  </Td>
                  <Td>
                    <span
                      className="mono"
                      style={{ fontSize: 11, color: "var(--text-2)" }}
                    >
                      {e.subject ?? "—"}
                    </span>
                  </Td>
                  <Td>
                    <span
                      className="mono"
                      style={{ fontSize: 10.5, color: "var(--text-3)" }}
                    >
                      —
                    </span>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Detail */}
        <aside style={{ overflow: "auto", background: "var(--panel)" }}>
          {selected && <EventDetail event={selected} />}
        </aside>
      </div>
    </div>
  );
}

function CatChip({
  active,
  label,
  q,
}: {
  active: boolean;
  label: string;
  q: { name?: string; cat?: string };
}) {
  const sp = new URLSearchParams();
  if (q.name) sp.set("name", q.name);
  if (q.cat) sp.set("cat", q.cat);
  return (
    <Link
      href={`/events${sp.toString() ? `?${sp.toString()}` : ""}`}
      style={{
        padding: "3px 9px",
        borderRadius: 4,
        border: `1px solid ${active ? "var(--signal-dim)" : "var(--border-2)"}`,
        background: active ? "rgba(208,255,0,0.08)" : "transparent",
        color: active ? "var(--signal)" : "var(--text-2)",
        fontFamily: "var(--mono)",
        fontSize: 10.5,
        textTransform: "uppercase",
        letterSpacing: "0.04em",
      }}
    >
      {label}
    </Link>
  );
}

function EventTypeBtn({
  active,
  name,
  color,
  count,
  q,
}: {
  active: boolean;
  name: string;
  color?: string | null;
  count: number;
  q: { name?: string; cat?: string };
}) {
  const sp = new URLSearchParams();
  if (q.name) sp.set("name", q.name);
  if (q.cat) sp.set("cat", q.cat);
  return (
    <Link
      href={`/events${sp.toString() ? `?${sp.toString()}` : ""}`}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        width: "100%",
        padding: "4px 6px",
        fontSize: 11,
        fontFamily: "var(--mono)",
        color: active ? "var(--text)" : "var(--text-2)",
        background: active ? "var(--panel-2)" : "transparent",
        border: `1px solid ${active ? "var(--border-2)" : "transparent"}`,
        borderRadius: 3,
        textAlign: "left",
        textDecoration: "none",
      }}
    >
      {color && (
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: colorDotBg(color),
            flexShrink: 0,
          }}
        />
      )}
      <span
        style={{
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          flex: 1,
        }}
      >
        {name}
      </span>
      <span style={{ color: "var(--text-3)" }}>{count}</span>
    </Link>
  );
}

function Th({ children }: { children?: React.ReactNode }) {
  return (
    <th
      style={{
        textAlign: "left",
        padding: "8px 12px",
        fontSize: 10.5,
        fontFamily: "var(--mono)",
        fontWeight: 500,
        color: "var(--text-3)",
        textTransform: "uppercase",
        letterSpacing: "0.08em",
      }}
    >
      {children}
    </th>
  );
}

function Td({ children }: { children?: React.ReactNode }) {
  return (
    <td style={{ padding: "8px 12px", verticalAlign: "middle" }}>{children}</td>
  );
}

function EventDetail({ event }: { event: EventRow }) {
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <header
        style={{
          padding: "14px 18px",
          borderBottom: "1px solid var(--border)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginBottom: 8,
          }}
        >
          <Badge tone={badgeTone(event.color)}>{event.name}</Badge>
          <span
            style={{
              fontSize: 11,
              color: "var(--text-3)",
              fontFamily: "var(--mono)",
            }}
          >
            {event.category ?? "—"}
          </span>
        </div>
        <div className="mono" style={{ fontSize: 13, color: "var(--text)" }}>
          {event.id}
        </div>
        <div
          style={{ marginTop: 4, fontSize: 11, color: "var(--text-3)" }}
        >
          {event.receivedAt
            ? `${event.receivedAt.toLocaleString()} · ${fmtAgo(event.receivedAt.getTime())}`
            : "—"}
        </div>
      </header>

      <Section title="Source">
        <span style={{ fontSize: 12, color: "var(--text-2)" }}>
          {event.sourceAgentTitle ?? event.sourceAgentName ?? "External / system"}
        </span>
      </Section>

      <Section title="Subject">
        <span className="mono" style={{ fontSize: 12, color: "var(--text-2)" }}>
          {event.subject ?? "—"}
        </span>
      </Section>

      <Section title="Payload">
        <pre
          style={{
            margin: 0,
            padding: 10,
            background: "var(--panel-2)",
            border: "1px solid var(--border)",
            borderRadius: 4,
            fontFamily: "var(--mono)",
            fontSize: 11,
            color: "var(--text-2)",
            overflow: "auto",
            maxHeight: 280,
          }}
        >
          {JSON.stringify(
            {
              event_id: event.id,
              name: event.name,
              ts: event.receivedAt?.toISOString() ?? null,
              source: event.sourceAgentName ?? "external",
              subject: event.subject,
              payload_ref: event.payloadRef ?? null,
            },
            null,
            2,
          )}
        </pre>
      </Section>

      <div
        style={{
          padding: 14,
          display: "flex",
          gap: 8,
          borderTop: "1px solid var(--border)",
        }}
      >
        <Button icon="replay" tone="primary" style={{ flex: 1 }}>
          Replay event
        </Button>
        <Button icon="external">Inngest console</Button>
      </div>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section
      style={{
        padding: "14px 18px",
        borderBottom: "1px solid var(--border)",
      }}
    >
      <div
        style={{
          fontSize: 10.5,
          fontFamily: "var(--mono)",
          textTransform: "uppercase",
          color: "var(--text-3)",
          letterSpacing: "0.08em",
          marginBottom: 8,
        }}
      >
        {title}
      </div>
      {children}
    </section>
  );
}
