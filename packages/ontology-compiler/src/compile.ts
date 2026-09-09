/**
 * compile(model, overlay) — the normative ontology→manifest mapping
 * (docs/redesign-ontology-execution-2026-08-19.md §G1, items 1–4).
 *
 *   1. One AgentSpec per ontology Action. trigger = ontology trigger minus
 *      MANUAL, with a synthetic MANUAL_<ACTION_ID> fallback so every agent
 *      stays event-invocable.
 *   2. prompt-kind → one `logic` step (composed action_prompt + agent
 *      ontology_instructions cards + `metaerp.invoke` tool_use entries per
 *      declared query external_call). Overlay emissions compile to
 *      condition/emit/decision steps so events fire only on real hits.
 *      external-kind → rule-gate steps (`rule-gate:<RULE_ID>`) for mandatory
 *      preconditions, manual steps from ontology manual action_steps, then
 *      the `metaerp.invoke` write step (result_key = action id).
 *   3. events/objects/rules/actions files are pass-through projections.
 *   4. Deterministic: stable ordering everywhere, no timestamps added.
 *
 * Rule-gate block semantics note: a violated gate deterministically SKIPS the
 * manual/write/emit steps via `depends_on` gating and a final
 * `suppress-implicit-emit` decision step suppresses the legacy
 * `triggered_event[0]` fallback, so a blocked run performs no ERP write and
 * emits no downstream event. A natural-language rule compiles to a strict
 * JSON-verdict logic judge with `on_error: "terminal"`.
 */

import type {
  AgentInputPort,
  CompiledAgent,
  CompiledErrorPolicyRule,
  CompiledStep,
  CompiledToolUseEntry,
  CompileResult,
  CompilerOverlay,
  ErpOperation,
  OverlayEmission,
  OverlayExtraTool,
  OverlayToolArgumentSource,
  StudioAction,
  StudioDomainModel,
  StudioEvent,
  StudioEventDataField,
  StudioRule,
} from "./types.ts";

const TOOL_NAME = "metaerp.invoke";
/** The reviewed policy from packages/tools registry REGISTRATIONS for
 * metaerp.invoke (statement-catalog idiom). Generated agents must declare it
 * and the runtime enforces exact equality with the registry. */
const METAERP_REVIEWED_POLICY = {
  operation: "read_write",
  effect_scope: "external",
  sandbox_policy: "requires_attempt_grant",
} as const;
/**
 * Default env var naming the metaERP origin. A tenant can override it, because
 * one mock ERP instance serves ONE package's data plane: `_index.json` decides
 * which query ops exist and which table backs each. Two scenarios that declare
 * different objects — and, worse, different rows for the SAME config table —
 * cannot share an instance without one corrupting the other's reads.
 */
const DEFAULT_BASE_URL_ENV = "METAERP_BASE_URL";

/**
 * Declarative failure ladder on every ERP write step. Facts come from the
 * runtime's `actionErrorFacts` (metaerp.invoke prefixes transport failures
 * with `integration_unreachable:` and puts `HTTP <status>` in the message):
 *   - unreachable ERP (VPN/proxy/base URL) → retry within the Inngest budget,
 *     then the run fails with the unreachable message;
 *   - HTTP 4xx → terminal at once: the payload is wrong, retrying the same
 *     bytes cannot succeed (2026-09-07: a createPbp 400 was retried 4× over
 *     six minutes while the canvas showed "running");
 *   - everything else (5xx, catalog gaps, timeouts) → retry.
 */
const METAERP_WRITE_ERROR_POLICY: readonly CompiledErrorPolicyRule[] = [
  { when: "kind == integration_unreachable || code == integration_unreachable", do: "retry" },
  { when: "status >= 400 && status < 500", do: "terminal" },
  { default: "retry" },
];

const CONTROL_FAIL_TOOL = "control.fail";
/** The reviewed policy from packages/tools registry REGISTRATIONS for
 * control.fail (pure, no I/O). Byte-equality with the registry is enforced
 * by the runtime like the two policies above. */
const CONTROL_FAIL_REVIEWED_POLICY = {
  operation: "compute",
  effect_scope: "none",
  sandbox_policy: "pure",
} as const;
const BLOCKING_CODE_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;
/** Paths a blocking outcome may read its reason from — the analysis result
 * only, never the inbound event (the reason must be the model's own report). */
const BLOCKING_MESSAGE_PATH = /^(lastResult|results\.[A-Za-z_][A-Za-z0-9_]*)(\.[A-Za-z_][A-Za-z0-9_]*)+$/;

const ONTOLOGY_QUERY_TOOL = "ontology.query";
/** The reviewed policy from packages/tools registry REGISTRATIONS for
 * ontology.query (read-only, tenant-scoped Neo4j graph retrieval). Same
 * byte-equality contract as METAERP_REVIEWED_POLICY: the runtime rejects any
 * generated-agent declaration that differs from the registry catalog. */
const ONTOLOGY_QUERY_REVIEWED_POLICY = {
  operation: "read",
  effect_scope: "external",
  sandbox_policy: "live_external",
} as const;

/** planning.backwardSchedule — pure date arithmetic, no I/O. Same byte-equality
 * contract as the two policies above: the runtime rejects any manifest whose
 * declared policy differs from the reviewed global-registry entry. */
const BACKWARD_SCHEDULE_TOOL = "planning.backwardSchedule";
const BACKWARD_SCHEDULE_REVIEWED_POLICY = {
  operation: "compute",
  effect_scope: "none",
  sandbox_policy: "pure",
} as const;

const RECORDS_PROJECT_TOOL = "records.project";

function recordsProjectToolUseEntry(grant: OverlayExtraTool): CompiledToolUseEntry {
  return {
    name: RECORDS_PROJECT_TOOL,
    description:
      grant.description ??
      "\u4ece\u4e0a\u4e00\u4e2a\u5de5\u5177\u7684\u8fd4\u56de\u503c\u91cc\u6309\u5b57\u6bb5\u6620\u5c04\u9010\u884c\u539f\u6837\u53d6\u503c\uff08\u7eaf\u8ba1\u7b97\uff09\u3002\u6807\u8bc6\u7b26\u3001\u7269\u6599\u53f7\u3001\u5355\u636e\u53f7\u8fd9\u7c7b\u503c\u4e00\u5f8b\u7528\u5b83\u53d6\uff0c\u4e0d\u8981\u81ea\u5df1\u62c4\u3002",
    side_effect: "read",
    execution_policy: BACKWARD_SCHEDULE_REVIEWED_POLICY,
    input_schema: {
      type: "object",
      required: ["fields"],
      properties: {
        source: {
          type: "string",
          description:
            "\u53ef\u9009\uff1a\u6307\u5411\u884c\u6570\u7ec4\u7684\u8def\u5f84\uff0c\u5982 records[0].prLineList\u3002\u7701\u7565\u5219\u4e0a\u4e00\u7ed3\u679c\u672c\u8eab\u5373\u6570\u7ec4\u3002",
        },
        fields: {
          type: "object",
          description:
            "{\u8f93\u51fa\u5b57\u6bb5\u540d: \u6e90\u5b57\u6bb5\u540d}\uff1b\u503c\u4ee5 \"$root.\" \u5f00\u5934\u5219\u4ece\u7ed3\u679c\u6839\u90e8\u53d6\u4e00\u4e2a\u8868\u5934\u503c\u76d6\u5230\u6bcf\u4e00\u884c\u3002",
        },
      },
    },
    config: narrowOverlayToolConfig(grant.config),
  };
}

