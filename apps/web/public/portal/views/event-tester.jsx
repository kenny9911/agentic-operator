// Event Tester — publish & trace events for the active tenant.
//
// All <script type="text/babel"> files share global scope (see CLAUDE.md
// "SPA global-scope gotcha"). Every internal component below is prefixed
// `EventTester*` so it cannot collide with another view's identically-named
// helper. Only the top-level `EventTester` exported on window has a bare
// name.
//
// Data flow:
//   GET  /v1/events/catalog            → tenant event schemas (one-shot)
//   POST /v1/events                    → publish (returns { event_id, name })
//   GET  /v1/events/stream             → SSE live tail (frame: event: event\ndata: <row>)
//   GET  /v1/events/recent?causality=1 → seed event + downstream runs + child events
//
// If the backend endpoints aren't deployed yet the view degrades to empty
// states rather than crashing.

const {
  useState: useStateET,
  useMemo: useMemoET,
  useEffect: useEffectET,
  useRef: useRefET,
} = React;

// ---------- network helpers ----------
const ET_FETCH_OPTS = { credentials: "include" };

async function eventTesterFetchJson(url, init) {
  const res = await fetch(url, { ...ET_FETCH_OPTS, ...(init || {}) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body?.ok === false) {
    const code = body?.error?.code || `http_${res.status}`;
    const msg = body?.error?.message || `request failed (${res.status})`;
    const err = new Error(msg);
    err.code = code;
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body?.data ?? body;
}

// Decide which UI control fits a manifest-declared type. We accept anything
// the schema-editor / manifest produces. Unknown → Monaco fallback.
function eventTesterControlForType(type) {
  if (!type) return "string";
  const t = String(type).trim();
  if (t === "Boolean" || t === "boolean") return "boolean";
  if (t === "Number" || t === "Integer" || t === "Float" || t === "number") return "number";
  if (t === "Date") return "date";
  if (t === "DateTime" || t === "Datetime" || t === "Timestamp") return "datetime";
  if (/^Array<.+>$/i.test(t)) return "array";
  if (t === "String" || t === "string") return "string";
  return "unknown";
}

function eventTesterArrayInnerType(type) {
  const m = String(type || "").match(/^Array<(.+)>$/i);
  return m ? m[1] : "String";
}

// Coerce a string from a text/number input into the value the manifest declares.
function eventTesterCoerce(type, raw) {
  if (raw == null || raw === "") return null;
  const c = eventTesterControlForType(type);
  if (c === "number") {
    const n = Number(raw);
    return Number.isFinite(n) ? n : raw;
  }
  if (c === "boolean") return Boolean(raw);
  return raw;
}

// localStorage preset helpers — keyed by tenant + event so they don't leak
// across tenants. They live in the browser only; nothing crosses the wire.
function eventTesterPresetKey(tenantSlug, eventName) {
  return `agentic.preset.${tenantSlug || "default"}.${eventName}`;
}
function eventTesterLoadPresets(tenantSlug, eventName) {
  try {
    const raw = window.localStorage.getItem(eventTesterPresetKey(tenantSlug, eventName));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
function eventTesterSavePresets(tenantSlug, eventName, presets) {
  try {
    window.localStorage.setItem(
      eventTesterPresetKey(tenantSlug, eventName),
      JSON.stringify(presets || []),
    );
  } catch {
    /* quota or disabled — silent */
  }
}

// ---------- root view ----------
function EventTester({ navigate, params, liveStream, tenant }) {
  const tenantSlug = tenant?.id || (window.TENANTS && window.TENANTS[0]?.id) || "default";

  // Catalog (one-shot at mount, refresh button reloads).
  const [catalog, setCatalog] = useStateET([]);
  const [catalogState, setCatalogState] = useStateET({ loading: true, error: null });
  const reloadCatalog = () => {
    setCatalogState({ loading: true, error: null });
    eventTesterFetchJson("/v1/events/catalog")
      .then((data) => {
        const events = Array.isArray(data?.events) ? data.events : [];
        setCatalog(events);
        setCatalogState({ loading: false, error: null });
      })
      .catch((err) => {
        // Backend may not be deployed yet — fall back to bootstrap names so
        // the view stays useful for layout review. We never break the UI on
        // a 404.
        const fallback = (window.RAAS_EVENTS || []).map((e) => ({
          name: e.name,
          description: e.description || null,
          category: e.category || null,
          color: e.color || null,
          source_action: null,
          fields: [],
          raw_payload_schema: null,
        }));
        setCatalog(fallback);
        setCatalogState({ loading: false, error: err.status === 404 ? null : err.message });
      });
  };
  useEffectET(() => {
    reloadCatalog();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantSlug]);

  // Selection + form state.
  const [selectedName, setSelectedName] = useStateET(params?.eventName ?? null);
  const [filter, setFilter] = useStateET("");
  useEffectET(() => {
    if (params?.eventName) setSelectedName(params.eventName);
  }, [params?.eventName]);

  const selectedEvent = useMemoET(
    () => catalog.find((e) => e.name === selectedName) ?? null,
    [catalog, selectedName],
  );

  const [subject, setSubject] = useStateET("");
  const [testMode, setTestMode] = useStateET(true);
  const [fieldValues, setFieldValues] = useStateET({});
  const [confirmNonTest, setConfirmNonTest] = useStateET(false);
  const [publishState, setPublishState] = useStateET({ status: "idle", message: null });

  // Reset field values whenever the selected event changes.
  useEffectET(() => {
    if (!selectedEvent) {
      setFieldValues({});
      return;
    }
    const init = {};
    (selectedEvent.fields || []).forEach((f) => {
      const c = eventTesterControlForType(f.type);
      if (c === "boolean") init[f.name] = false;
      else if (c === "array") init[f.name] = [];
      else if (c === "number") init[f.name] = "";
      else init[f.name] = "";
    });
    setFieldValues(init);
    setPublishState({ status: "idle", message: null });
  }, [selectedName, selectedEvent]);

  // Live tail (SSE). One EventSource per mount; cleaned up on unmount.
  const [recent, setRecent] = useStateET([]);
  const [sseState, setSseState] = useStateET({ status: "connecting", attempt: 0 });
  const esRef = useRefET(null);
  // Seen-ids dedupe set. The SSE cursor compensation (`since = now - 1s`)
  // re-emits any row inserted in the last second on every reconnect, so a
  // tab that flaps will repeatedly receive frames for ids we've already
  // rendered. A Set keyed by `id` lets us early-return *before* touching
  // React state. We keep it per-mount (cleared on unmount via cleanup) and
  // cap size so a long-running tab can't grow it unbounded — 1000 is two
  // orders of magnitude beyond the recent buffer + cursor window.
  const seenIdsRef = useRefET(null);
  const SEEN_IDS_CAP = 1000;
  useEffectET(() => {
    if (liveStream === false) {
      setSseState({ status: "paused", attempt: 0 });
      return;
    }
    let cancelled = false;
    let backoffTimer = null;
    let attempt = 0;
    seenIdsRef.current = new Set();

    const connect = () => {
      if (cancelled) return;
      let es;
      try {
        es = new EventSource("/v1/events/stream");
      } catch (err) {
        setSseState({ status: "error", attempt });
        return;
      }
      esRef.current = es;
      setSseState({ status: "connecting", attempt });

      es.addEventListener("open", () => {
        if (cancelled) return;
        attempt = 0;
        setSseState({ status: "open", attempt: 0 });
      });
      es.addEventListener("event", (e) => {
        if (cancelled) return;
        try {
          const row = JSON.parse(e.data);
          if (!row || !row.id) return;
          const seen = seenIdsRef.current;
          if (seen && seen.has(row.id)) return;
          if (seen) {
            seen.add(row.id);
            // Trim FIFO-ish when we hit the cap. Sets preserve insertion
            // order, so the first 100 entries are also the oldest.
            if (seen.size > SEEN_IDS_CAP) {
              const drop = seen.size - SEEN_IDS_CAP;
              let i = 0;
              for (const id of seen) {
                if (i++ >= drop) break;
                seen.delete(id);
              }
            }
          }
          setRecent((prev) => [row, ...prev].slice(0, 100));
        } catch {
          /* malformed frame — ignore */
        }
      });
      // Heartbeat frames keep proxies alive; we don't surface them.
      es.addEventListener("heartbeat", () => {});

      es.onerror = () => {
        if (cancelled) return;
        try { es.close(); } catch {}
        esRef.current = null;
        attempt += 1;
        setSseState({ status: "reconnecting", attempt });
        const wait = Math.min(15_000, 500 * Math.pow(2, Math.min(attempt, 6)));
        backoffTimer = setTimeout(connect, wait);
      };
    };

    connect();

    return () => {
      cancelled = true;
      if (backoffTimer) clearTimeout(backoffTimer);
      if (esRef.current) {
        try { esRef.current.close(); } catch {}
        esRef.current = null;
      }
      seenIdsRef.current = null;
    };
  }, [liveStream, tenantSlug]);

  // Causality (poll after publish for ~30s, then stop).
  const [pinnedEventId, setPinnedEventId] = useStateET(null);
  const [causality, setCausality] = useStateET(null);
  useEffectET(() => {
    if (!pinnedEventId) return;
    let cancelled = false;
    let stopAt = Date.now() + 30_000;
    const tick = async () => {
      if (cancelled || Date.now() > stopAt) return;
      try {
        const data = await eventTesterFetchJson(
          `/v1/events/recent?causality=1&seed=${encodeURIComponent(pinnedEventId)}`,
        );
        if (!cancelled) setCausality(data);
      } catch {
        /* keep retrying — endpoint may be transient */
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [pinnedEventId]);

  const buildPayload = () => {
    if (!selectedEvent) return {};
    const out = {};
    (selectedEvent.fields || []).forEach((f) => {
      const raw = fieldValues[f.name];
      const c = eventTesterControlForType(f.type);
      if (c === "array") {
        const inner = eventTesterArrayInnerType(f.type);
        out[f.name] = (Array.isArray(raw) ? raw : []).map((x) => eventTesterCoerce(inner, x));
      } else if (c === "boolean") {
        out[f.name] = Boolean(raw);
      } else if (c === "number") {
        const n = Number(raw);
        out[f.name] = Number.isFinite(n) ? n : null;
      } else if (c === "unknown") {
        // Monaco editor stores JSON text; try-parse.
        try {
          out[f.name] = raw === "" ? null : JSON.parse(raw);
        } catch {
          out[f.name] = raw;
        }
      } else {
        out[f.name] = raw === "" ? null : raw;
      }
    });
    return out;
  };

  const fieldsValid = useMemoET(() => {
    if (!selectedEvent) return false;
    for (const f of selectedEvent.fields || []) {
      if (f.required) {
        const v = fieldValues[f.name];
        if (v == null || v === "" || (Array.isArray(v) && v.length === 0)) return false;
      }
    }
    return true;
  }, [selectedEvent, fieldValues]);

  const onPublish = async () => {
    if (!selectedEvent || publishState.status === "publishing") return;
    if (!testMode && !confirmNonTest) {
      setPublishState({
        status: "error",
        message: 'Publishing as non-test. Tick "Confirm non-test publish" to proceed.',
      });
      return;
    }
    setPublishState({ status: "publishing", message: null });
    const body = {
      name: selectedEvent.name,
      subject: subject || undefined,
      payload: buildPayload(),
      test: testMode,
      source: "operator",
    };
    try {
      const data = await eventTesterFetchJson("/v1/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const eventId = data?.event_id || data?.id || null;
      setPinnedEventId(eventId);
      setCausality(null);
      setPublishState({
        status: "ok",
        message: `Published ${data?.name || selectedEvent.name}${eventId ? ` · ${eventId}` : ""}`,
        eventId,
      });
    } catch (err) {
      setPublishState({ status: "error", message: err.message || "publish failed" });
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <ViewHeader
        title="Event Tester"
        subtitle={
          catalogState.loading
            ? "Loading catalog…"
            : `${catalog.length} event type${catalog.length === 1 ? "" : "s"} in this tenant · ${tenantSlug}`
        }
        badge={
          sseState.status === "open" ? (
            <Badge tone="signal">
              <span className="live-dot" style={{ width: 5, height: 5 }} /> LIVE
            </Badge>
          ) : sseState.status === "reconnecting" ? (
            <Badge tone="amber">RECONNECTING…</Badge>
          ) : sseState.status === "paused" ? (
            <Badge tone="muted">PAUSED</Badge>
          ) : null
        }
        action={[
          <Button key="r" icon="replay" small onClick={reloadCatalog}>
            Refresh catalog
          </Button>,
        ]}
      />

      {catalogState.error && (
        <div
          style={{
            padding: "8px 24px",
            borderBottom: "1px solid var(--border)",
            background: "rgba(255,100,112,0.06)",
            color: "var(--red)",
            fontSize: 11.5,
            fontFamily: "var(--mono)",
          }}
        >
          Catalog fetch failed — {catalogState.error}
        </div>
      )}

      {catalog.length === 0 && !catalogState.loading ? (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ textAlign: "center", maxWidth: 420 }}>
            <div style={{ fontSize: 16, fontFamily: "var(--display)", color: "var(--text)", marginBottom: 8 }}>
              No events declared yet
            </div>
            <div style={{ fontSize: 12.5, color: "var(--text-2)", marginBottom: 16, lineHeight: 1.5 }}>
              This tenant's manifest has no event schemas. Add some in the Schema editor and they'll
              show up here automatically.
            </div>
            <Button
              icon="settings"
              tone="primary"
              onClick={() => navigate && navigate("schema-editor")}
            >
              Open Schema editor
            </Button>
          </div>
        </div>
      ) : (
        <div
          style={{
            flex: 1,
            display: "grid",
            gridTemplateColumns: "260px 1fr 360px",
            minHeight: 0,
          }}
        >
          <EventTesterCatalogSidebar
            catalog={catalog}
            selected={selectedName}
            onSelect={setSelectedName}
            filter={filter}
            setFilter={setFilter}
            loading={catalogState.loading}
          />
          <EventTesterPublishPane
            event={selectedEvent}
            subject={subject}
            setSubject={setSubject}
            testMode={testMode}
            setTestMode={setTestMode}
            confirmNonTest={confirmNonTest}
            setConfirmNonTest={setConfirmNonTest}
            fieldValues={fieldValues}
            setFieldValues={setFieldValues}
            onPublish={onPublish}
            publishState={publishState}
            buildPayload={buildPayload}
            fieldsValid={fieldsValid}
            tenantSlug={tenantSlug}
          />
          <EventTesterRecentPane
            recent={recent}
            pinnedEventId={pinnedEventId}
            causality={causality}
            navigate={navigate}
            sseState={sseState}
          />
        </div>
      )}
    </div>
  );
}

// ---------- left rail: catalog ----------
function EventTesterCatalogSidebar({ catalog, selected, onSelect, filter, setFilter, loading }) {
  const items = useMemoET(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return catalog;
    return catalog.filter(
      (e) =>
        e.name.toLowerCase().includes(q) ||
        (e.description || "").toLowerCase().includes(q),
    );
  }, [catalog, filter]);

  return (
    <aside
      style={{
        borderRight: "1px solid var(--border)",
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        background: "var(--bg)",
      }}
    >
      <div style={{ padding: "12px 14px", borderBottom: "1px solid var(--border)" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "5px 8px",
            background: "var(--panel)",
            border: "1px solid var(--border-2)",
            borderRadius: 5,
          }}
        >
          <Icon name="search" size={11} style={{ color: "var(--text-3)" }} />
          <input
            type="text"
            placeholder="Filter events…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            style={{
              flex: 1,
              minWidth: 0,
              background: "transparent",
              border: "none",
              outline: "none",
              color: "var(--text)",
              fontSize: 12,
              fontFamily: "var(--mono)",
            }}
          />
          {filter && (
            <button onClick={() => setFilter("")} style={{ color: "var(--text-3)" }}>
              <Icon name="x" size={10} />
            </button>
          )}
        </div>
      </div>
      <div style={{ flex: 1, overflow: "auto", padding: "8px 8px" }}>
        {loading && items.length === 0 && (
          <div style={{ padding: 14, fontSize: 11, color: "var(--text-3)", fontFamily: "var(--mono)" }}>
            Loading…
          </div>
        )}
        {!loading && items.length === 0 && (
          <div style={{ padding: 14, fontSize: 11, color: "var(--text-3)" }}>
            No events match.
          </div>
        )}
        {items.map((e) => (
          <EventTesterCatalogRow
            key={e.name}
            entry={e}
            active={selected === e.name}
            onClick={() => onSelect(e.name)}
          />
        ))}
      </div>
    </aside>
  );
}

function EventTesterCatalogRow({ entry, active, onClick }) {
  const colorMap = {
    green: "var(--green)",
    blue: "var(--blue)",
    amber: "var(--amber)",
    red: "var(--red)",
    muted: "var(--text-3)",
  };
  return (
    <button
      onClick={onClick}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "stretch",
        gap: 3,
        width: "100%",
        padding: "8px 10px",
        marginBottom: 2,
        background: active ? "var(--panel-2)" : "transparent",
        border: `1px solid ${active ? "var(--border-2)" : "transparent"}`,
        borderLeft: `2px solid ${active ? "var(--signal)" : "transparent"}`,
        borderRadius: 4,
        textAlign: "left",
        cursor: "pointer",
      }}
      onMouseEnter={(e) => {
        if (!active) e.currentTarget.style.background = "var(--panel)";
      }}
      onMouseLeave={(e) => {
        if (!active) e.currentTarget.style.background = "transparent";
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: colorMap[entry.color] || "var(--text-3)",
            flexShrink: 0,
          }}
        />
        <span
          className="mono"
          style={{
            fontSize: 11.5,
            color: active ? "var(--text)" : "var(--text-2)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            flex: 1,
            minWidth: 0,
          }}
        >
          {entry.name}
        </span>
        {entry.fields && entry.fields.length > 0 && (
          <span style={{ fontSize: 10, color: "var(--text-3)", fontFamily: "var(--mono)" }}>
            {entry.fields.length}
          </span>
        )}
      </div>
      {entry.description && (
        <div
          style={{
            fontSize: 10.5,
            color: "var(--text-3)",
            lineHeight: 1.35,
            overflow: "hidden",
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
          }}
        >
          {entry.description}
        </div>
      )}
    </button>
  );
}

// ---------- middle: form + publish ----------
function EventTesterPublishPane({
  event,
  subject,
  setSubject,
  testMode,
  setTestMode,
  confirmNonTest,
  setConfirmNonTest,
  fieldValues,
  setFieldValues,
  onPublish,
  publishState,
  buildPayload,
  fieldsValid,
  tenantSlug,
}) {
  const [curlOpen, setCurlOpen] = useStateET(false);

  if (!event) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "100%",
          color: "var(--text-3)",
          fontSize: 13,
        }}
      >
        Pick an event from the left to compose a payload.
      </div>
    );
  }

  return (
    <section style={{ overflow: "auto", padding: "20px 24px" }}>
      {/* Event header */}
      <div style={{ marginBottom: 18 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
          <Badge tone={window.eventTone ? window.eventTone(event.color) : "muted"}>
            {event.name}
          </Badge>
          {event.category && (
            <span
              style={{ fontSize: 11, color: "var(--text-3)", fontFamily: "var(--mono)" }}
            >
              {event.category}
            </span>
          )}
          {event.source_action && (
            <span
              style={{ fontSize: 11, color: "var(--text-3)" }}
              title="source action"
            >
              from {event.source_action}
            </span>
          )}
        </div>
        {event.description && (
          <div style={{ fontSize: 12.5, color: "var(--text-2)", lineHeight: 1.5 }}>
            {event.description}
          </div>
        )}
      </div>

      {/* Subject + test toggle */}
      <Panel title="Envelope" padded>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <EventTesterLabeled label="Subject" hint="Inngest concurrency key. Free text.">
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="req-acme-2026-001"
              style={EventTesterInputStyle}
            />
          </EventTesterLabeled>
          <EventTesterLabeled
            label="Mark as test run"
            hint="Routes runs.isTest=true; default ON to keep dashboards clean."
          >
            <EventTesterToggle value={testMode} onChange={setTestMode} />
          </EventTesterLabeled>
          {!testMode && (
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "8px 10px",
                background: "rgba(255,181,71,0.08)",
                border: "1px solid rgba(255,181,71,0.3)",
                borderRadius: 5,
                fontSize: 11.5,
                color: "var(--amber)",
                cursor: "pointer",
              }}
            >
              <input
                type="checkbox"
                checked={confirmNonTest}
                onChange={(e) => setConfirmNonTest(e.target.checked)}
              />
              Confirm non-test publish (will hit production observability)
            </label>
          )}
        </div>
      </Panel>

      {/* Fields */}
      <div style={{ marginTop: 14 }}>
        <Panel title={`Payload · ${event.fields?.length || 0} field${(event.fields?.length || 0) === 1 ? "" : "s"}`} padded>
          {!event.fields || event.fields.length === 0 ? (
            <Empty
              title="No declared fields"
              hint="This event accepts any JSON. Use the Raw editor below."
            />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {event.fields.map((f) => (
                <EventTesterFieldRow
                  key={f.name}
                  field={f}
                  value={fieldValues[f.name]}
                  onChange={(v) => setFieldValues((prev) => ({ ...prev, [f.name]: v }))}
                />
              ))}
            </div>
          )}
        </Panel>
      </div>

      {/* Presets */}
      <div style={{ marginTop: 14 }}>
        <EventTesterPresets
          tenantSlug={tenantSlug}
          eventName={event.name}
          subject={subject}
          fieldValues={fieldValues}
          testMode={testMode}
          onLoad={(p) => {
            if (p.subject != null) setSubject(p.subject);
            if (p.fieldValues) setFieldValues(p.fieldValues);
            if (typeof p.testMode === "boolean") setTestMode(p.testMode);
          }}
        />
      </div>

      {/* cURL + Publish */}
      <div
        style={{
          marginTop: 18,
          display: "flex",
          gap: 8,
          alignItems: "center",
          justifyContent: "flex-end",
          flexWrap: "wrap",
        }}
      >
        <Button
          icon="code"
          tone="default"
          onClick={() => setCurlOpen((v) => !v)}
        >
          {curlOpen ? "Hide cURL" : "Show as cURL"}
        </Button>
        <Button
          icon="play"
          tone="primary"
          onClick={onPublish}
          disabled={!fieldsValid || publishState.status === "publishing"}
        >
          {publishState.status === "publishing" ? "Publishing…" : "Publish"}
        </Button>
      </div>

      {publishState.status === "ok" && (
        <div
          role="status"
          style={{
            marginTop: 12,
            padding: "8px 10px",
            background: "rgba(101,224,163,0.08)",
            border: "1px solid rgba(101,224,163,0.32)",
            borderRadius: 4,
            color: "var(--green)",
            fontSize: 11.5,
            fontFamily: "var(--mono)",
          }}
        >
          {publishState.message}
        </div>
      )}
      {publishState.status === "error" && (
        <div
          role="alert"
          style={{
            marginTop: 12,
            padding: "8px 10px",
            background: "rgba(255,100,112,0.08)",
            border: "1px solid rgba(255,100,112,0.32)",
            borderRadius: 4,
            color: "var(--red)",
            fontSize: 11.5,
          }}
        >
          {publishState.message}
        </div>
      )}

      {curlOpen && (
        <div style={{ marginTop: 14 }}>
          <EventTesterCurlPreview
            event={event}
            subject={subject}
            payload={buildPayload()}
            testMode={testMode}
          />
        </div>
      )}
    </section>
  );
}

