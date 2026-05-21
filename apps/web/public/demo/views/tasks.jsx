// Tasks — human-in-the-loop inbox + per-task review surface

const { useState: useStateT } = React;

function Tasks({ navigate, params }) {
  const tasks = window.RAAS_TASKS;
  const [filter, setFilter] = useStateT("all");
  const selectedId = params.taskId || tasks[0]?.id;
  const selected = tasks.find(t => t.id === selectedId);

  const filtered = tasks.filter(t => filter === "all" ? true : t.priority === filter);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <ViewHeader
        title="Human tasks"
        subtitle={`${tasks.length} pending · ${tasks.filter(t => t.priority === "high").length} high priority`}
        badge={<Badge tone="amber">{tasks.length} OPEN</Badge>}
      />

      <div style={{ flex: 1, display: "grid", gridTemplateColumns: "420px 1fr", minHeight: 0 }}>
        <aside style={{ borderRight: "1px solid var(--border)", display: "flex", flexDirection: "column", minHeight: 0 }}>
          <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--border)", display: "flex", gap: 6 }}>
            {["all", "high", "med", "low"].map(p => (
              <FilterChip key={p} active={filter === p} onClick={() => setFilter(p)}>{p === "all" ? "All" : p.toUpperCase()}</FilterChip>
            ))}
          </div>
          <div style={{ flex: 1, overflow: "auto" }}>
            {filtered.map(t => (
              <TaskRow key={t.id} task={t} active={selectedId === t.id} onClick={() => navigate("tasks", { taskId: t.id })} />
            ))}
          </div>
        </aside>

        <div style={{ overflow: "auto", minHeight: 0 }}>
          {selected ? <TaskDetail task={selected} navigate={navigate} /> : <Empty title="Inbox zero" hint="No pending human tasks" />}
        </div>
      </div>
    </div>
  );
}

function TaskRow({ task, active, onClick }) {
  return (
    <button onClick={onClick}
      style={{
        display: "block", width: "100%", textAlign: "left",
        padding: "12px 14px",
        borderBottom: "1px solid var(--border)",
        background: active ? "var(--panel-2)" : "transparent",
        borderLeft: active ? "2px solid var(--signal)" : "2px solid transparent",
      }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
        <Badge tone={task.priority === "high" ? "amber" : task.priority === "med" ? "blue" : "muted"} style={{ fontSize: 9.5 }}>{task.priority.toUpperCase()}</Badge>
        <span className="mono" style={{ fontSize: 10.5, color: "var(--text-3)" }}>{task.id}</span>
        <span style={{ marginLeft: "auto", fontSize: 10.5, color: "var(--text-3)", fontFamily: "var(--mono)" }}>{window.fmtAgo(task.createdAt)}</span>
      </div>
      <div style={{ fontSize: 12.5, color: "var(--text)", marginBottom: 3, fontWeight: 500, lineHeight: 1.3 }}>{task.title}</div>
      <div style={{ fontSize: 11, color: "var(--text-3)" }}>{task.awaitingFrom}</div>
    </button>
  );
}

function TaskDetail({ task, navigate }) {
  const agent = window.RAAS_AGENTS.find(a => a.id === task.agentId);
  return (
    <div style={{ padding: 24, maxWidth: 920 }}>
      <header style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <Badge tone={task.priority === "high" ? "amber" : task.priority === "med" ? "blue" : "muted"}>{task.priority.toUpperCase()} PRIORITY</Badge>
          <Badge tone="muted">{task.id}</Badge>
          <ActorTag actor="Human" />
          <span style={{ fontSize: 11, color: "var(--text-3)" }}>created {window.fmtAgo(task.createdAt)}</span>
        </div>
        <h2 style={{ margin: "6px 0 4px 0", fontSize: 24, fontFamily: "var(--display)", fontWeight: 400 }}>{task.title}</h2>
        <div style={{ fontSize: 12.5, color: "var(--text-2)" }}>
          Pending {agent?.title} · awaiting <span style={{ color: "var(--text)" }}>{task.awaitingFrom}</span>
        </div>
      </header>

      {/* Type-specific payload */}
      {task.type === "jdReview" && <JDReviewPayload payload={task.payload} />}
      {task.type === "packageReview" && <PackagePayload payload={task.payload} />}
      {task.type === "resumeFix" && <ResumeFixPayload payload={task.payload} />}
      {task.type === "requirementReClarification" && <ClarificationPayload payload={task.payload} />}
      {task.type === "packageSupplement" && <SupplementPayload payload={task.payload} />}
      {task.type === "manualPublish" && <ManualPublishPayload payload={task.payload} />}

      {/* Decision actions */}
      <div style={{ marginTop: 20, padding: 16, background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 6 }}>
        <div style={{ fontSize: 10.5, fontFamily: "var(--mono)", textTransform: "uppercase", color: "var(--text-3)", letterSpacing: "0.08em", marginBottom: 10 }}>Decide</div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <Button tone="primary" icon="check">{decisionLabel(task.type, "primary")}</Button>
          {decisionLabel(task.type, "secondary") && <Button>{decisionLabel(task.type, "secondary")}</Button>}
          <Button tone="ghost">Snooze</Button>
          <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--text-3)" }}>
            <Kbd>⌘</Kbd> <Kbd>↵</Kbd> approve · <Kbd>⌘</Kbd> <Kbd>R</Kbd> reject
          </span>
        </div>
      </div>

      {/* Run context */}
      <Panel title="Workflow context" padded style={{ marginTop: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12 }}>
          <span style={{ color: "var(--text-3)" }}>Will emit on approve:</span>
          {agent?.emits.map(e => <Badge key={e} tone="green">{e}</Badge>)}
        </div>
        <div style={{ marginTop: 8, fontSize: 12, color: "var(--text-3)" }}>
          Downstream listeners:{" "}
          {(() => {
            const evs = agent?.emits || [];
            const listeners = new Set();
            evs.forEach(e => window.RAAS_AGENTS.filter(a => a.triggers.includes(e)).forEach(a => listeners.add(a.title)));
            return Array.from(listeners).join(", ") || "—";
          })()}
        </div>
      </Panel>
    </div>
  );
}

