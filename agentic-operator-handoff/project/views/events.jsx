// Events — live event stream + per-event detail with replay

const { useState: useStateEv, useMemo: useMemoEv, useEffect: useEffectEv, useRef: useRefEv } = React;

function Events({ navigate, params, liveStream }) {
  const stream = window.RAAS_EVENT_STREAM;
  const eventTypes = window.RAAS_EVENTS;

  const [typeFilter, setTypeFilter] = useStateEv(params.eventName || "all");
  const [catFilter, setCatFilter] = useStateEv("all");
  const [query, setQuery] = useStateEv("");
  const [selectedId, setSelectedId] = useStateEv(null);

  useEffectEv(() => {
    if (params.eventName) setTypeFilter(params.eventName);
  }, [params.eventName]);

  const filtered = useMemoEv(() => {
    return stream.filter(e => {
      if (typeFilter !== "all" && e.name !== typeFilter) return false;
      if (catFilter !== "all" && e.category !== catFilter) return false;
      if (query) {
        const q = query.toLowerCase();
        if (!e.name.toLowerCase().includes(q) && !e.id.toLowerCase().includes(q) && !e.subject.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [stream, typeFilter, catFilter, query]);

  // Histogram of last 60 min by category
  const hist = useMemoEv(() => {
    const now = Date.now();
    const buckets = new Array(60).fill(0);
    filtered.forEach(e => {
      const idx = Math.floor((now - e.at) / 60_000);
      if (idx >= 0 && idx < 60) buckets[59 - idx]++;
    });
    return buckets;
  }, [filtered]);

  const selected = selectedId ? stream.find(e => e.id === selectedId) : filtered[0];

  // Auto-advance "now" indicator
  const [tick, setTick] = useStateEv(0);
  useEffectEv(() => {
    if (!liveStream) return;
    const id = setInterval(() => setTick(t => t + 1), 2500);
    return () => clearInterval(id);
  }, [liveStream]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <ViewHeader
        title="Events"
        subtitle={`${filtered.length} events · ${eventTypes.length} event types · ${liveStream ? "live tail" : "paused"}`}
        badge={liveStream ? <Badge tone="signal"><span className="live-dot" style={{ width: 5, height: 5 }}/> LIVE</Badge> : null}
        action={[<Button key="r" icon="replay" small>Replay window</Button>]}
      />

      {/* Histogram strip */}
      <div style={{ padding: "12px 24px", borderBottom: "1px solid var(--border)", background: "var(--panel)" }}>
        <Histogram buckets={hist} />
      </div>

      <div style={{ flex: 1, display: "grid", gridTemplateColumns: "260px 1fr 360px", minHeight: 0 }}>
        {/* Filters */}
        <aside style={{ borderRight: "1px solid var(--border)", overflow: "auto", padding: "14px 16px" }}>
          <SearchInput value={query} onChange={setQuery} placeholder="event, subject, id…" />
          <FilterGroup title="Category" value={catFilter} onChange={setCatFilter} options={[
            { id: "all", label: "All" },
            { id: "agent", label: "Agent" },
            { id: "human", label: "Human" },
            { id: "data", label: "Data" },
            { id: "external", label: "External" },
            { id: "alert", label: "Alert" },
            { id: "system", label: "System" },
          ]} />
          <div style={{ marginTop: 18 }}>
            <div style={{ fontSize: 10.5, fontFamily: "var(--mono)", textTransform: "uppercase", color: "var(--text-3)", letterSpacing: "0.08em", marginBottom: 8 }}>Event type</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <EventTypeRow active={typeFilter === "all"} onClick={() => setTypeFilter("all")} name="All event types" count={stream.length} />
              {eventTypes.map(et => {
                const count = stream.filter(s => s.name === et.name).length;
                return (
                  <EventTypeRow
                    key={et.name}
                    active={typeFilter === et.name}
                    onClick={() => setTypeFilter(et.name)}
                    name={et.name}
                    color={et.color}
                    count={count}
                  />
                );
              })}
            </div>
          </div>
        </aside>

        {/* Event list */}
        <div style={{ overflow: "auto", borderRight: "1px solid var(--border)" }}>
          <div style={{ position: "sticky", top: 0, background: "var(--bg)", borderBottom: "1px solid var(--border)", zIndex: 1, padding: "8px 16px", display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 11, fontFamily: "var(--mono)", color: "var(--text-3)" }}>SHOWING</span>
            <span className="mono" style={{ fontSize: 12, color: "var(--text)" }}>{filtered.length}</span>
            {typeFilter !== "all" && <Badge tone="muted">{typeFilter} <span onClick={() => setTypeFilter("all")} style={{ cursor: "pointer", marginLeft: 4 }}>×</span></Badge>}
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
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
              {filtered.slice(0, 80).map(e => (
                <tr key={e.id}
                  onClick={() => setSelectedId(e.id)}
                  style={{
                    cursor: "pointer",
                    background: selected?.id === e.id ? "var(--panel-2)" : "transparent",
                    borderLeft: selected?.id === e.id ? "2px solid var(--signal)" : "2px solid transparent",
                    borderBottom: "1px solid var(--border)",
                  }}>
                  <Td><span className="mono" style={{ color: "var(--text-3)", fontSize: 10.5 }}>{window.fmtTime(e.at)}</span></Td>
                  <Td><Badge tone={window.eventTone(e.color)}>{e.name}</Badge></Td>
                  <Td><span style={{ fontSize: 11.5, color: "var(--text-2)" }}>{e.sourceTitle}</span></Td>
                  <Td><span className="mono" style={{ fontSize: 11, color: "var(--text-2)" }}>{e.subject}</span></Td>
                  <Td><span className="mono" style={{ fontSize: 10.5, color: "var(--text-3)" }}>{window.fmtBytes(e.payloadBytes)}</span></Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Detail */}
        <aside style={{ overflow: "auto", background: "var(--panel)" }}>
          {selected && <EventDetail event={selected} navigate={navigate} />}
        </aside>
      </div>
    </div>
  );
}

function FilterGroup({ title, value, onChange, options }) {
  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ fontSize: 10.5, fontFamily: "var(--mono)", textTransform: "uppercase", color: "var(--text-3)", letterSpacing: "0.08em", marginBottom: 6 }}>{title}</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
        {options.map(o => (
          <FilterChip key={o.id} active={value === o.id} onClick={() => onChange(o.id)}>{o.label}</FilterChip>
        ))}
      </div>
    </div>
  );
}

function EventTypeRow({ active, onClick, name, color, count }) {
  return (
    <button onClick={onClick} style={{
      display: "flex", alignItems: "center", gap: 8,
      width: "100%", padding: "4px 6px",
      fontSize: 11, fontFamily: "var(--mono)",
      color: active ? "var(--text)" : "var(--text-2)",
      background: active ? "var(--panel-2)" : "transparent",
      border: "1px solid " + (active ? "var(--border-2)" : "transparent"),
      borderRadius: 3,
      textAlign: "left",
    }}>
      {color && <span style={{ width: 6, height: 6, borderRadius: "50%", background: ({green: "var(--green)", blue: "var(--blue)", amber: "var(--amber)", red: "var(--red)", muted: "var(--text-3)"}[color]) }} />}
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{name}</span>
      <span style={{ color: "var(--text-3)" }}>{count}</span>
    </button>
  );
}

function Histogram({ buckets }) {
  const max = Math.max(1, ...buckets);
  return (
    <div>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 1, height: 38 }}>
        {buckets.map((v, i) => (
          <div key={i} style={{
            flex: 1,
            height: `${Math.max(2, (v / max) * 100)}%`,
            background: i === buckets.length - 1 ? "var(--signal)" : v > 0 ? `rgba(208,255,0,${0.25 + (v/max) * 0.55})` : "var(--border)",
          }} />
        ))}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4, fontSize: 10, fontFamily: "var(--mono)", color: "var(--text-3)" }}>
        <span>60m ago</span>
        <span>events / minute · peak {max}</span>
        <span>now</span>
      </div>
    </div>
  );
}