const EventTesterInputStyle = {
  width: "100%",
  padding: "6px 9px",
  background: "var(--panel-2)",
  border: "1px solid var(--border-2)",
  borderRadius: 4,
  color: "var(--text)",
  fontSize: 12,
  fontFamily: "var(--mono)",
  outline: "none",
};

function EventTesterLabeled({ label, hint, children }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <span
          style={{
            fontSize: 10.5,
            fontFamily: "var(--mono)",
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            color: "var(--text-3)",
          }}
        >
          {label}
        </span>
        {hint && (
          <span style={{ fontSize: 10.5, color: "var(--text-3)" }}>{hint}</span>
        )}
      </div>
      {children}
    </div>
  );
}

function EventTesterToggle({ value, onChange, ariaLabel }) {
  return (
    <button
      role="switch"
      aria-checked={!!value}
      aria-label={ariaLabel}
      onClick={() => onChange(!value)}
      style={{
        width: 36,
        height: 20,
        borderRadius: 10,
        background: value ? "var(--signal)" : "var(--border-2)",
        position: "relative",
        transition: "background 0.15s",
        flexShrink: 0,
        cursor: "pointer",
      }}
    >
      <span
        style={{
          position: "absolute",
          top: 2,
          left: value ? 18 : 2,
          width: 16,
          height: 16,
          borderRadius: "50%",
          background: value ? "#000" : "var(--text)",
          transition: "left 0.15s",
        }}
      />
    </button>
  );
}