function decisionLabel(type, slot) {
  const map = {
    jdReview:                  { primary: "Approve JD", secondary: "Reject with notes" },
    packageReview:             { primary: "Approve & submit", secondary: "Send back to recruiter" },
    resumeFix:                 { primary: "Mark fixed", secondary: "Re-upload" },
    requirementReClarification:{ primary: "Submit answers", secondary: null },
    packageSupplement:         { primary: "Mark complete", secondary: null },
    manualPublish:             { primary: "Confirm published", secondary: null },
  };
  return map[type]?.[slot] || "Approve";
}

function JDReviewPayload({ payload }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
      <Panel title="Generated JD" padded action={<Badge tone="muted">draft v3</Badge>}>
        <div style={{ display: "flex", flexDirection: "column", gap: 14, fontSize: 13, color: "var(--text)" }}>
          <div>
            <div className="mono" style={{ fontSize: 10.5, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Title</div>
            <div style={{ fontSize: 14, fontWeight: 500 }}>{payload.title}</div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <KV label="Level" value={payload.level} mono />
            <KV label="City" value={payload.city} />
            <KV label="Salary" value={payload.salary} />
            <KV label="Status" value={<Badge tone="signal">DRAFT</Badge>} />
          </div>
          <div>
            <div className="mono" style={{ fontSize: 10.5, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>Responsibilities</div>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, lineHeight: 1.55, color: "var(--text)", display: "flex", flexDirection: "column", gap: 6 }}>
              {payload.responsibilities.map((r, i) => <li key={i}>{r}</li>)}
            </ul>
          </div>
          <div>
            <div className="mono" style={{ fontSize: 10.5, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>Requirements</div>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, lineHeight: 1.55, color: "var(--text)", display: "flex", flexDirection: "column", gap: 6 }}>
              {payload.requirements.map((r, i) => <li key={i}>{r}</li>)}
            </ul>
          </div>
        </div>
      </Panel>
      <Panel title="Agent reasoning" padded>
        <div style={{ display: "flex", flexDirection: "column", gap: 10, fontSize: 12, color: "var(--text-2)", lineHeight: 1.6 }}>
          <p style={{ margin: 0 }}>Drafted from <span className="mono" style={{ color: "var(--text)" }}>REQ-2041</span> after clarification. Template <span className="mono" style={{ color: "var(--text)" }}>jd-tencent-wxg-v3</span> applied.</p>
          <p style={{ margin: 0 }}>Top 5 search keywords surfaced: <span className="mono" style={{ color: "var(--signal)" }}>backend, java, go, messaging, distributed-systems</span>.</p>
          <p style={{ margin: 0 }}>Salary range confirmed within ¥45-65k client cap.</p>
          <div style={{ marginTop: 6, padding: 10, background: "var(--panel-2)", border: "1px dashed var(--border-2)", borderRadius: 4, fontSize: 11.5 }}>
            <strong style={{ color: "var(--amber)" }}>Heads up · </strong>
            <span style={{ color: "var(--text-2)" }}>This req has been re-opened twice in 2026 Q1. Consider tightening 'distributed systems fundamentals' before posting to BOSS.</span>
          </div>
        </div>
      </Panel>
    </div>
  );
}

function PackagePayload({ payload }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 12 }}>
      <Panel title="Candidate package" padded action={<Badge tone="signal">SCORE {payload.matchScore}</Badge>}>
        <div style={{ fontSize: 18, fontFamily: "var(--display)", marginBottom: 12 }}>{payload.candidate}</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <KV label="Match" value={`${payload.matchScore}/100`} mono />
          <KV label="Missing items" value={payload.missingItems.length === 0 ? <Badge tone="green">COMPLETE</Badge> : payload.missingItems.join(", ")} />
          <div>
            <div className="mono" style={{ fontSize: 10.5, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>Highlights</div>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, lineHeight: 1.55 }}>
              {payload.highlights.map((h, i) => <li key={i}>{h}</li>)}
            </ul>
          </div>
        </div>
        <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
          <Button small icon="external">Resume.pdf</Button>
          <Button small icon="external">Interview clip</Button>
          <Button small icon="external">Eval report</Button>
        </div>
      </Panel>
      <Panel title="Submission preview" padded>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 12, color: "var(--text)" }}>
          <KV label="Target" value="Tencent ATS · WXG queue" />
          <KV label="Method" value="API auto-submit" />
          <KV label="Mock dry-run" value={<Badge tone="green">OK · req-ack received</Badge>} />
          <KV label="Will emit" value={<Badge tone="green">APPLICATION_SUBMITTED</Badge>} />
        </div>
      </Panel>
    </div>
  );
}

