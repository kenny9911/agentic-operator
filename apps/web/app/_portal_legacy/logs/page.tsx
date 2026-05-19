import { Badge, Button, Icon, ViewHeader } from "@/components";
import { readPrefs } from "@/lib/prefs";
import { readdir, stat, readFile } from "node:fs/promises";
import path from "node:path";
import Link from "next/link";
import { LiveLogTail } from "./_components/LiveLogTail";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface SearchParams {
  path?: string;
  grep?: string;
  level?: "all" | "DEBUG" | "INFO" | "WARN" | "ERROR";
}

interface FileNode {
  kind: "file";
  name: string;
  path: string;
  size: number;
  live?: boolean;
}
interface DirNode {
  kind: "dir";
  name: string;
  children: TreeNode[];
  count?: number;
}
type TreeNode = FileNode | DirNode;

export default async function LogsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const prefs = await readPrefs();
  const grep = params.grep?.trim() ?? "";
  const level = params.level ?? "all";

  const root = process.env.AGENTIC_LOGS_DIR ?? "./logs";
  const tenantRoot = path.join(root, prefs.tenant);
  const tree = await buildTree(tenantRoot);
  const flatFiles = collectFiles(tree);

  // Default to the newest run log so the file viewer/tail shows something
  // useful on first load; fall back to whatever's there.
  const preferredDefault =
    flatFiles.find((f) => f.path.startsWith("runs/") && f.path.endsWith(".log"))
      ?.path ?? flatFiles[0]?.path ?? null;
  const selectedPath =
    params.path && flatFiles.some((f) => f.path === params.path)
      ? params.path
      : preferredDefault;

  const isLatestRunLog =
    selectedPath?.startsWith("runs/") && selectedPath?.endsWith(".log");

  // Pull runId from path so the SSE component can subscribe
  const runIdMatch = selectedPath?.match(/run-[A-Za-z0-9]+/);
  const runId = runIdMatch?.[0] ?? null;
  const fileSize: number | null = selectedPath
    ? (flatFiles.find((f) => f.path === selectedPath)?.size ?? null)
    : null;

  // For non-live files, read content statically
  const staticContent =
    selectedPath && !isLatestRunLog
      ? await readFileSafe(path.join(tenantRoot, selectedPath))
      : null;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
      }}
    >
      <ViewHeader
        title="Logs"
        subtitle="File-backed logs · written per run to data/logs · rotated daily"
        action={
          <Button icon="external" small>
            Export window
          </Button>
        }
      />

      <div
        style={{
          flex: 1,
          display: "grid",
          gridTemplateColumns: "280px 1fr",
          minHeight: 0,
        }}
      >
        <aside
          style={{
            borderRight: "1px solid var(--border)",
            overflow: "auto",
            padding: "10px 0",
          }}
        >
          {flatFiles.length === 0 ? (
            <div
              style={{
                padding: 16,
                fontSize: 12,
                color: "var(--text-3)",
              }}
            >
              No log files yet. Fire an event to{" "}
              <code className="mono">/v1/events</code>.
            </div>
          ) : (
            <FileTree
              node={{ kind: "dir", name: "logs", children: tree }}
              depth={0}
              selectedPath={selectedPath}
              grep={grep}
              level={level}
              initialOpen
            />
          )}
        </aside>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            minHeight: 0,
            overflow: "hidden",
          }}
        >
          <form
            action="/logs"
            method="get"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "10px 14px",
              borderBottom: "1px solid var(--border)",
            }}
          >
            {selectedPath && (
              <input type="hidden" name="path" value={selectedPath} />
            )}
            <Icon name="logs" size={12} />
            <span
              className="mono"
              style={{
                fontSize: 12,
                color: "var(--text)",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                maxWidth: "40%",
              }}
            >
              {selectedPath ?? "no file selected"}
            </span>
            {fileSize != null && (
              <Badge tone="muted">{fmtBytes(fileSize)}</Badge>
            )}
            {isLatestRunLog && (
              <Badge tone="signal">
                <span
                  className="live-dot"
                  style={{ width: 5, height: 5 }}
                />{" "}
                TAIL
              </Badge>
            )}
            <div
              style={{
                marginLeft: "auto",
                display: "flex",
                gap: 6,
                alignItems: "center",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "5px 8px",
                  background: "var(--panel-2)",
                  border: "1px solid var(--border)",
                  borderRadius: 4,
                }}
              >
                <svg
                  width={12}
                  height={12}
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  style={{ color: "var(--text-3)" }}
                >
                  <circle cx="11" cy="11" r="8" />
                  <path d="m21 21-4.35-4.35" />
                </svg>
                <input
                  name="grep"
                  defaultValue={grep}
                  placeholder="grep…"
                  style={{
                    background: "transparent",
                    border: "none",
                    outline: "none",
                    color: "var(--text)",
                    fontSize: 12,
                    width: 140,
                    fontFamily: "var(--sans)",
                  }}
                />
              </div>
              <select
                name="level"
                defaultValue={level}
                style={{
                  padding: "5px 8px",
                  background: "var(--panel-2)",
                  color: "var(--text)",
                  border: "1px solid var(--border-2)",
                  borderRadius: 4,
                  fontSize: 11.5,
                  fontFamily: "var(--mono)",
                }}
              >
                <option value="all">all levels</option>
                <option value="DEBUG">DEBUG</option>
                <option value="INFO">INFO</option>
                <option value="WARN">WARN</option>
                <option value="ERROR">ERROR</option>
              </select>
              <Button small type="submit">
                Filter
              </Button>
            </div>
          </form>

          <div
            style={{
              flex: 1,
              overflow: "auto",
              background: "var(--bg-2)",
              minHeight: 0,
            }}
          >
            {!selectedPath ? (
              <div
                style={{
                  padding: 30,
                  textAlign: "center",
                  color: "var(--text-3)",
                  fontSize: 12,
                }}
              >
                Select a file from the tree to view it.
              </div>
            ) : isLatestRunLog && runId ? (
              <LiveLogTail runId={runId} />
            ) : staticContent != null ? (
              <StaticLogView content={staticContent} grep={grep} level={level} />
            ) : (
              <div
                style={{
                  padding: 30,
                  textAlign: "center",
                  color: "var(--text-3)",
                  fontSize: 12,
                }}
              >
                File not found.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

async function buildTree(rootDir: string): Promise<TreeNode[]> {
  try {
    const entries = await readdir(rootDir, { withFileTypes: true });
    const dirs: TreeNode[] = [];
    for (const e of entries) {
      if (e.isDirectory()) {
        const sub = await buildSubtree(path.join(rootDir, e.name), [e.name]);
        if (sub) dirs.push(sub);
      }
    }
    return dirs;
  } catch {
    return [];
  }
}

async function buildSubtree(
  abs: string,
  relParts: string[],
): Promise<DirNode | null> {
  try {
    const entries = await readdir(abs, { withFileTypes: true });
    const children: TreeNode[] = [];
    for (const e of entries) {
      const childAbs = path.join(abs, e.name);
      const childRel = [...relParts, e.name];
      if (e.isDirectory()) {
        const sub = await buildSubtree(childAbs, childRel);
        if (sub) children.push(sub);
      } else if (e.isFile()) {
        const st = await stat(childAbs);
        const lastSegment = relParts[relParts.length - 1] ?? "";
        children.push({
          kind: "file",
          name: e.name,
          path: childRel.join("/"),
          size: st.size,
          live: relParts[0] === "runs" && isToday(lastSegment),
        });
      }
    }
    // sort: files by name desc (newest run ids tend to sort lexicographically), dirs by name desc (newest date first)
    children.sort((a, b) => b.name.localeCompare(a.name));
    return {
      kind: "dir",
      name: relParts[relParts.length - 1] ?? "",
      children,
    };
  } catch {
    return null;
  }
}

function collectFiles(nodes: TreeNode[]): FileNode[] {
  const out: FileNode[] = [];
  const walk = (n: TreeNode) => {
    if (n.kind === "file") out.push(n);
    else n.children.forEach(walk);
  };
  nodes.forEach(walk);
  return out;
}

function isToday(dateStr: string): boolean {
  const today = new Date();
  const y = today.getUTCFullYear();
  const m = String(today.getUTCMonth() + 1).padStart(2, "0");
  const d = String(today.getUTCDate()).padStart(2, "0");
  return dateStr === `${y}-${m}-${d}`;
}

async function readFileSafe(absPath: string): Promise<string | null> {
  try {
    return await readFile(absPath, "utf8");
  } catch {
    return null;
  }
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function FileTree({
  node,
  depth,
  selectedPath,
  grep,
  level,
  initialOpen,
}: {
  node: TreeNode;
  depth: number;
  selectedPath: string | null;
  grep: string;
  level: string;
  initialOpen?: boolean;
}) {
  if (node.kind === "file") {
    const active = node.path === selectedPath;
    const sp = new URLSearchParams();
    sp.set("path", node.path);
    if (grep) sp.set("grep", grep);
    if (level !== "all") sp.set("level", level);
    const err = node.name === "errors.log";
    return (
      <Link
        href={`/logs?${sp.toString()}`}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          width: "100%",
          textAlign: "left",
          padding: `3px 10px 3px ${depth * 14 + 24}px`,
          fontSize: 11.5,
          fontFamily: "var(--mono)",
          color: active ? "var(--text)" : err ? "var(--red)" : "var(--text-2)",
          background: active ? "var(--panel-2)" : "transparent",
          borderLeft: active
            ? "2px solid var(--signal)"
            : "2px solid transparent",
          minWidth: 0,
          overflow: "hidden",
          textDecoration: "none",
        }}
      >
        <Icon
          name="logs"
          size={10}
          style={{ color: "var(--text-3)", flexShrink: 0 }}
        />
        <span
          style={{
            flex: 1,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            minWidth: 0,
          }}
        >
          {node.name}
        </span>
        {node.live && (
          <span
            className="live-dot"
            style={{ width: 4, height: 4, flexShrink: 0 }}
          />
        )}
        <span
          style={{
            color: "var(--text-3)",
            fontSize: 10,
            whiteSpace: "nowrap",
            flexShrink: 0,
          }}
        >
          {fmtBytes(node.size)}
        </span>
      </Link>
    );
  }

  const open = initialOpen || depth < 2;
  return (
    <details open={open}>
      <summary
        style={{
          display: "flex",
          alignItems: "center",
          gap: 4,
          padding: `4px 10px 4px ${depth * 14 + 8}px`,
          fontSize: 11.5,
          fontFamily: "var(--mono)",
          color: "var(--text-2)",
          cursor: "pointer",
          listStyle: "none",
        }}
      >
        <Icon
          name={open ? "chevron-down" : "chevron-right"}
          size={10}
          style={{ color: "var(--text-3)" }}
        />
        <span style={{ flex: 1 }}>{node.name}/</span>
        {node.children.length > 0 && (
          <span style={{ color: "var(--text-3)", fontSize: 10 }}>
            {node.children.length}
          </span>
        )}
      </summary>
      {node.children.map((c, i) => (
        <FileTree
          key={i}
          node={c}
          depth={depth + 1}
          selectedPath={selectedPath}
          grep={grep}
          level={level}
        />
      ))}
    </details>
  );
}

function StaticLogView({
  content,
  grep,
  level,
}: {
  content: string;
  grep: string;
  level: string;
}) {
  const lines = content.split("\n");
  return (
    <div
      style={{
        padding: "12px 0",
        fontFamily: "var(--mono)",
        fontSize: 11.5,
        lineHeight: 1.7,
      }}
    >
      {lines.map((line, i) => {
        if (grep && !line.toLowerCase().includes(grep.toLowerCase()))
          return null;
        let lvl = "INFO";
        if (line.includes("ERROR")) lvl = "ERROR";
        else if (line.includes(" WARN ")) lvl = "WARN";
        else if (line.includes("DEBUG")) lvl = "DEBUG";
        if (level !== "all" && lvl !== level) return null;
        let color = "var(--text-2)";
        if (lvl === "ERROR") color = "var(--red)";
        else if (lvl === "WARN") color = "var(--amber)";
        else if (lvl === "DEBUG") color = "var(--text-3)";
        else if (line.includes("emit") || line.includes("run.end"))
          color = "var(--signal)";
        return (
          <div
            key={i}
            style={{
              display: "grid",
              gridTemplateColumns: "44px 1fr",
              gap: 12,
              padding: "0 16px",
              color,
            }}
          >
            <span
              style={{
                color: "var(--text-4)",
                textAlign: "right",
                userSelect: "none",
              }}
            >
              {i + 1}
            </span>
            <span style={{ whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
              {line}
            </span>
          </div>
        );
      })}
    </div>
  );
}
