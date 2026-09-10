/**
 * Agent 工厂 — 本体上传的纯逻辑（无 JSX、无 IO、无 FileList）。
 *
 * 曲别针 📎 是本体/工具文档的唯一上传入口。这里只做两件纯计算：
 *   1. classifyAttachment — 一份附件按 CONTENT 判定是「本体 JSON」还是「工具/参考文档」。
 *   2. buildOntologyBundle — 把（已读成文本的）多份本体文件合并成一个 { actions/events/rules/
 *      dataObjects } 包，并保留来源显式提供的 links/workflow；供后端保存。
 *
 * 关键：调用方先把 File 读成 { name, text } 再传进来——绝不在这里碰 input.files。
 * 历史 bug：清空 <input type=file> 会顺带清空同一个 live FileList，随后再读 files[0].name
 * 就 undefined.name 崩溃。纯函数从结构上杜绝了这条路径。
 */

export interface OntologyFile {
  name: string;
  text: string;
}

export interface OntologyBundle {
  actions: unknown[];
  events: unknown[];
  rules: unknown[];
  dataObjects: unknown[];
  /** Omitted means no link graph was supplied; [] is an explicitly empty graph. */
  links?: unknown[];
  workflow?: unknown[];
}

export interface OntologyBundleResult {
  bundle: OntologyBundle;
  /** 文件不是合法 JSON → 累积列出，绝不被成功提示吞掉。 */
  skipped: string[];
  /** 贡献了内容的 JSON 文件名。 */
  used: string[];
  actionCount: number;
  eventCount: number;
  ruleCount: number;
  objectCount: number;
}

/** Match the accepted upload aliases in uploaded-ontology-store.ts. */
const FIELD_ALIASES: Record<keyof OntologyBundle, readonly string[]> = {
  actions: ["actions", "action"],
  events: ["events", "event"],
  rules: ["rules", "rule"],
  dataObjects: ["dataObjects", "objects", "object", "entities"],
  links: ["links", "link"],
  workflow: ["workflow", "workflows", "agents"],
};

function arrayBucket(name: string): keyof OntologyBundle {
  const lower = name.toLowerCase();
  // The final artifact token wins over scenario prefixes (workflow.events.json)
  // and descriptive words (linked-actions.json). Keep legacy substring matching
  // below for older exports whose names have no standalone artifact token.
  for (const token of lower.split(/[^a-z0-9]+/).reverse()) {
    for (const [key, aliases] of Object.entries(FIELD_ALIASES)) {
      if (aliases.some((alias) => alias.toLowerCase() === token)) return key as keyof OntologyBundle;
    }
  }
  if (/event/.test(lower)) return "events";
  if (/rule/.test(lower)) return "rules";
  if (/object|entit/.test(lower)) return "dataObjects";
  if (/action/.test(lower)) return "actions";
  if (/link/.test(lower)) return "links";
  if (/workflow|agent/.test(lower)) return "workflow";
  return "actions";
}

function ontologyArrayName(name: string): boolean {
  return /action|event|rule|object|entit|ontolog|link|workflow|agent/i.test(name);
}

/** 去掉扩展名，得到默认业务域名字（曲别针没有名字输入框，默认取第一份本体文件名）。 */
export function stripExt(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, "").trim();
}

/**
 * 按内容把一份附件判成「本体」还是「工具文档」。
 * - 本体：JSON 对象带受支持的本体键；或具本体文件名/动作结构的数组（包括显式空数组）。
 * - 其它（OpenAPI、散文、纯 JSON 但无本体键）：工具文档 → 大脑读后 create_tool。
 */
export function classifyAttachment(name: string, text: string): "ontology" | "tooldoc" {
  const t = text.trim();
  if (t.startsWith("{") || t.startsWith("[")) {
    try {
      const j: unknown = JSON.parse(t);
      if (j && typeof j === "object" && !Array.isArray(j)) {
        const o = j as Record<string, unknown>;
        if (Object.values(FIELD_ALIASES).some((aliases) => aliases.some((key) => Object.prototype.hasOwnProperty.call(o, key)))) return "ontology";
      }
      if (Array.isArray(j) && ontologyArrayName(name) && (j.length === 0 || j.every((row) => row && typeof row === "object" && !Array.isArray(row)))) return "ontology";
      if (Array.isArray(j) && j.length && j[0] && typeof j[0] === "object") {
        const first = j[0] as Record<string, unknown>;
        // action-signal fields, OR a record-shaped object (name/id) — a bare actions export like
        // [{name:"createJob"}] with a generic filename must still become a domain (matches
        // buildOntologyBundle's "unmatched array → actions" fallback), OR a keyword filename.
        if (first.trigger || first.triggered_event || first.actor || first.target_objects || first.name || first.id || ontologyArrayName(name)) return "ontology";
      }
    } catch {
      /* 不是 JSON → 工具/散文文档 */
    }
  }
  return "tooldoc";
}

/**
 * 把多份已读成文本的本体文件合并成一个 bundle。
 * - 对象文件：按后端别名读取数组或 {payload: []}；links/workflow 仅在来源提供时加入。
 * - 数组文件：按文件名路由到 links/workflow/events/rules/dataObjects，否则 actions。
 * - 非 JSON：记进 skipped，不参与合并。
 */
export function buildOntologyBundle(files: OntologyFile[]): OntologyBundleResult {
  const bundle: OntologyBundle = { actions: [], events: [], rules: [], dataObjects: [] };
  const put = (k: keyof OntologyBundle, v: unknown) => {
    const rows = Array.isArray(v)
      ? v
      : v && typeof v === "object" && Array.isArray((v as Record<string, unknown>).payload)
        ? (v as { payload: unknown[] }).payload
        : undefined;
    if (rows) (bundle[k] ??= []).push(...rows);
  };
  const skipped: string[] = [];
  const used: string[] = [];
  for (const f of files) {
    let json: unknown;
    try {
      json = JSON.parse(f.text);
    } catch {
      skipped.push(f.name);
      continue;
    }
    used.push(f.name);
    if (Array.isArray(json)) {
      put(arrayBucket(f.name), json);
    } else if (json && typeof json === "object") {
      const o = json as Record<string, unknown>;
      for (const [key, aliases] of Object.entries(FIELD_ALIASES)) {
        const supplied = aliases.find((alias) => o[alias] !== undefined);
        if (supplied) put(key as keyof OntologyBundle, o[supplied]);
      }
    }
  }
  return {
    bundle,
    skipped,
    used,
    actionCount: bundle.actions.length,
    eventCount: bundle.events.length,
    ruleCount: bundle.rules.length,
    objectCount: bundle.dataObjects.length,
  };
}
