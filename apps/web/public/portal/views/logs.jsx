// Logs — file-backed log explorer

const { useState: useStateLog, useMemo: useMemoLog } = React;

function Logs({ navigate, params, liveStream }) {
  // Generate a mock log-file tree
  const tree = useMemoLog(() => buildLogTree(), []);
  const [selectedPath, setSelectedPath] = useStateLog("logs/runs/2026-05-16/run-01000.log");
  const [grep, setGrep] = useStateLog("");
  const [level, setLevel] = useStateLog("all");

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <ViewHeader
        title="Logs"
        subtitle="File-backed logs · written per run to /var/agentic/logs · rotated daily"
        action={[<Button key="export" icon="external" small>Export window</Button>]}
      />

      <div style={{ flex: 1, display: "grid", gridTemplateColumns: "280px 1fr", minHeight: 0 }}>
        <aside style={{ borderRight: "1px solid var(--border)", overflow: "auto", padding: "10px 0" }}>
          <FileTree tree={tree} selectedPath={selectedPath} onSelect={setSelectedPath} />
        </aside>

        <div style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
          {/* Toolbar */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", borderBottom: "1px solid var(--border)" }}>
            <Icon name="logs" size={12} style={{ color: "var(--text-3)" }} />
            <span className="mono" style={{ fontSize: 12, color: "var(--text)" }}>{selectedPath}</span>
            <Badge tone="muted">14.2 KB</Badge>
            {liveStream && <Badge tone="signal"><span className="live-dot" style={{ width: 5, height: 5 }} /> TAIL</Badge>}
            <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
              <SearchInput value={grep} onChange={setGrep} placeholder="grep…" />
              <select value={level} onChange={(e) => setLevel(e.target.value)} style={{
                padding: "5px 8px",
                background: "var(--panel-2)", color: "var(--text)",
                border: "1px solid var(--border-2)", borderRadius: 4,
                fontSize: 11.5, fontFamily: "var(--mono)",
              }}>
                <option value="all">all levels</option>
                <option value="DEBUG">DEBUG</option>
                <option value="INFO">INFO</option>
                <option value="WARN">WARN</option>
                <option value="ERROR">ERROR</option>
              </select>
            </div>
          </div>

          {/* Log body */}
          <div style={{ flex: 1, overflow: "auto", background: "var(--bg-2)" }}>
            <LogView grep={grep} level={level} live={liveStream} />
          </div>
        </div>
      </div>
    </div>
  );
}

function buildLogTree() {
  return {
    name: "logs",
    children: [
      {
        name: "runs",
        children: [
          {
            name: "2026-05-16",
            children: [
              { name: "run-01000.log", path: "logs/runs/2026-05-16/run-01000.log", size: "14.2 KB", live: true },
              { name: "run-01001.log", path: "logs/runs/2026-05-16/run-01001.log", size: "8.1 KB", live: true },
              { name: "run-01002.log", path: "logs/runs/2026-05-16/run-01002.log", size: "22.7 KB", live: true },
              { name: "run-02041.log", path: "logs/runs/2026-05-16/run-02041.log", size: "6.4 KB" },
              { name: "run-02042.log", path: "logs/runs/2026-05-16/run-02042.log", size: "11.0 KB" },
              { name: "run-02043.log", path: "logs/runs/2026-05-16/run-02043.log", size: "3.2 KB", err: true },
            ]
          },
          { name: "2026-05-15", count: 1872 },
          { name: "2026-05-14", count: 1718 },
          { name: "2026-05-13", count: 1640 },
        ]
      },
      {
        name: "events",
        children: [
          { name: "2026-05-16.ndjson", path: "logs/events/2026-05-16.ndjson", size: "412 KB" },
          { name: "2026-05-15.ndjson", path: "logs/events/2026-05-15.ndjson", size: "1.1 MB" },
          { name: "2026-05-14.ndjson", path: "logs/events/2026-05-14.ndjson", size: "1.0 MB" },
        ]
      },
      {
        name: "system",
        children: [
          { name: "inngest.log", path: "logs/system/inngest.log", size: "84 KB" },
          { name: "scheduler.log", path: "logs/system/scheduler.log", size: "22 KB" },
          { name: "errors.log", path: "logs/system/errors.log", size: "9.1 KB", err: true },
        ]
      },
    ]
  };
}