// ---------- per-field input ----------
function EventTesterFieldRow({ field, value, onChange }) {
  const ctrl = eventTesterControlForType(field.type);
  const enumValues = Array.isArray(field.enum) && field.enum.length > 0 ? field.enum : null;
  const required = !!field.required;

  let control = null;
  if (enumValues) {
    control = (
      <select
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        style={EventTesterInputStyle}
      >
        <option value="">— select —</option>
        {enumValues.map((v) => (
          <option key={v} value={v}>{v}</option>
        ))}
      </select>
    );
  } else if (ctrl === "boolean") {
    control = (
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <EventTesterToggle
          value={!!value}
          onChange={onChange}
          ariaLabel={field.name}
        />
        <span className="mono" style={{ fontSize: 11, color: "var(--text-3)" }}>
          {value ? "true" : "false"}
        </span>
      </div>
    );
  } else if (ctrl === "number") {
    control = (
      <input
        type="number"
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        style={EventTesterInputStyle}
      />
    );
  } else if (ctrl === "date") {
    control = (
      <input
        type="date"
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        style={EventTesterInputStyle}
      />
    );
  } else if (ctrl === "datetime") {
    control = (
      <input
        type="datetime-local"
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        style={EventTesterInputStyle}
      />
    );
  } else if (ctrl === "array") {
    control = (
      <EventTesterArrayInput
        innerType={eventTesterArrayInnerType(field.type)}
        value={Array.isArray(value) ? value : []}
        onChange={onChange}
      />
    );
  } else if (ctrl === "unknown") {
    control = (
      <EventTesterMonacoJson value={value ?? ""} onChange={onChange} />
    );
  } else {
    // String
    control = (
      <input
        type="text"
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        style={EventTesterInputStyle}
        placeholder={field.target_object ? `→ ${field.target_object}` : ""}
      />
    );
  }

  const missing =
    required && (value == null || value === "" || (Array.isArray(value) && value.length === 0));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <span
          className="mono"
          style={{ fontSize: 11.5, color: "var(--text)", fontWeight: 500 }}
        >
          {field.name}
        </span>
        <span
          className="mono"
          style={{ fontSize: 10.5, color: "var(--text-3)" }}
        >
          {field.type}
        </span>
        {field.target_object && (
          <span style={{ fontSize: 10.5, color: "var(--text-3)" }}>
            → {field.target_object}
          </span>
        )}
        {required && (
          <span style={{ fontSize: 10, color: "var(--amber)", marginLeft: "auto" }}>
            required
          </span>
        )}
      </div>
      <div
        style={{
          padding: missing ? "0" : "0",
          borderRadius: 4,
          boxShadow: missing ? "0 0 0 1px rgba(255,181,71,0.4)" : "none",
        }}
      >
        {control}
      </div>
    </div>
  );
}