function EventDetail({ event, navigate }) {
  const ev = window.RAAS_EVENTS.find(e => e.name === event.name);
  const emitters = window.RAAS_AGENTS.filter(a => a.emits.includes(event.name));
  const listeners = window.RAAS_AGENTS.filter(a => a.triggers.includes(event.name));
  const source = window.RAAS_AGENTS.find(a => a.id === event.source);

  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <header style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <Badge tone={window.eventTone(event.color)}>{event.name}</Badge>
          <span style={{ fontSize: 11, color: "var(--text-3)", fontFamily: "var(--mono)" }}>{event.category}</span>
        </div>
        <div className="mono" style={{ fontSize: 13, color: "var(--text)" }}>{event.id}</div>
        <div style={{ marginTop: 4, fontSize: 11, color: "var(--text-3)" }}>
          {new Date(event.at).toLocaleString()} · {window.fmtAgo(event.at)}
        </div>
      </header>

      <Section title="Source">
        {source ? (
          <button onClick={() => navigate("agents", { agentId: source.id })} style={{
            display: "flex", alignItems: "center", gap: 8,
            padding: "8px 10px", width: "100%",
            background: "var(--panel-2)", border: "1px solid var(--border)", borderRadius: 4,
            textAlign: "left",
          }}>
            <ActorTag actor={source.actor} />
            <span style={{ fontSize: 12.5, color: "var(--text)" }}>{source.title}</span>
            <Icon name="external" size={12} style={{ marginLeft: "auto", color: "var(--text-3)" }} />
          </button>
        ) : (
          <span style={{ fontSize: 12, color: "var(--text-3)" }}>External / system</span>
        )}
      </Section>

      <Section title={`Downstream listeners · ${listeners.length}`}>
        {listeners.length === 0 ? (
          <span style={{ fontSize: 11.5, color: "var(--text-3)" }}>Terminal event — no agents listen.</span>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {listeners.map(a => (
              <button key={a.id} onClick={() => navigate("agents", { agentId: a.id })} style={{
                display: "flex", alignItems: "center", gap: 8,
                padding: "6px 8px",
                background: "var(--panel-2)", border: "1px solid var(--border)", borderRadius: 4,
                textAlign: "left",
              }}>
                <ActorTag actor={a.actor} />
                <span style={{ fontSize: 12, color: "var(--text)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.title}</span>
                <Icon name="chevron-right" size={11} style={{ color: "var(--text-3)" }} />
              </button>
            ))}
          </div>
        )}
      </Section>

      <Section title="Payload">
        <CodeBlock>{JSON.stringify({
          event_id: event.id,
          name: event.name,
          ts: new Date(event.at).toISOString(),
          tenant: "raas",
          source: source ? { agent_id: source.id, agent: source.name } : "external",
          subject: event.subject,
          payload: {
            job_requisition_id: event.subject.startsWith("REQ") ? event.subject : null,
            candidate_id: event.subject.startsWith("CAN") ? event.subject : null,
            client: "Tencent",
            metadata: { run_id: "run-0" + (1000 + (event.subject.length * 7 % 900)), env: "prod" },
          },
        }, null, 2)}</CodeBlock>
      </Section>

      <div style={{ padding: 14, display: "flex", gap: 8, borderTop: "1px solid var(--border)" }}>
        <Button icon="replay" tone="primary" style={{ flex: 1 }}>Replay event</Button>
        <Button icon="external">Inngest console</Button>
      </div>
    </div>
  );
}

window.Events = Events;