function backwardScheduleToolUseEntry(grant: OverlayExtraTool): CompiledToolUseEntry {
  return {
    name: BACKWARD_SCHEDULE_TOOL,
    description:
      grant.description ??
      "\u6309\u9700\u6c42\u5230\u8d27\u65e5\u671f\u4e0e\u5404\u8282\u70b9\u6807\u51c6\u5468\u671f\u5012\u6392\u51fa\u6bcf\u4e2a\u8282\u70b9\u7684\u8ba1\u5212\u5b8c\u6210\u65f6\u95f4\uff08\u7eaf\u8ba1\u7b97\uff0c\u4e0d\u8bbf\u95ee\u5916\u90e8\u7cfb\u7edf\uff09\u3002",
    side_effect: "read",
    execution_policy: BACKWARD_SCHEDULE_REVIEWED_POLICY,
    input_schema: {
      type: "object",
      required: ["required_arrival_date", "stages"],
      properties: {
        required_arrival_date: {
          type: "string",
          description: "\u9700\u6c42\u5230\u8d27\u65e5\u671f\uff0cYYYY-MM-DD\u3002\u5012\u6392\u57fa\u51c6\u3002",
        },
        business_type: {
          type: "string",
          description:
            "\u53ef\u9009\uff1a\u6309\u4e1a\u52a1\u7c7b\u578b\u7b5b\u9009 stages\uff1b\u7b5b\u4e0d\u5230\u4f1a\u62a5\u9519\u5e76\u5217\u51fa\u914d\u7f6e\u91cc\u5b9e\u9645\u5b58\u5728\u7684\u4e1a\u52a1\u7c7b\u578b\u3002",
        },
        reference_date: {
          type: "string",
          description:
            "\u53ef\u9009\uff1a\u53c2\u8003\u65e5\uff08\u4f20 scan_date\uff0cYYYY-MM-DD\uff09\u3002\u7ed9\u4e86\u5c31\u8fd4\u56de slack_days \u4e0e time_conflict\uff0c\u5de5\u671f\u591f\u4e0d\u591f\u7531\u5de5\u5177\u7b97\u5b8c\u3002",
        },
        stages: {
          type: "array",
          description:
            "\u5468\u671f\u914d\u7f6e\u884c\u3002\u628a queryStageCycleConfig \u8fd4\u56de\u7684\u539f\u59cb\u884c\u6574\u6bb5\u4f20\u8fdb\u6765\uff08\u5e26 BUSINESS_TYPE\uff09\uff0c\u4e0d\u8981\u81ea\u5df1\u8a8a\u5199\u3002",
          items: {
            type: "object",
            properties: {
              stage_node: { type: "string", description: "\u8282\u70b9\u540d\uff08\u6216 STAGE_NODE\uff09" },
              stage_sequence: {
                type: "number",
                description: "\u8282\u70b9\u5e8f\u53f7\uff0c\u4ece 1 \u5f00\u59cb\u8fde\u7eed\uff08\u6216 STAGE_SEQUENCE\uff09",
              },
              standard_cycle_days: {
                type: "number",
                description: "\u6807\u51c6\u5468\u671f\u5929\u6570\uff08\u6216 STANDARD_CYCLE_DAYS\uff09",
              },
            },
          },
        },
      },
    },
    config: narrowOverlayToolConfig(grant.config),
  };
}
/** Extra judge-prompt line appended when an overlay grants ontology.query to
 * rule-gate judges (grant_to_judges) — evidence-fetch instruction, keeping
 * the fail-closed floor intact. */
const JUDGE_ONTOLOGY_QUERY_LINE =
  "工具说明：你可调用只读图谱工具 ontology.query 从本体图谱检索核验证据（如 实控人/股权关联 关系）；当事件负载缺少判定所需证据时，必须先查询图谱再裁决；若查询后仍无法取得证据，维持 fail-closed，判 violation。";

/**
 * Input ports for an agent, taken from the payload its trigger events declare.
 *
 * Without these the manifest carries no `inputs`, so the run console falls back
 * to a generic `payload`/`prompt` pair — and the operator gets a default event
 * body with none of the fields the agent's own prompt calls 必填. On the
 * procurement scan that meant no `scan_date`, which every downstream date
 * calculation is anchored on. The Events publish dialog already renders these
 * fields; this makes the two surfaces ask for the same thing.
 *
 * Union across triggers, first declaration wins: an agent listening to several
 * events must accept whatever any of them carries.
 */
function inputPortsFor(ctx: CompileContext, trigger: string[]): AgentInputPort[] {
  const ports = new Map<string, AgentInputPort>();
  for (const eventName of trigger) {
    const event = ctx.model.events.find((candidate) => candidate.name === eventName);
    const examples = ctx.overlay.input_examples?.[eventName];
    for (const field of event?.payload?.event_data ?? []) {
      const id = field.name?.trim();
      if (!id || ports.has(id)) continue;
      const hasExample =
        examples !== undefined &&
        Object.prototype.hasOwnProperty.call(examples, id);
      ports.set(id, {
        id,
        label: id,
        ...(field.description ? { description: field.description } : {}),
        kind: "value",
        required: field.required === true,
        schema: ontologyFieldSchema(field),
        ...(hasExample ? { example: examples[id] } : {}),
      });
    }
  }
  return [...ports.values()];
}

/**
 * An overlay example that names an event or a field the ontology does not have
 * is a typo, and a silently ignored one is worse than none: 「加载示例」 keeps
 * offering the generated placeholder while the overlay looks correct.
 */
function validateInputExamples(ctx: CompileContext): void {
  for (const [eventName, fields] of Object.entries(ctx.overlay.input_examples ?? {})) {
    const event = ctx.model.events.find((candidate) => candidate.name === eventName);
    if (!event) {
      fail(`overlay input_examples names unknown event '${eventName}'`);
      continue;
    }
    const known = new Set(
      (event.payload?.event_data ?? [])
        .map((field) => field.name?.trim())
        .filter((name): name is string => Boolean(name)),
    );
    for (const field of Object.keys(fields)) {
      if (!known.has(field)) {
        fail(
          `overlay input_examples: event '${eventName}' has no field '${field}'`,
        );
      }
    }
  }
}

/**
 * Ontology scalar names → a JSON Schema the run console can actually generate a
 * value from.
 *
 * A bare `{type:"string"}` is why every field defaulted to the literal
 * placeholder 示例值: the console already knows how to render a date from
 * `format` and a choice from `enum`/`examples`, it was just never given either.
 * Carrying the ontology's own type through is what makes the default payload
 * runnable instead of decorative.
 */
function ontologyFieldSchema(field: StudioEventDataField): Record<string, unknown> {
  const type = (field.type ?? "").toLowerCase();
  if (type === "integer") return { type: "integer" };
  if (type === "number" || type === "decimal" || type === "float") {
    return { type: "number" };
  }
  if (type === "boolean") return { type: "boolean" };
  if (type === "date") return { type: "string", format: "date" };
  if (type === "datetime" || type === "timestamp") {
    return { type: "string", format: "date-time" };
  }
  const choices = choicesFromDescription(field.description);
  return choices ? { type: "string", examples: choices } : { type: "string" };
}

/** A description longer than this is prose, not a list of choices. */
const CHOICE_TEXT_MAX = 14;

/**
 * Pull the options out of a description that enumerates them, e.g.
 * 「变更单据类型：采购申请/采购包/询价单/…」or「扫描范围：全集团或指定单位」.
 *
 * Emitted as `examples`, deliberately NOT as `enum`: the console picks the
 * first one as the default value either way, but `enum` would also CONSTRAIN
 * the field, and a description is documentation — it is not authority to reject
 * a value the ontology never actually restricted.
 */
function choicesFromDescription(description: string | undefined): string[] | null {
  const body = (description ?? "").split(/[：:]/).slice(1).join(":");
  if (!body) return null;
  const cleaned = body.replace(/[。.\s]+$/, "").trim();
  const parts = cleaned.includes("/")
    ? cleaned.split("/")
    : cleaned.includes("或")
      ? cleaned.split("或")
      : [];
  const choices = parts.map((part) => part.trim()).filter(Boolean);
  if (choices.length < 2) return null;
  // One long member means the split cut through a sentence, not a list.
  if (choices.some((choice) => choice.length > CHOICE_TEXT_MAX)) return null;
  return choices;
}

function fail(message: string): never {
  throw new Error(`[ontology-compiler] ${message}`);
}

function opIdFromEndpoint(endpoint: string): string {
  const basename = endpoint.split("/").filter(Boolean).pop() ?? "";
  if (!basename) fail(`cannot derive an operation id from endpoint "${endpoint}"`);
  return basename;
}