function FileTree({ tree, selectedPath, onSelect }) {
  return <TreeNode node={tree} depth={0} selectedPath={selectedPath} onSelect={onSelect} initialOpen />;
}

function TreeNode({ node, depth, selectedPath, onSelect, initialOpen }) {
  const [open, setOpen] = useStateLog(initialOpen || depth < 2);
  const isFile = !node.children;
  if (isFile) {
    const active = node.path === selectedPath;
    return (
      <button
        onClick={() => onSelect(node.path)}
        style={{
          display: "flex", alignItems: "center", gap: 6,
          width: "100%", textAlign: "left",
          padding: `3px 10px 3px ${depth * 14 + 24}px`,
          fontSize: 11.5, fontFamily: "var(--mono)",
          color: active ? "var(--text)" : (node.err ? "var(--red)" : "var(--text-2)"),
          background: active ? "var(--panel-2)" : "transparent",
          borderLeft: active ? "2px solid var(--signal)" : "2px solid transparent",
          minWidth: 0, overflow: "hidden",
        }}
      >
        <Icon name="logs" size={10} style={{ color: "var(--text-3)", flexShrink: 0 }} />
        <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>{node.name}</span>
        {node.live && <span className="live-dot" style={{ width: 4, height: 4, flexShrink: 0 }} />}
        <span style={{ color: "var(--text-3)", fontSize: 10, whiteSpace: "nowrap", flexShrink: 0 }}>{node.size}</span>
      </button>
    );
  }
  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        style={{
          display: "flex", alignItems: "center", gap: 4,
          width: "100%", textAlign: "left",
          padding: `4px 10px 4px ${depth * 14 + 8}px`,
          fontSize: 11.5, fontFamily: "var(--mono)",
          color: "var(--text-2)",
        }}
      >
        <Icon name={open ? "chevron-down" : "chevron-right"} size={10} style={{ color: "var(--text-3)" }} />
        <span style={{ flex: 1 }}>{node.name}/</span>
        {node.count && <span style={{ color: "var(--text-3)", fontSize: 10 }}>{node.count} files</span>}
      </button>
      {open && node.children?.map((c, i) => (
        <TreeNode key={i} node={c} depth={depth + 1} selectedPath={selectedPath} onSelect={onSelect} />
      ))}
    </div>
  );
}

function LogView({ grep, level, live }) {
  const lines = window.RAAS_SAMPLE_LOG.split("\n");

  return (
    <div style={{ padding: "12px 0", fontFamily: "var(--mono)", fontSize: 11.5, lineHeight: 1.7 }}>
      {lines.map((line, i) => {
        if (grep && !line.toLowerCase().includes(grep.toLowerCase())) return null;
        let lvl = "INFO";
        if (line.includes("ERROR")) lvl = "ERROR";
        else if (line.includes(" WARN ")) lvl = "WARN";
        else if (line.includes("DEBUG")) lvl = "DEBUG";
        if (level !== "all" && lvl !== level) return null;
        let color = "var(--text-2)";
        if (lvl === "ERROR") color = "var(--red)";
        else if (lvl === "WARN") color = "var(--amber)";
        else if (lvl === "DEBUG") color = "var(--text-3)";
        else if (line.includes("emit") || line.includes("run.end")) color = "var(--signal)";
        return (
          <div key={i} style={{ display: "grid", gridTemplateColumns: "44px 1fr", gap: 12, padding: "0 16px", color }}>
            <span style={{ color: "var(--text-4)", textAlign: "right", userSelect: "none" }}>{i + 1}</span>
            <span style={{ whiteSpace: "pre-wrap", wordBreak: "break-all" }}>{line}</span>
          </div>
        );
      })}
      {live && (
        <div style={{ display: "grid", gridTemplateColumns: "44px 1fr", gap: 12, padding: "0 16px", color: "var(--text-3)" }}>
          <span style={{ color: "var(--text-4)", textAlign: "right" }}>{lines.length + 1}</span>
          <span><span className="live-dot" style={{ width: 6, height: 6 }} /> waiting for next line…</span>
        </div>
      )}
    </div>
  );
}

window.Logs = Logs;