function EventTesterArrayInput({ innerType, value, onChange }) {
  const ctrl = eventTesterControlForType(innerType);
  const add = () => {
    const next = [...value];
    next.push(ctrl === "boolean" ? false : ctrl === "number" ? "" : "");
    onChange(next);
  };
  const remove = (i) => {
    const next = value.slice();
    next.splice(i, 1);
    onChange(next);
  };
  const update = (i, v) => {
    const next = value.slice();
    next[i] = v;
    onChange(next);
  };

  return (
    <div
      style={{
        border: "1px solid var(--border-2)",
        borderRadius: 4,
        padding: 8,
        display: "flex",
        flexDirection: "column",
        gap: 6,
        background: "var(--panel-2)",
      }}
    >
      {value.length === 0 && (
        <div style={{ fontSize: 11, color: "var(--text-3)", fontStyle: "italic" }}>
          empty list — click "Add" to push items
        </div>
      )}
      {value.map((item, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span
            className="mono"
            style={{ fontSize: 10, color: "var(--text-3)", width: 24 }}
          >
            [{i}]
          </span>
          {ctrl === "boolean" ? (
            <EventTesterToggle value={!!item} onChange={(v) => update(i, v)} />
          ) : ctrl === "number" ? (
            <input
              type="number"
              value={item ?? ""}
              onChange={(e) => update(i, e.target.value)}
              style={{ ...EventTesterInputStyle, flex: 1, background: "var(--bg)" }}
            />
          ) : (
            <input
              type="text"
              value={item ?? ""}
              onChange={(e) => update(i, e.target.value)}
              style={{ ...EventTesterInputStyle, flex: 1, background: "var(--bg)" }}
            />
          )}
          <button
            onClick={() => remove(i)}
            style={{ color: "var(--text-3)", padding: 4 }}
            aria-label={`remove item ${i}`}
            title="Remove"
          >
            <Icon name="x" size={11} />
          </button>
        </div>
      ))}
      <Button small icon="plus" tone="ghost" onClick={add}>
        Add {innerType}
      </Button>
    </div>
  );
}