function syntheticManualTrigger(actionId: string): string {
  return `MANUAL_${actionId.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}`;
}

function identifierKey(raw: string): string {
  return raw.replace(/[^A-Za-z0-9_$-]+/g, "-");
}

// ── ontology_instructions cards ───────────────────────────────────────────────

function buildOntologyInstructions(model: StudioDomainModel, action: StudioAction): string | undefined {
  const objectsById = new Map(model.objects.map((object) => [object.id, object]));
  const rulesById = new Map(model.rules.map((rule) => [rule.id, rule]));

  const objectCards: string[] = [];
  for (const objectId of action.target_objects ?? []) {
    const object = objectsById.get(objectId);
    if (!object) {
      objectCards.push(`- ${objectId}`);
      continue;
    }
    // A computed property has no ERP column behind it, so an agent that treats
    // the list as "fields I can query" will either get nothing back or invent a
    // value — and rule gates are evaluated against exactly these names. Mark
    // them, with their derivation, so the agent knows to compute instead.
    const props = (object.properties ?? [])
      .map((property) => {
        if (property.is_computed !== true) return property.name;
        const expression =
          typeof property.computed_expression === "string" &&
          property.computed_expression.trim()
            ? `＝${property.computed_expression.trim()}`
            : "";
        return `${property.name}（推导${expression}）`;
      })
      .join(", ");
    objectCards.push(`- ${object.name ?? object.id}：决策属性 ${props || "（无声明属性）"}`);
  }

  const ruleCards: string[] = [];
  for (const binding of action.rule_bindings ?? []) {
    const rule = rulesById.get(binding.rule_id);
    const expression = rule?.machine_expression?.source ?? rule?.description ?? "";
    ruleCards.push(
      `- ${binding.rule_id} ${rule?.name ?? ""}（${binding.phase}·${binding.enforcement}）：${expression}`.trim(),
    );
  }

  const sections: string[] = [];
  if (objectCards.length) sections.push(`【目标对象】\n${objectCards.join("\n")}`);
  if (ruleCards.length) sections.push(`【绑定规则】\n${ruleCards.join("\n")}`);
  return sections.length ? sections.join("\n\n") : undefined;
}

// ── prompt composition ────────────────────────────────────────────────────────

function buildPromptOutputContract(
  action: StudioAction,
  eventsByName: Map<string, StudioEvent>,
  overlay: CompilerOverlay,
): string {
  const lines: string[] = [];
  const seen = new Set<string>();
  for (const eventName of action.triggered_event) {
    const event = eventsByName.get(eventName);
    for (const field of event?.payload?.event_data ?? []) {
      if (seen.has(field.name)) continue;
      seen.add(field.name);
      lines.push(`- ${field.name}: ${field.description ?? ""}（事件 ${eventName} 的 payload 段）`);
    }
  }
  const extraFields = overlay.output_contracts?.[action.id]?.fields ?? {};
  for (const [name, description] of Object.entries(extraFields)) {
    if (seen.has(name)) continue;
    seen.add(name);
    lines.push(`- ${name}: ${description}`);
  }
  return lines.join("\n");
}