function ResumeFixPayload({ payload }) {
  return (
    <Panel title="Parse error" padded action={<Badge tone="red">PARSE FAIL</Badge>}>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <KV label="File" value={<span className="mono">{payload.file}</span>} />
        <div>
          <div className="mono" style={{ fontSize: 10.5, color: "var(--text-3)", textTransform: "uppercase", marginBottom: 4 }}>Error</div>
          <div style={{ fontSize: 12.5, color: "var(--red)", padding: 10, background: "rgba(255,100,112,0.06)", border: "1px solid rgba(255,100,112,0.25)", borderRadius: 4 }}>{payload.error}</div>
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
          <Button small icon="upload">Re-upload PDF</Button>
          <Button small>Edit parsed fields</Button>
        </div>
      </div>
    </Panel>
  );
}

function ClarificationPayload({ payload }) {
  return (
    <Panel title="Open questions for client" padded>
      <ol style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 10 }}>
        {payload.questions.map((q, i) => (
          <li key={i} style={{ fontSize: 13, color: "var(--text)", lineHeight: 1.5 }}>
            {q}
            <input placeholder="answer…" style={{
              display: "block", marginTop: 6, width: "100%",
              padding: "6px 10px", fontSize: 12,
              background: "var(--panel-2)", border: "1px solid var(--border)", borderRadius: 4,
              color: "var(--text)", fontFamily: "var(--sans)",
            }} />
          </li>
        ))}
      </ol>
    </Panel>
  );
}

function SupplementPayload({ payload }) {
  return (
    <Panel title="Items requested" padded>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {payload.missing.map(m => (
          <div key={m} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", background: "var(--panel-2)", border: "1px dashed var(--border-2)", borderRadius: 4 }}>
            <Icon name="upload" size={12} style={{ color: "var(--text-3)" }} />
            <span className="mono" style={{ fontSize: 12, color: "var(--text)" }}>{m}</span>
            <Button small style={{ marginLeft: "auto" }}>Attach</Button>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function ManualPublishPayload({ payload }) {
  return (
    <Panel title="Manual publish required" padded>
      <KV label="Channel" value={<Badge tone="amber">{payload.channel}</Badge>} />
      <KV label="Reason" value={payload.reason} />
      <div style={{ marginTop: 10, padding: 12, background: "var(--panel-2)", border: "1px dashed var(--border-2)", borderRadius: 4, fontSize: 12, color: "var(--text-2)" }}>
        Open the generated helper page → copy each field into the channel's post composer → return here and confirm.
      </div>
      <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
        <Button small icon="external" tone="primary">Open helper page</Button>
      </div>
    </Panel>
  );
}

function KV({ label, value, mono }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: 8, fontSize: 12.5, alignItems: "center" }}>
      <span style={{ fontSize: 10.5, fontFamily: "var(--mono)", textTransform: "uppercase", color: "var(--text-3)", letterSpacing: "0.06em" }}>{label}</span>
      <span style={{ color: "var(--text)", fontFamily: mono ? "var(--mono)" : "var(--sans)" }}>{value}</span>
    </div>
  );
}
window.KV = KV;

window.Tasks = Tasks;