function EventTesterMonacoJson({ value, onChange }) {
  // Coerce object → JSON string for the editor; the parent re-parses on publish.
  const text = useMemoET(() => {
    if (typeof value === "string") return value;
    try {
      return value == null ? "" : JSON.stringify(value, null, 2);
    } catch {
      return "";
    }
  }, [value]);
  return (
    <MonacoEditor
      value={text}
      onChange={onChange}
      language="json"
      height={140}
    />
  );
}

// ---------- presets ----------
function EventTesterPresets({ tenantSlug, eventName, subject, fieldValues, testMode, onLoad }) {
  const [list, setList] = useStateET(() => eventTesterLoadPresets(tenantSlug, eventName));
  const [saving, setSaving] = useStateET(false);
  const [name, setName] = useStateET("");

  useEffectET(() => {
    setList(eventTesterLoadPresets(tenantSlug, eventName));
    setSaving(false);
    setName("");
  }, [tenantSlug, eventName]);

  const save = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const next = [
      ...list.filter((p) => p.name !== trimmed),
      {
        name: trimmed,
        subject,
        fieldValues,
        testMode,
        savedAt: Date.now(),
      },
    ].sort((a, b) => a.name.localeCompare(b.name));
    eventTesterSavePresets(tenantSlug, eventName, next);
    setList(next);
    setSaving(false);
    setName("");
  };
  const remove = (n) => {
    const next = list.filter((p) => p.name !== n);
    eventTesterSavePresets(tenantSlug, eventName, next);
    setList(next);
  };

  return (
    <Panel
      title={`Presets · ${list.length}`}
      padded
      action={
        saving ? null : (
          <Button small icon="plus" tone="ghost" onClick={() => setSaving(true)}>
            Save current
          </Button>
        )
      }
    >
      {saving && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            marginBottom: 10,
          }}
        >
          <input
            type="text"
            placeholder="preset name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") save();
              if (e.key === "Escape") {
                setSaving(false);
                setName("");
              }
            }}
            autoFocus
            style={{ ...EventTesterInputStyle, flex: 1 }}
          />
          <Button small tone="primary" onClick={save}>
            Save
          </Button>
          <Button small tone="ghost" onClick={() => { setSaving(false); setName(""); }}>
            Cancel
          </Button>
        </div>
      )}
      {list.length === 0 ? (
        <div style={{ fontSize: 11.5, color: "var(--text-3)" }}>
          No presets saved yet. They live in this browser only.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {list.map((p) => (
            <div
              key={p.name}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "6px 8px",
                background: "var(--panel-2)",
                border: "1px solid var(--border)",
                borderRadius: 4,
              }}
            >
              <span
                className="mono"
                style={{ fontSize: 11.5, color: "var(--text)", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
              >
                {p.name}
              </span>
              <span style={{ fontSize: 10.5, color: "var(--text-3)", fontFamily: "var(--mono)" }}>
                {p.savedAt ? window.fmtAgo(p.savedAt) : ""}
              </span>
              <Button small tone="ghost" onClick={() => onLoad(p)}>
                Load
              </Button>
              <button
                onClick={() => remove(p.name)}
                style={{ color: "var(--text-3)", padding: 4 }}
                aria-label={`delete preset ${p.name}`}
                title="Delete preset"
              >
                <Icon name="x" size={11} />
              </button>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

// ---------- cURL preview ----------
function EventTesterCurlPreview({ event, subject, payload, testMode }) {
  const [revealed, setRevealed] = useStateET(false);
  // No real token in dev (cookie-based AUTH_MODE); show a placeholder that
  // users can hover. If a real Bearer token cookie ever lands here, replace
  // this with the actual mask.
  const fakeToken = "agentic-dev-token-xxxxxxxxxxxxxxxxxxxxxxxxxxxx";
  const display = revealed ? fakeToken : `${fakeToken.slice(0, 6)}${"·".repeat(10)}`;
  const body = {
    name: event.name,
    subject: subject || undefined,
    test: testMode,
    source: "operator",
    payload,
  };
  const cleaned = JSON.parse(JSON.stringify(body, (_k, v) => (v === undefined ? undefined : v)));
  const cmd = `curl -X POST ${window.location.origin}/v1/events \\
  -H 'Authorization: Bearer ${display}' \\
  -H 'Content-Type: application/json' \\
  -d '${JSON.stringify(cleaned, null, 2)}'`;

  const copy = () => {
    try {
      navigator.clipboard?.writeText(
        cmd.replace(display, fakeToken),
      );
    } catch {}
  };

  return (
    <Panel
      title="cURL"
      padded
      action={
        <div style={{ display: "flex", gap: 6 }}>
          <Button small tone="ghost" onClick={() => setRevealed((v) => !v)}>
            {revealed ? "Hide token" : "Reveal token"}
          </Button>
          <Button small tone="ghost" icon="external" onClick={copy}>
            Copy
          </Button>
        </div>
      }
    >
      <pre
        style={{
          margin: 0,
          padding: "10px 12px",
          background: "var(--bg-2)",
          border: "1px solid var(--border)",
          borderRadius: 4,
          color: "var(--text-2)",
          fontSize: 11,
          fontFamily: "var(--mono)",
          lineHeight: 1.55,
          whiteSpace: "pre-wrap",
          wordBreak: "break-all",
          maxHeight: 280,
          overflow: "auto",
        }}
      >
        {cmd}
      </pre>
    </Panel>
  );
}

// ---------- right rail: recent + causality ----------
function EventTesterRecentPane({ recent, pinnedEventId, causality, navigate, sseState }) {
  return (
    <aside
      style={{
        borderLeft: "1px solid var(--border)",
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        background: "var(--bg)",
      }}
    >
      {/* Causality minimap when pinned */}
      {pinnedEventId && (
        <div
          style={{
            padding: "14px 14px",
            borderBottom: "1px solid var(--border)",
            background: "var(--panel)",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              gap: 8,
              marginBottom: 8,
            }}
          >
            <span
              style={{
                fontSize: 10.5,
                fontFamily: "var(--mono)",
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                color: "var(--text-2)",
              }}
            >
              Causality
            </span>
            <span className="mono" style={{ fontSize: 10.5, color: "var(--text-3)" }}>
              seed {pinnedEventId.slice(0, 12)}…
            </span>
          </div>
          <EventTesterCausalityMinimap
            seedEventId={pinnedEventId}
            causality={causality}
            navigate={navigate}
          />
        </div>
      )}

      {/* Recent list */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "10px 14px",
            borderBottom: "1px solid var(--border)",
          }}
        >
          <span
            style={{
              fontSize: 10.5,
              fontFamily: "var(--mono)",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              color: "var(--text-2)",
            }}
          >
            Recent events
          </span>
          <span className="mono" style={{ fontSize: 10.5, color: "var(--text-3)" }}>
            {recent.length}
          </span>
        </div>
        <div style={{ flex: 1, overflow: "auto" }}>
          {recent.length === 0 ? (
            <div style={{ padding: 16, fontSize: 11.5, color: "var(--text-3)" }}>
              {sseState.status === "open"
                ? "Listening for new events…"
                : sseState.status === "paused"
                ? "Live stream paused (toggle from top bar)."
                : sseState.status === "reconnecting"
                ? "Reconnecting to live stream…"
                : "Connecting to live stream…"}
            </div>
          ) : (
            recent.map((row) => (
              <EventTesterRecentRow
                key={row.id || `${row.name}-${row.receivedAt || row.at}`}
                row={row}
                highlighted={row.id === pinnedEventId}
                navigate={navigate}
              />
            ))
          )}
        </div>
      </div>
    </aside>
  );
}

function EventTesterRecentRow({ row, highlighted, navigate }) {
  const at = row.receivedAt
    ? new Date(row.receivedAt).getTime()
    : row.at || Date.now();
  return (
    <button
      onClick={() => navigate && navigate("events", { eventName: row.name })}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 3,
        width: "100%",
        padding: "8px 14px",
        background: highlighted ? "rgba(208,255,0,0.06)" : "transparent",
        borderBottom: "1px solid var(--border)",
        borderLeft: `2px solid ${highlighted ? "var(--signal)" : "transparent"}`,
        textAlign: "left",
        cursor: "pointer",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <Badge tone={window.eventTone ? window.eventTone(row.color || "muted") : "muted"}>
          {row.name}
        </Badge>
        <span style={{ fontSize: 10.5, color: "var(--text-3)", marginLeft: "auto", fontFamily: "var(--mono)" }}>
          {window.fmtAgo ? window.fmtAgo(at) : ""}
        </span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span className="mono" style={{ fontSize: 10.5, color: "var(--text-3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, minWidth: 0 }}>
          {row.id || ""}
        </span>
        {row.subject && (
          <span className="mono" style={{ fontSize: 10.5, color: "var(--text-2)", flexShrink: 0 }}>
            {row.subject}
          </span>
        )}
      </div>
    </button>
  );
}

// ---------- causality minimap (BFS DAG, SVG) ----------
function EventTesterCausalityMinimap({ seedEventId, causality, navigate }) {
  // Compute lane layout. Lane 0: seed. Lane 1: triggered runs. Lane 2:
  // emitted events. Lane 3+: grand-children. We keep this depth-bounded.
  const layout = useMemoET(() => {
    const events = (causality?.events || []).slice();
    const runs = (causality?.runs || []).slice();
    const edges = (causality?.edges || []).slice();

    // Ensure the seed is present even if the API hasn't echoed it yet.
    if (!events.some((e) => e.id === seedEventId)) {
      events.unshift({ id: seedEventId, name: "(seed)", color: "muted" });
    }

    const nodesById = new Map();
    events.forEach((e) =>
      nodesById.set(e.id, {
        id: e.id,
        kind: "event",
        label: e.name || e.id,
        color: e.color || "muted",
      }),
    );
    runs.forEach((r) =>
      nodesById.set(r.id, {
        id: r.id,
        kind: "run",
        label: r.agentName || r.id,
        status: r.status,
      }),
    );

    // BFS from seed using edges.
    const depthOf = new Map();
    depthOf.set(seedEventId, 0);
    const queue = [seedEventId];
    while (queue.length) {
      const cur = queue.shift();
      const d = depthOf.get(cur);
      for (const e of edges) {
        if (e.from === cur && !depthOf.has(e.to)) {
          depthOf.set(e.to, d + 1);
          queue.push(e.to);
        }
      }
    }
    // Catch-all for orphans (assign by kind heuristic).
    for (const [id, node] of nodesById) {
      if (depthOf.has(id)) continue;
      depthOf.set(id, node.kind === "run" ? 1 : 2);
    }

    // Group by depth.
    const lanes = new Map();
    for (const [id, d] of depthOf) {
      if (!lanes.has(d)) lanes.set(d, []);
      lanes.get(d).push(id);
    }
    const sortedLanes = Array.from(lanes.entries()).sort((a, b) => a[0] - b[0]);

    const NODE_W = 110;
    const NODE_H = 28;
    const COL_GAP = 28;
    const ROW_GAP = 10;
    const PAD = 8;

    const positions = new Map();
    let maxRows = 0;
    sortedLanes.forEach(([_d, ids], laneIdx) => {
      ids.forEach((id, rowIdx) => {
        positions.set(id, {
          x: PAD + laneIdx * (NODE_W + COL_GAP),
          y: PAD + rowIdx * (NODE_H + ROW_GAP),
        });
      });
      maxRows = Math.max(maxRows, ids.length);
    });

    const width = PAD * 2 + sortedLanes.length * NODE_W + (sortedLanes.length - 1) * COL_GAP;
    const height = PAD * 2 + maxRows * NODE_H + (maxRows - 1) * ROW_GAP;

    return {
      nodes: Array.from(nodesById.values()),
      edges,
      positions,
      width: Math.max(width, 200),
      height: Math.max(height, 60),
      NODE_W,
      NODE_H,
    };
  }, [causality, seedEventId]);

  if (!causality && !seedEventId) return null;

  const { nodes, edges, positions, width, height, NODE_W, NODE_H } = layout;

  const statusColor = (status) => {
    if (status === "ok" || status === "succeeded") return "var(--green)";
    if (status === "running") return "var(--signal)";
    if (status === "failed") return "var(--red)";
    if (status === "waiting") return "var(--amber)";
    return "var(--text-3)";
  };
  const eventColor = (c) =>
    ({
      green: "var(--green)",
      blue: "var(--blue)",
      amber: "var(--amber)",
      red: "var(--red)",
      muted: "var(--text-3)",
    })[c] || "var(--text-3)";

  return (
    <div style={{ overflow: "auto" }}>
      <svg
        width={width}
        height={height}
        style={{ display: "block" }}
        role="img"
        aria-label="Causality minimap"
      >
        <defs>
          <marker
            id="et-arrow"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto"
          >
            <path d="M0,0 L10,5 L0,10 z" fill="var(--text-3)" />
          </marker>
        </defs>
        {edges.map((e, i) => {
          const a = positions.get(e.from);
          const b = positions.get(e.to);
          if (!a || !b) return null;
          const sx = a.x + NODE_W;
          const sy = a.y + NODE_H / 2;
          const dx = b.x;
          const dy = b.y + NODE_H / 2;
          const cx1 = sx + Math.max(20, (dx - sx) * 0.5);
          const cx2 = dx - Math.max(20, (dx - sx) * 0.5);
          return (
            <path
              key={i}
              d={`M ${sx} ${sy} C ${cx1} ${sy}, ${cx2} ${dy}, ${dx} ${dy}`}
              stroke={e.kind === "emitted_event" ? "var(--signal-dim)" : "var(--text-3)"}
              strokeWidth={1}
              fill="none"
              markerEnd="url(#et-arrow)"
              opacity={0.6}
            />
          );
        })}
        {nodes.map((n) => {
          const p = positions.get(n.id);
          if (!p) return null;
          const stroke =
            n.kind === "event"
              ? eventColor(n.color)
              : statusColor(n.status);
          return (
            <g
              key={n.id}
              transform={`translate(${p.x},${p.y})`}
              style={{ cursor: "pointer" }}
              onClick={() => {
                if (n.kind === "run") navigate && navigate("runs", { runId: n.id });
                else navigate && navigate("events", { eventName: n.label });
              }}
            >
              <rect
                width={NODE_W}
                height={NODE_H}
                rx={4}
                fill="var(--panel-2)"
                stroke={stroke}
                strokeWidth={n.id === seedEventId ? 1.6 : 1}
              />
              <text
                x={6}
                y={11}
                fontSize={9}
                fontFamily="var(--mono)"
                fill="var(--text-3)"
                style={{ textTransform: "uppercase", letterSpacing: "0.08em" }}
              >
                {n.kind}
              </text>
              <text
                x={6}
                y={22}
                fontSize={10}
                fontFamily="var(--mono)"
                fill="var(--text)"
              >
                {n.label.length > 14 ? n.label.slice(0, 13) + "…" : n.label}
              </text>
            </g>
          );
        })}
      </svg>
      {(!edges || edges.length === 0) && (
        <div
          style={{
            fontSize: 10.5,
            color: "var(--text-3)",
            padding: "6px 2px 0",
            fontFamily: "var(--mono)",
          }}
        >
          waiting for downstream runs…
        </div>
      )}
    </div>
  );
}

window.EventTester = EventTester;
console.log("[Agentic Operator] event-tester view loaded");