function buildAnalysisPrompt(
  action: StudioAction,
  eventsByName: Map<string, StudioEvent>,
  overlay: CompilerOverlay,
): string {
  const steps = (action.action_steps ?? [])
    .filter((step) => step.object_type === "logic")
    .map((step, index) => `${index + 1}. ${step.name}：${step.description ?? ""}`);
  const parts: string[] = [action.description ?? action.name];
  if (steps.length) parts.push(`执行步骤：\n${steps.join("\n")}`);
  const contract = buildPromptOutputContract(action, eventsByName, overlay);
  const contractFields = overlay.output_contracts?.[action.id]?.fields;
  const keyList = contractFields ? Object.keys(contractFields) : [];
  const skeleton = keyList.length
    ? `{\n${keyList.map((key) => `  ${JSON.stringify(key)}: <见字段说明>`).join(",\n")}\n}`
    : "";
  parts.push(
    [
      `输出契约（硬性）：仅输出一个 JSON 对象，不得输出任何其他文本。`,
      keyList.length
        ? `顶层键必须且只能是：${keyList.map((key) => `\`${key}\``).join("、")} —— 不得增删、不得改名、不得另立自创结构（如 decision/result/summary 等一律不允许作为顶层键）。`
        : "",
      keyList.length ? `骨架：\n${skeleton}` : "",
      `字段说明：\n${contract || "- result: 分析结论"}`,
      `下游步骤按上述键名逐字段取数，键名不符将导致整条业务链路中断（fail-closed）。`,
    ]
      .filter(Boolean)
      .join("\n"),
  );
  return parts.join("\n\n");
}

function buildJudgePrompt(ruleId: string, rule: StudioRule | undefined, judgeContext: string | undefined): string {
  const expression = rule?.machine_expression?.source ?? rule?.description ?? "";
  const parts: string[] = [
    `你是规则闸口「rule-gate:${ruleId}」的审查器，对本次触发事件负载执行强制前置校验。`,
    `规则 ${ruleId} · ${rule?.name ?? ""}\n义务文：${expression}\n背景：${rule?.description ?? ""}`.trim(),
  ];
  if (judgeContext) parts.push(`取数说明：${judgeContext}`);
  parts.push(
    `仅输出一个 JSON 对象（不得输出任何其他文本）：\n` +
      `{"ruleId":"${ruleId}","status":"pass","reason":"<判定依据>"}\n` +
      `或 {"ruleId":"${ruleId}","status":"violation","reason":"<判定依据>"}\n` +
      `status 只能取小写的 pass 或 violation（严格小写，不接受 PASS/Pass 等变体）；证据不足时判 violation（fail-closed）。`,
  );
  return parts.join("\n\n");
}

// ── shared step builders ──────────────────────────────────────────────────────

function genericApproveFormSchema(title: string): Record<string, unknown> {
  return {
    type: "object",
    title,
    properties: {
      decision: { type: "string", enum: ["approve", "reject"], title: "审批决定" },
      comment: { type: "string", title: "审批意见" },
    },
    required: ["decision"],
  };
}

function suppressImplicitEmitStep(order: string): CompiledStep {
  return {
    order,
    name: "suppress-implicit-emit",
    description: "规则拦截或条件未命中时抑制隐式 triggered_event[0] 发射（显式 emit 已记录则本步为空操作）。",
    type: "decision",
    result_key: "suppress-implicit-emit",
    decision_table: {
      id: "suppress-implicit-emit",
      description: "无显式发射记录时写入空 _emits，阻断隐式首事件回退。",
      rows: [
        {
          id: "explicit-emit-recorded",
          all: [{ path: "lastResult._emits", op: "exists" }],
          outcome: "explicit",
        },
      ],
      missing: { outcome: "suppressed", payload: { _emits: [] } },
      default: { outcome: "suppressed", payload: { _emits: [] } },
    },
  };
}

/**
 * 每个 ERP 操作的真实请求字段，由
 * scripts/extract-metaerp-operation-params.mjs 从 swagger 生成、经 CompileOptions 传入。
 *
 * 模型知道操作叫什么，却不知道它收什么——第一次对 v15 真跑，13 次调用错了 12 次，
 * 全在猜字段名。把契约写进工具描述，猜的环节就没有了。没传时静默降级为
 * 「只列操作名」，也就是加这套之前的行为。
 */
export interface MetaerpOperationParams {
  schema: string;
  bodyIsArray?: boolean;
  fields: string[];
}

/** 每个操作最多列几个入参。预算不够时会从这里逐级往下压。 */
const FIELD_BUDGET_STEPS = [8, 6, 4, 3, 2] as const;

/**
 * 工具描述的硬上限。
 *
 * 清单 schema（`normalizeWorkflowManifest`）把 tool_use[].description 限死在 2000
 * 字符。合并查询工具要把每个操作的名称、说明和入参串起来——场景一的取数 agent 有 13 个
 * 查询操作，加上入参轻松越界，后果很隐蔽：**运行照常、工作流页面打不开**
 * （internal_error: stored workflow manifest is invalid），因为运行时的 AgentSchema
 * 不查这条长度，页面用的校验器查。
 *
 * 越界时优先**逐级减少每个操作列出的字段数**，而不是直接截断字符串：截断会把靠后的
 * 操作的入参整段切掉，模型对那几个操作又退回到猜——而猜字段名正是这套入参清单要解决的
 * 问题。字段数压到最低仍不够时才截断兜底。
 */
const MAX_TOOL_DESCRIPTION = 2_000;

function clampToolDescription(text: string): string {
  return text.length <= MAX_TOOL_DESCRIPTION
    ? text
    : `${text.slice(0, MAX_TOOL_DESCRIPTION - 1)}…`;
}

function paramHint(
  params: Record<string, MetaerpOperationParams> | undefined,
  operationId: string,
  maxFields: number,
): string {
  const entry = params?.[operationId];
  if (!entry?.fields.length || maxFields <= 0) return "";
  const shown = entry.fields.slice(0, maxFields).join("、");
  const more = entry.fields.length > maxFields ? " 等" : "";
  const array = entry.bodyIsArray ? "，请求体是数组" : "";
  return `｜入参(${entry.schema}${array}): ${shown}${more}`;
}

function toolUseEntry(
  operationId: string,
  kind: "query" | "write",
  catalogPath: string,
  baseUrlEnv: string,
  description?: string,
  params?: Record<string, MetaerpOperationParams>,
): CompiledToolUseEntry {
  const hint = paramHint(params, operationId, FIELD_BUDGET_STEPS[0]!);
  const described = clampToolDescription(
    description ? `${description}${hint}` : hint.replace(/^｜/, ""),
  );
  return {
    name: TOOL_NAME,
    ...(described ? { description: described } : {}),
    side_effect: kind === "query" ? "read" : "write",
    // Must equal the reviewed global-registry policy for metaerp.invoke
    // byte-for-byte: generated agents are required to declare it, and the
    // runtime rejects any declaration that differs from the catalog.
    execution_policy: METAERP_REVIEWED_POLICY,
    config: {
      operation: operationId,
      base_url_env: baseUrlEnv,
      catalog_path: catalogPath,
    },
  };
}

function mergedQueryToolUseEntry(
  operations: Array<{ id: string; description?: string }>,
  catalogPath: string,
  baseUrlEnv: string,
  params?: Record<string, MetaerpOperationParams>,
): CompiledToolUseEntry {
  const compose = (maxFields: number): string => {
    const lines = operations
      .map((op) => {
        const head = op.description ? `${op.id}（${op.description}）` : op.id;
        return `${head}${paramHint(params, op.id, maxFields)}`;
      })
      .join("\n- ");
    return (
      `实时查询 Meta ERP。payload 是该操作的请求体，字段名照抄下面的入参清单` +
      `（metaERP 用小驼峰），不要自造字段名，也不要用下划线写法。可用操作：\n- ${lines}`
    );
  };
  // 先按最宽的预算写，超了就逐级压字段数——保证每个操作都还留着入参。
  let text = compose(FIELD_BUDGET_STEPS[0]!);
  for (const budget of FIELD_BUDGET_STEPS.slice(1)) {
    if (text.length <= MAX_TOOL_DESCRIPTION) break;
    text = compose(budget);
  }
  return {
    name: TOOL_NAME,
    description: clampToolDescription(text),
    side_effect: "read",
    execution_policy: METAERP_REVIEWED_POLICY,
    input_schema: {
      type: "object",
      additionalProperties: false,
      required: ["operation"],
      properties: {
        operation: {
          type: "string",
          enum: operations.map((op) => op.id),
          description: "要调用的 Meta ERP 查询操作",
        },
        payload: {
          type: "object",
          description:
            "该操作的请求体。字段取自工具描述里对应操作的入参清单；" +
            "管理单元与库存组织由平台自动补上，不要传。",
        },
      },
    },
    config: { base_url_env: baseUrlEnv, catalog_path: catalogPath },
  };
}

// ── overlay extra tools (ontology.query) ──────────────────────────────────────

/** JSON Schema for ontology.query's real arg surface
 * (packages/tools/src/ontology/query.ts). Built fresh per entry so agents
 * never alias one mutable schema object. */
function ontologyQueryInputSchema(): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    required: ["operation"],
    properties: {
      operation: {
        type: "string",
        enum: ["search_nodes", "get_node", "neighbors", "find_paths", "schema"],
        description:
          "图谱检索操作：search_nodes 关键词搜索节点 / get_node 取单个节点 / neighbors 查节点邻居与关系 / find_paths 找两节点间路径 / schema 查看图谱结构",
      },
      query: { type: "string", description: "search_nodes 必填：检索关键词" },
      id: { type: "string", description: "get_node、neighbors 必填：节点 id" },
      start_id: { type: "string", description: "find_paths 必填：起点节点 id" },
      end_id: { type: "string", description: "find_paths 必填：终点节点 id" },
      max_depth: {
        type: "number",
        description: "find_paths 可选：最大路径深度（1-4，默认 3）",
      },
      labels: {
        type: "array",
        items: { type: "string" },
        description: "search_nodes 可选：限定节点标签",
      },
      properties: {
        type: "array",
        items: { type: "string" },
        description: "search_nodes 可选：限定检索的属性名",
      },
      // neighbors filters on its own two arguments. Omitting them while the
      // schema is closed (additionalProperties:false) left the model no way to
      // narrow a neighbour scan at all: it would pass `labels`, which the
      // neighbors branch never reads, get every edge back, and retry.
      relationship_types: {
        type: "array",
        items: { type: "string" },
        description:
          "neighbors 可选：只返回这些关系类型（如 CONTROLLED_BY、EQUIVALENT_TO）",
      },
      neighbor_labels: {
        type: "array",
        items: { type: "string" },
        description:
          "neighbors 可选：只返回这些标签的邻居节点（如 UltimateController）",
      },
      limit: { type: "number", description: "可选：返回条数上限（1-100，默认 20）" },
    },
  };
}

function ontologyQueryToolUseEntry(grant: OverlayExtraTool): CompiledToolUseEntry {
  return {
    name: ONTOLOGY_QUERY_TOOL,
    description:
      grant.description ??
      "只读查询租户本体图谱（Neo4j）：检索节点、读取单节点、查看邻居关系、寻找两节点间路径或查看图谱结构。",
    side_effect: "read",
    // Must equal the reviewed global-registry policy for ontology.query
    // byte-for-byte (same contract as metaerp.invoke above).
    execution_policy: ONTOLOGY_QUERY_REVIEWED_POLICY,
    input_schema: ontologyQueryInputSchema(),
    // Config is narrowed to keys the tool treats as agent-supplied hints. The
    // tool server-validates tenant_property / id_property / database and pins
    // base_url, but it reads the Neo4j credentials from whatever env names
    // `username_env` / `password_env` name — so an overlay that could set those
    // would choose which server secret is sent as a Basic-auth password. An
    // overlay is tenant-authored config, not operator config: it may not pick
    // credential sources or endpoints.
    config: narrowOverlayToolConfig(grant.config),
  };
}

/** Keys an overlay may set on a granted tool's config. Everything else —
 * notably `base_url`, `username_env`, `password_env` — is operator-owned and
 * comes from the server environment. */
const OVERLAY_TOOL_CONFIG_KEYS = new Set([
  "tenant_property",
  "id_property",
  "database",
  "search_properties",
  "timeout_ms",
  "max_execution_time_ms",
]);

function narrowOverlayToolConfig(
  config: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const source = config ?? {};
  const rejected = Object.keys(source)
    .filter((key) => !OVERLAY_TOOL_CONFIG_KEYS.has(key))
    .sort();
  if (rejected.length > 0) {
    throw new Error(
      `overlay extra_tools config may not set operator-owned key(s) ${rejected.join(", ")}; allowed: ${[...OVERLAY_TOOL_CONFIG_KEYS].sort().join(", ")}`,
    );
  }
  // Rebuilt in a stable key order so the compiled output stays byte-stable
  // regardless of how the overlay JSON happened to order its keys.
  const narrowed: Record<string, unknown> = {};
  for (const key of [...OVERLAY_TOOL_CONFIG_KEYS].sort()) {
    if (Object.hasOwn(source, key)) narrowed[key] = source[key];
  }
  return narrowed;
}

/** Tools an overlay may grant, each mapped to the builder that emits its
 * reviewed execution_policy. A name absent from this table is rejected: an
 * overlay is tenant-authored config and must never be able to ship an
 * unreviewed policy. */
const EXTRA_TOOL_BUILDERS: Record<
  string,
  ((grant: OverlayExtraTool) => CompiledToolUseEntry) | undefined
> = {
  [ONTOLOGY_QUERY_TOOL]: ontologyQueryToolUseEntry,
  [BACKWARD_SCHEDULE_TOOL]: backwardScheduleToolUseEntry,
  [RECORDS_PROJECT_TOOL]: recordsProjectToolUseEntry,
};

/** Apply overlay `extra_tools` grants to a compiled agent in place: append
 * the tool_use entry (after metaerp.invoke if present), grant the analyze
 * logic step, and — with grant_to_judges — every `rule-gate:*` LLM judge,
 * whose prompt gains the graph-evidence instruction line. Only tool names
 * with a compiler-known reviewed policy are accepted, so an overlay can
 * never ship an unreviewed execution_policy. */
function applyExtraTools(
  ctx: CompileContext,
  action: StudioAction,
  compiled: { steps: CompiledStep[]; toolUse: CompiledToolUseEntry[] },
): void {
  const grants = ctx.overlay.extra_tools?.[action.id] ?? [];
  for (const grant of grants) {
    const buildEntry = EXTRA_TOOL_BUILDERS[grant.name];
    if (!buildEntry) {
      fail(
        `overlay extra_tools for ${action.id} grants unsupported tool "${grant.name}" — only ${Object.keys(EXTRA_TOOL_BUILDERS).join(", ")} have a compiler-known reviewed execution policy`,
      );
    }
    if (compiled.toolUse.some((entry) => entry.name === grant.name)) {
      fail(`overlay extra_tools for ${action.id} grants ${grant.name} more than once`);
    }
    // One entry per tool NAME per agent: the runtime lifts config by name
    // (first match wins) and providers reject duplicate tool names.
    compiled.toolUse.push(buildEntry(grant));
    for (const step of compiled.steps) {
      if (step.type !== "logic") continue;
      const isJudge = step.name.startsWith("rule-gate:");
      if (isJudge && grant.grant_to_judges !== true) continue;
      const allowed = step.allowed_tools ?? (step.allowed_tools = []);
      if (!allowed.includes(grant.name)) allowed.push(grant.name);
      if (isJudge && step.action_prompt && grant.name === ONTOLOGY_QUERY_TOOL) {
        step.action_prompt = `${step.action_prompt}\n\n${JUDGE_ONTOLOGY_QUERY_LINE}`;
      }
    }
  }
}

// ── per-kind compilation ──────────────────────────────────────────────────────

interface CompileContext {
  model: StudioDomainModel;
  overlay: CompilerOverlay;
  eventsByName: Map<string, StudioEvent>;
  rulesById: Map<string, StudioRule>;
  catalogPath: string;
  /** Env var naming this tenant's metaERP origin. */
  baseUrlEnv: string;
  /** 每个 ERP 操作的真实请求字段（可选）。 */
  operationParams?: Record<string, MetaerpOperationParams>;
}

function overlayEmissionsFor(ctx: CompileContext, action: StudioAction): OverlayEmission[] {
  const emissions = ctx.overlay.emissions?.[action.id] ?? [];
  for (const emission of emissions) {
    if (!action.triggered_event.includes(emission.event)) {
      fail(
        `overlay emission for ${action.id} references event ${emission.event} not in its triggered_event`,
      );
    }
    if (!emission.when || typeof emission.when !== "string") {
      fail(`overlay emission for ${action.id}/${emission.event} requires a "when" expression or "always"`);
    }
  }
  return emissions;
}

/** Append overlay-driven emission steps. Returns true when at least one emit
 * is conditional (which requires the implicit-emit suppression floor). */
function appendEmissionSteps(
  steps: CompiledStep[],
  emissions: OverlayEmission[],
  actionId: string,
  nextOrder: () => string,
  /** Steps every emission must wait on — the ERP write for an external agent,
   * so a failed/skipped write emits nothing. Empty for prompt agents, whose
   * analyze step is already the immediately preceding step. */
  dependsOn: readonly string[] = [],
): boolean {
  const guard = dependsOn.length ? { depends_on: [...dependsOn] } : {};
  let conditional = false;
  for (const emission of emissions) {
    const payloadFrom = emission.payload_from ?? `results.${actionId}`;
    if (emission.when === "always") {
      steps.push({
        order: nextOrder(),
        name: `emit:${emission.event}`,
        description: `发射事件 ${emission.event}（无条件）。`,
        type: "emit",
        emit_event: emission.event,
        emit_payload_from: payloadFrom,
        result_key: identifierKey(`emit-${emission.event}`),
        ...guard,
      });
      continue;
    }
    conditional = true;
    const conditionKey = identifierKey(`emit-when-${emission.event}`);
    steps.push({
      order: nextOrder(),
      name: `emit-when:${emission.event}`,
      description: `事件 ${emission.event} 的发射条件。`,
      type: "condition",
      condition: emission.when,
      result_key: conditionKey,
      ...guard,
    });
    steps.push({
      order: nextOrder(),
      name: `emit:${emission.event}`,
      description: `条件命中时发射事件 ${emission.event}。`,
      type: "emit",
      emit_event: emission.event,
      emit_payload_from: payloadFrom,
      result_key: identifierKey(`emit-${emission.event}`),
      depends_on: [...dependsOn, conditionKey],
    });
  }
  return conditional;
}

function compilePromptAgent(ctx: CompileContext, action: StudioAction): {
  steps: CompiledStep[];
  toolUse: CompiledToolUseEntry[];
} {
  let ord = 0;
  const nextOrder = (): string => String(++ord);

  const queryCalls = (action.side_effects?.external_calls ?? []).filter((call) =>
    opIdFromEndpoint(call.endpoint).startsWith("query"),
  );
  // The runtime lifts tool config by NAME (agent.tool_use.find — first match
  // wins) and providers reject duplicate tool names in a roster, so an agent
  // carries at most ONE metaerp.invoke entry. A single query op keeps the
  // config pin; multiple ops merge into one unpinned entry whose input_schema
  // enum constrains which operations the model may call.
  const seenOps = new Set<string>();
  const queryOps: Array<{ id: string; description?: string }> = [];
  for (const call of queryCalls) {
    const operationId = opIdFromEndpoint(call.endpoint);
    if (seenOps.has(operationId)) continue;
    seenOps.add(operationId);
    queryOps.push({ id: operationId, description: call.description });
  }
  const toolUse: CompiledToolUseEntry[] =
    queryOps.length === 0
      ? []
      : queryOps.length === 1
        ? [
            toolUseEntry(
              queryOps[0]!.id,
              "query",
              ctx.catalogPath,
              ctx.baseUrlEnv,
              queryOps[0]!.description,
              ctx.operationParams,
            ),
          ]
        : [
            mergedQueryToolUseEntry(
              queryOps,
              ctx.catalogPath,
              ctx.baseUrlEnv,
              ctx.operationParams,
            ),
          ];

  const steps: CompiledStep[] = [
    {
      order: nextOrder(),
      name: "analyze",
      description: action.description ?? action.name,
      type: "logic",
      action_prompt: buildAnalysisPrompt(action, ctx.eventsByName, ctx.overlay),
      allowed_tools: toolUse.length ? [TOOL_NAME] : [],
      result_key: action.id,
    },
  ];

  // Blocking outcomes sit between the analysis and its emissions: when the
  // model reports one, control.fail ends the run before any success event
  // can leave, and the run's error carries the reported reason.
  if (appendBlockingOutcomeSteps(steps, ctx, action, nextOrder)) {
    toolUse.push(controlFailToolUseEntry());
  }

  const emissions = overlayEmissionsFor(ctx, action);
  const conditional = appendEmissionSteps(steps, emissions, action.id, nextOrder);
  if (conditional) steps.push(suppressImplicitEmitStep(nextOrder()));
  return { steps, toolUse };
}

function controlFailToolUseEntry(): CompiledToolUseEntry {
  return {
    name: CONTROL_FAIL_TOOL,
    description:
      "以声明的原因终止本次运行（分析结果报告了阻断性结论时由工作流自动调用，不由模型调用）。",
    side_effect: "read",
    execution_policy: CONTROL_FAIL_REVIEWED_POLICY,
    config: {},
  };
}

/** Compile the overlay's `blocking_outcomes` for one analysis action:
 * `condition` (over the analysis JSON) → `control.fail` tool step with
 * `on_error: "terminal"`. Returns true when any were emitted. */
function appendBlockingOutcomeSteps(
  steps: CompiledStep[],
  ctx: CompileContext,
  action: StudioAction,
  nextOrder: () => string,
): boolean {
  const outcomes = ctx.overlay.blocking_outcomes?.[action.id] ?? [];
  for (const outcome of outcomes) {
    const conditionKey = identifierKey(`blocked-when-${outcome.code}`);
    steps.push({
      order: nextOrder(),
      name: `blocked-when:${outcome.code}`,
      description: `分析结果是否报告了阻断性结论「${outcome.code}」。`,
      type: "condition",
      condition: outcome.when,
      result_key: conditionKey,
    });
    steps.push({
      order: nextOrder(),
      name: CONTROL_FAIL_TOOL,
      description: `阻断性结论「${outcome.code}」成立：以分析给出的原因终止运行，不发射任何事件。`,
      type: "tool",
      tool_arguments: {
        code: { const: outcome.code },
        message: outcome.message_from
          ? { from: outcome.message_from, required: false }
          : { const: outcome.message },
      },
      allowed_tools: [CONTROL_FAIL_TOOL],
      result_key: identifierKey(`blocked-${outcome.code}`),
      depends_on: [conditionKey],
      on_error: "terminal",
    });
  }
  return outcomes.length > 0;
}

function firstHumanRoleForAction(model: StudioDomainModel, actionId: string): string | undefined {
  for (const workflow of model.workflows) {
    const containsAction = (workflow.actions ?? []).some((step) => step.name === actionId);
    if (!containsAction) continue;
    const humanRole = (workflow.roles ?? []).find((role) => role.type === "Human" && role.role);
    if (humanRole?.role) return humanRole.role;
  }
  return undefined;
}

function normalizeToolArguments(
  actionId: string,
  template: Record<string, OverlayToolArgumentSource> | undefined,
): Record<string, OverlayToolArgumentSource> {
  const source = template ?? { payload: { from: "event.data" } };
  const entries = Object.entries(source);
  if (!entries.length) fail(`overlay tool_arguments for ${actionId} must not be empty`);
  const out: Record<string, OverlayToolArgumentSource> = {};
  for (const [argument, spec] of entries) {
    if (!spec || typeof spec !== "object") {
      fail(`overlay tool argument ${actionId}.${argument} must be {from} or {const}`);
    }
    const hasFrom = Object.prototype.hasOwnProperty.call(spec, "from");
    const hasConst = Object.prototype.hasOwnProperty.call(spec, "const");
    if (hasFrom === hasConst) {
      fail(`overlay tool argument ${actionId}.${argument} must choose exactly one of from/const`);
    }
    const withOverrides = (spec as { with?: unknown }).with;
    if (withOverrides !== undefined) {
      if (!hasFrom) {
        fail(`overlay tool argument ${actionId}.${argument} may only use \`with\` alongside \`from\``);
      }
      if (!withOverrides || typeof withOverrides !== "object" || Array.isArray(withOverrides)) {
        fail(`overlay tool argument ${actionId}.${argument}.with must be an object`);
      }
    }
    out[argument] = spec;
  }
  return out;
}

/** The overlay-declared compensation event for an action, validated against its
 * own `triggered_event` so a typo cannot silently disable the saga. */
function compensationEventFor(
  ctx: CompileContext,
  action: StudioAction,
): string | undefined {
  const event = ctx.overlay.compensation_events?.[action.id];
  if (!event) return undefined;
  if (!action.triggered_event.includes(event)) {
    fail(
      `overlay compensation_events for ${action.id} names ${event}, which is not in its triggered_event`,
    );
  }
  return event;
}

/** `triggered_event` minus the compensation event — the events a SUCCESSFUL run emits. */
function successEvents(ctx: CompileContext, action: StudioAction): string[] {
  const compensation = compensationEventFor(ctx, action);
  return compensation
    ? action.triggered_event.filter((event) => event !== compensation)
    : [...action.triggered_event];
}

function compileExternalAgent(ctx: CompileContext, action: StudioAction): {
  steps: CompiledStep[];
  toolUse: CompiledToolUseEntry[];
} {
  let ord = 0;
  const nextOrder = (): string => String(++ord);
  const steps: CompiledStep[] = [];
  const gateKeys: string[] = [];

  // (a0) submission gate: does this action apply to this event at all? Branches
  // that fan out from one event need this — they share a trigger and a rule, so
  // nothing else distinguishes them, and without it every branch runs.
  const submission = ctx.overlay.submission_gates?.[action.id];
  if (submission) {
    const submissionKey = identifierKey(`submission-gate-${action.id}`);
    steps.push({
      order: nextOrder(),
      name: `submission-gate:${action.id}`,
      description: `提交判据（确定性判定）：${action.submission_criteria ?? action.id}。判假即整个动作不执行。`,
      type: "condition",
      condition: submission,
      result_key: submissionKey,
    });
    gateKeys.push(submissionKey);
  }

  // (a) rule gates: mandatory precondition bindings, in binding order.
  const gateBindings = (action.rule_bindings ?? []).filter(
    (binding) => binding.phase === "precondition" && binding.enforcement === "mandatory",
  );
  for (const binding of gateBindings) {
    const ruleId = binding.rule_id;
    const rule = ctx.rulesById.get(ruleId);
    if (!rule) fail(`action ${action.id} binds unknown rule ${ruleId}`);
    const gateOverlay = ctx.overlay.rule_gates?.[ruleId];
    if (gateOverlay?.strategy === "receipt") {
      // 证据由本动作自己的写入产生——见 OverlayRuleGate.strategy 的说明。
      // 规则不是被放弃了，而是改由该写操作的 write_receipt 判据强制。
      continue;
    }
    const deterministic = gateOverlay?.strategy === "condition" && !!gateOverlay.condition;
    if (deterministic) {
      const gateKey = identifierKey(`rule-gate-${ruleId}`);
      steps.push({
        order: nextOrder(),
        name: `rule-gate:${ruleId}`,
        description: `规则闸口（确定性判定）：${rule.name ?? ruleId}。判假即拦截后续人工/写入/发射步骤。`,
        type: "condition",
        condition: gateOverlay!.condition!,
        result_key: gateKey,
        ...(gateKeys.length ? { depends_on: [...gateKeys] } : {}),
      });
      gateKeys.push(gateKey);
    } else {
      const judgeKey = identifierKey(`rule-gate-${ruleId}`);
      const verdictKey = identifierKey(`rule-verdict-${ruleId}`);
      steps.push({
        order: nextOrder(),
        name: `rule-gate:${ruleId}`,
        description: `规则闸口（LLM 裁决）：${rule.name ?? ruleId}。输出严格 JSON 裁决 {ruleId,status,reason}。`,
        type: "logic",
        action_prompt: buildJudgePrompt(ruleId, rule, gateOverlay?.judge_context),
        allowed_tools: [],
        on_error: "terminal",
        result_key: judgeKey,
        ...(gateKeys.length ? { depends_on: [...gateKeys] } : {}),
      });
      steps.push({
        order: nextOrder(),
        name: `rule-verdict:${ruleId}`,
        description: `裁决闸口：仅当 ${ruleId} 判定 pass 时放行后续步骤。`,
        type: "condition",
        condition: `results.${judgeKey}.status == 'pass' || results.${judgeKey}.status == 'PASS'`,
        result_key: verdictKey,
        depends_on: [judgeKey],
      });
      gateKeys.push(verdictKey);
    }
  }

  // (b) manual steps from ontology action_steps (object_type === "manual").
  //
  // `manualKeys` holds only the UNCONDITIONAL steps — those are the ones that
  // must gate everything after them. A step carrying an overlay `condition` is
  // optional (see OverlayManualStep.condition): it is deliberately kept out of
  // downstream `depends_on`, because any skipped dependency skips its dependent
  // and an un-asked optional question would otherwise cancel the ERP write.
  const manualKeys: string[] = [];
  for (const manualStep of (action.action_steps ?? []).filter((step) => step.object_type === "manual")) {
    const overlayManual = ctx.overlay.manual_steps?.[action.id]?.[manualStep.name];
    const manualKey = identifierKey(`manual-${manualStep.order}`);
    const manualCondition = overlayManual?.condition?.trim();
    if (manualCondition !== undefined && manualCondition.length === 0) {
      fail(
        `manual step ${action.id}.${manualStep.name} declares an empty overlay condition`,
      );
    }
    steps.push({
      order: nextOrder(),
      name: manualStep.name,
      description: manualStep.description ?? manualStep.name,
      type: "manual",
      // `task_type` is what makes the manual contract complete for the
      // authoring lint (rule 7: a Human-actor agent needs task_type +
      // awaiting_role + form_schema, or a taskDefinition tool). Emitting the
      // step name matches register.ts's own `action.task_type ?? action.name`
      // fallback, so the runtime task is byte-identical either way.
      task_type: overlayManual?.task_type ?? manualStep.name,
      form_schema: overlayManual?.form_schema ?? genericApproveFormSchema(manualStep.name),
      awaiting_role:
        overlayManual?.awaiting_role ?? firstHumanRoleForAction(ctx.model, action.id) ?? "Human",
      result_key: manualKey,
      ...(manualCondition ? { condition: manualCondition } : {}),
      ...(gateKeys.length || manualKeys.length
        ? { depends_on: [...gateKeys, ...manualKeys] }
        : {}),
    });
    if (!manualCondition) manualKeys.push(manualKey);
  }

  // (c) the ERP write via metaerp.invoke; (d) result_key = action id slug.
  const operationId =
    action.implementation.operation_id ??
    (action.implementation.endpoint ? opIdFromEndpoint(action.implementation.endpoint) : undefined);
  if (!operationId) fail(`external action ${action.id} declares no operation_id/endpoint`);
  const guards = [...gateKeys, ...manualKeys];
  steps.push({
    order: nextOrder(),
    name: TOOL_NAME,
    description: `写回 Meta ERP：${operationId}。`,
    type: "tool",
    tool_arguments: normalizeToolArguments(action.id, ctx.overlay.tool_arguments?.[action.id]),
    allowed_tools: [TOOL_NAME],
    result_key: action.id,
    ...(guards.length ? { depends_on: guards } : {}),
    on_error: METAERP_WRITE_ERROR_POLICY.map((rule) => ({ ...rule })),
  });

  // An overlay emission block wins: it is the only way to express a real
  // branch out of an external action (the canonical case is a human gate whose
  // form carries approve/reject, where `triggered_event[0]` alone would emit
  // APPROVED on a rejection). Emissions are gated on the write step, so a
  // blocked gate or a failed write still emits nothing.
  const overlayEmissions = overlayEmissionsFor(ctx, action);
  if (overlayEmissions.length) {
    const conditional = appendEmissionSteps(
      steps,
      overlayEmissions,
      action.id,
      nextOrder,
      [action.id],
    );
    if (conditional || gateKeys.length) steps.push(suppressImplicitEmitStep(nextOrder()));
  } else if (gateKeys.length) {
    // With gates in play the success event must be explicit and the implicit
    // triggered_event[0] fallback suppressed, so a blocked run emits nothing.
    // A compensation event is NOT a success event — it is emitted by the
    // runtime on hard failure, never as an unconditional emit step here.
    for (const eventName of successEvents(ctx, action)) {
      steps.push({
        order: nextOrder(),
        name: `emit:${eventName}`,
        description: `写入成功后发射事件 ${eventName}。`,
        type: "emit",
        emit_event: eventName,
        emit_payload_from: "lastResult",
        result_key: identifierKey(`emit-${eventName}`),
        depends_on: [action.id],
      });
    }
    steps.push(suppressImplicitEmitStep(nextOrder()));
  }

  const writeDescription = (action.side_effects?.external_calls ?? []).find(
    (call) => opIdFromEndpoint(call.endpoint) === operationId,
  )?.description;
  const toolUse = [
    toolUseEntry(
      operationId,
      "write",
      ctx.catalogPath,
      ctx.baseUrlEnv,
      writeDescription,
      ctx.operationParams,
    ),
  ];
  return { steps, toolUse };
}

// ── localized titles ──────────────────────────────────────────────────────────

/** The overlay-declared display titles of an action, with the `title_locale`
 * (default `zh`) entry — else the first declared locale — promoted to `title`.
 * Locale keys are emitted in sorted order so output stays byte-stable. */
function localizedTitles(
  overlay: CompilerOverlay,
  action: StudioAction,
): { title: string; title_i18n: Record<string, string> } | null {
  const declared = overlay.titles?.[action.id];
  if (!declared) return null;
  const title_i18n: Record<string, string> = {};
  for (const locale of Object.keys(declared).sort()) {
    title_i18n[locale] = declared[locale]!.trim();
  }
  const preferred = overlay.title_locale?.trim() || "zh";
  const title = title_i18n[preferred] ?? title_i18n[Object.keys(title_i18n)[0]!]!;
  return { title, title_i18n };
}

// ── erp-operations catalog ────────────────────────────────────────────────────

function buildErpOperations(model: StudioDomainModel): ErpOperation[] {
  const byId = new Map<string, ErpOperation>();
  const erpEntityByObject = new Map<string, string | null>(
    model.transformMaps.object_maps.map((objectMap) => [
      objectMap.object_id,
      objectMap.erp_entity ?? null,
    ]),
  );
  const add = (operation: ErpOperation): void => {
    const existing = byId.get(operation.operation_id);
    if (existing) {
      if (existing.path !== operation.path || existing.kind !== operation.kind) {
        fail(`conflicting definitions for ERP operation ${operation.operation_id}`);
      }
      return;
    }
    byId.set(operation.operation_id, operation);
  };
  for (const objectMap of model.transformMaps.object_maps) {
    const fetchPath = objectMap.fetch?.path;
    if (!fetchPath) continue;
    add({
      operation_id: opIdFromEndpoint(fetchPath),
      method: objectMap.fetch?.method ?? "POST",
      path: fetchPath,
      kind: "query",
      entity: objectMap.erp_entity ?? null,
    });
  }
  for (const actionMap of model.transformMaps.action_maps) {
    if (actionMap.kind !== "external") continue;
    const endpoint = actionMap.endpoint;
    if (!endpoint) fail(`action_map ${actionMap.action_id} (external) has no endpoint`);
    const target = actionMap.data_changes?.[0]?.target_object;
    add({
      operation_id: actionMap.operation_id ?? opIdFromEndpoint(endpoint),
      method: actionMap.method ?? "POST",
      path: endpoint,
      kind: "write",
      entity: target ? (erpEntityByObject.get(target) ?? null) : null,
    });
  }
  return [...byId.values()].sort((a, b) => a.operation_id.localeCompare(b.operation_id, "en"));
}

// ── entry point ───────────────────────────────────────────────────────────────

export interface CompileOptions {
  tenant: string;
  /**
   * Env var holding this tenant's metaERP origin. Defaults to
   * `METAERP_BASE_URL`; set it when the tenant needs its own ERP instance.
   */
  baseUrlEnv?: string;
  /**
   * 每个 ERP 操作的真实请求字段，来自
   * config/metaerp-operation-params.json（由 CLI 读入）。写进工具描述，
   * 让模型拿到接口契约而不是只有一个操作名。
   */
  operationParams?: Record<string, MetaerpOperationParams>;
}

export function compile(
  model: StudioDomainModel,
  overlay: CompilerOverlay = {},
  options: CompileOptions,
): CompileResult {
  const tenant = options.tenant;
  if (!tenant || !/^[a-z0-9][a-z0-9-]*$/.test(tenant)) {
    fail(`tenant must be a lowercase slug, got "${tenant}"`);
  }
  const catalogPath = `models/${tenant}-v1/erp-operations.json`;
  const baseUrlEnv = options.baseUrlEnv?.trim() || DEFAULT_BASE_URL_ENV;
  if (!/^[A-Z][A-Z0-9_]*$/.test(baseUrlEnv)) {
    fail(`baseUrlEnv must be an UPPER_SNAKE env var name, got "${baseUrlEnv}"`);
  }
  const ctx: CompileContext = {
    baseUrlEnv,
    ...(options.operationParams ? { operationParams: options.operationParams } : {}),
    model,
    overlay,
    eventsByName: new Map(model.events.map((event) => [event.name, event])),
    rulesById: new Map(model.rules.map((rule) => [rule.id, rule])),
    catalogPath,
  };

  for (const actionId of Object.keys(overlay.emissions ?? {})) {
    if (!model.actions.some((action) => action.id === actionId)) {
      fail(`overlay emissions references unknown action ${actionId}`);
    }
  }
  for (const actionId of Object.keys(overlay.extra_tools ?? {})) {
    if (!model.actions.some((action) => action.id === actionId)) {
      fail(`overlay extra_tools references unknown action ${actionId}`);
    }
  }
  for (const actionId of Object.keys(overlay.compensation_events ?? {})) {
    if (!model.actions.some((action) => action.id === actionId)) {
      fail(`overlay compensation_events references unknown action ${actionId}`);
    }
  }
  for (const [actionId, localized] of Object.entries(overlay.titles ?? {})) {
    if (!model.actions.some((action) => action.id === actionId)) {
      fail(`overlay titles references unknown action ${actionId}`);
    }
    if (!localized || typeof localized !== "object" || !Object.keys(localized).length) {
      fail(`overlay titles for ${actionId} must map at least one locale to a title`);
    }
    for (const [locale, title] of Object.entries(localized)) {
      if (!/^[a-z]{2,3}(-[A-Za-z0-9]+)*$/.test(locale) || typeof title !== "string" || !title.trim()) {
        fail(`overlay titles for ${actionId} has an invalid locale/title pair "${locale}"`);
      }
    }
  }

  // An output contract only shapes an analysis prompt. On an external (write)
  // action it is dead configuration that reads like an enforced rule — the
  // 2026-09-08 audit found BR-CLOSE-01 living in exactly such an entry.
  for (const actionId of Object.keys(overlay.output_contracts ?? {})) {
    const action = model.actions.find((candidate) => candidate.id === actionId);
    if (!action) fail(`overlay output_contracts references unknown action ${actionId}`);
    if (action!.implementation?.kind === "external") {
      fail(
        `overlay output_contracts["${actionId}"] targets an external action, which has no analysis ` +
          `step to honour it — a rule stated there is not enforced by anything`,
      );
    }
  }

  // A blocking outcome that is silently dropped would let the success event
  // fire on a blocked analysis — the exact defect it exists to prevent.
  for (const [actionId, outcomes] of Object.entries(overlay.blocking_outcomes ?? {})) {
    const action = model.actions.find((candidate) => candidate.id === actionId);
    if (!action) fail(`overlay blocking_outcomes references unknown action ${actionId}`);
    if (action!.implementation?.kind === "external") {
      fail(
        `overlay blocking_outcomes["${actionId}"] targets an external action — blocking outcomes ` +
          `are reported by an analysis step and compile only for prompt actions`,
      );
    }
    if (!Array.isArray(outcomes) || outcomes.length === 0) {
      fail(`overlay blocking_outcomes for ${actionId} must be a non-empty array`);
    }
    const codes = new Set<string>();
    for (const outcome of outcomes) {
      if (!outcome || typeof outcome !== "object") {
        fail(`overlay blocking_outcomes for ${actionId} has a non-object entry`);
      }
      if (typeof outcome.when !== "string" || !outcome.when.trim()) {
        fail(`overlay blocking_outcomes for ${actionId} requires a "when" condition`);
      }
      if (typeof outcome.code !== "string" || !BLOCKING_CODE_PATTERN.test(outcome.code)) {
        fail(`overlay blocking_outcomes for ${actionId} has an invalid code "${String(outcome.code)}"`);
      }
      if (codes.has(outcome.code)) {
        fail(`overlay blocking_outcomes for ${actionId} repeats code "${outcome.code}"`);
      }
      codes.add(outcome.code);
      const hasFrom = typeof outcome.message_from === "string" && outcome.message_from.trim() !== "";
      const hasStatic = typeof outcome.message === "string" && outcome.message.trim() !== "";
      if (hasFrom === hasStatic) {
        fail(
          `overlay blocking_outcomes for ${actionId}/${outcome.code} must give exactly one of message_from / message`,
        );
      }
      if (hasFrom && !BLOCKING_MESSAGE_PATH.test(outcome.message_from!.trim())) {
        fail(
          `overlay blocking_outcomes for ${actionId}/${outcome.code}: message_from must read the analysis ` +
            `result (lastResult.<field> or results.<key>.<field>), got "${outcome.message_from}"`,
        );
      }
    }
  }

  // A gate that is silently ignored is worse than one that is unsupported: the
  // branch it was meant to stop would run, and the overlay would look correct.
  for (const actionId of Object.keys(ctx.overlay.submission_gates ?? {})) {
    const action = model.actions.find((candidate) => candidate.id === actionId);
    if (!action) {
      fail(`submission_gates names unknown action "${actionId}"`);
    } else if (action!.implementation?.kind !== "external") {
      fail(
        `submission_gates["${actionId}"] targets a ${action!.implementation?.kind ?? "?"} action — ` +
          `gates are only compiled for external actions, so this one would never run`,
      );
    }
  }

  validateInputExamples(ctx);

  const workflow: CompiledAgent[] = model.actions.map((action) => {
    const kind = action.implementation.kind;
    const compiled =
      kind === "prompt"
        ? compilePromptAgent(ctx, action)
        : kind === "external"
          ? compileExternalAgent(ctx, action)
          : fail(`action ${action.id} has unsupported implementation.kind "${kind}"`);
    applyExtraTools(ctx, action, compiled);

    const trigger = action.trigger.filter((event) => event !== "MANUAL");
    if (!trigger.length) trigger.push(syntheticManualTrigger(action.id));

    const ontologyInstructions = buildOntologyInstructions(model, action);
    // `triggered_event` drives register.ts's implicit emit fallback, so it must
    // list only what a SUCCESSFUL run emits; the failure event moves to
    // `compensation_event`, which the runtime emits once on a hard failure.
    const compensationEvent = compensationEventFor(ctx, action);
    const titles = localizedTitles(ctx.overlay, action);
    return {
      id: action.id,
      name: action.id,
      title: titles?.title ?? action.name,
      ...(titles ? { title_i18n: titles.title_i18n } : {}),
      description: action.description ?? "",
      actor: action.actor,
      trigger,
      inputs: inputPortsFor(ctx, trigger),
      triggered_event: successEvents(ctx, action),
      retries: 3,
      generated: true,
      ...(compensationEvent ? { compensation_event: compensationEvent } : {}),
      ...(ontologyInstructions ? { ontology_instructions: ontologyInstructions } : {}),
      tool_use: compiled.toolUse,
      actions: compiled.steps,
    };
  });

  return {
    workflow,
    actions: model.raw.actions,
    events: model.raw.events,
    objects: model.raw.objects,
    rules: model.raw.rules,
    erpOperations: buildErpOperations(model),
  };
}

/** Five-file AO layout + the erp-operations catalog, keyed by file name. */
export function serializeCompileResult(result: CompileResult): Map<string, unknown> {
  return new Map<string, unknown>([
    ["workflow_v1.json", result.workflow],
    ["actions_v1.json", result.actions],
    ["events_v1.json", result.events],
    ["objects_v1.json", result.objects],
    ["rules_v1.json", result.rules],
    ["erp-operations.json", result.erpOperations],
  ]);
}
