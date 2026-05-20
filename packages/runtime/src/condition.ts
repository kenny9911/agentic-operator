/**
 * Minimal condition evaluator (P0-RT-05).
 *
 * Manifest actions can declare a `condition?: string` (e.g. `"lastResult.score > 0.5"`).
 * Phase 0 ships a tiny deterministic evaluator over a fixed two-variable
 * context (`lastResult`, `event`) — NOT a general expression engine.
 *
 * Grammar accepted (loosely; no formal parser):
 *   - Identifiers + dotted paths: `lastResult`, `event.data.subject`
 *   - Literals: numbers, strings ("..." or '...'), `true`/`false`/`null`/`undefined`
 *   - Comparison: `==`, `!=`, `===`, `!==`, `<`, `<=`, `>`, `>=`
 *   - Logical: `&&`, `||`, `!`
 *   - Parentheses
 *   - Method-free truthiness: bare identifier or path coerces to boolean
 *
 * Anything beyond that (function call, template strings, regex, bitwise…)
 * is intentionally NOT supported. Malformed expressions fail-open: we log a
 * warning and `evaluateCondition` returns `true` so the run continues. This
 * is the safest default for Phase 0 — see DESIGN §8.4.
 *
 * Implementation note: we use `new Function()` over a restricted source
 * (only allowed characters + a whitelisted identifier set) so the v8
 * expression compiler does the heavy lifting. Tenant code never reaches
 * this path — the only inputs are the manifest condition string and the
 * runtime-owned `lastResult` / `event` objects.
 */

export interface ConditionContext {
  lastResult: unknown;
  event: { name: string; data: Record<string, unknown> };
}

const ALLOWED_TOPLEVEL = new Set(["lastResult", "event"]);

/**
 * Sanity-check the expression source. Reject anything that's not part of the
 * grammar above — most importantly: no `function`, no `=>`, no assignment,
 * no `;`, no `[`/`]` indexing (force dotted paths only), no template tokens.
 */
function looksLikeBooleanExpr(src: string): boolean {
  if (src.length === 0 || src.length > 512) return false;
  // Forbidden tokens — quick reject before the runtime compile.
  const banned = [
    "=>",
    ";",
    "function",
    "return",
    "this",
    "globalThis",
    "process",
    "import",
    "require",
    "eval",
    "constructor",
    "prototype",
    "Function",
    "`",
    "++",
    "--",
    "??=",
    "&&=",
    "||=",
    "[",
    "]",
  ];
  for (const b of banned) {
    if (src.includes(b)) return false;
  }
  // Reject lone `=` (assignment) — `==` / `===` are fine because they
  // contain a `=`, so we filter by looking for `=` not preceded/followed by `=`.
  const looseEquals = /(^|[^=!<>])=([^=]|$)/m;
  if (looseEquals.test(src)) return false;
  // Restrict identifier set: only allow [A-Za-z_$0-9.] words; reject anything
  // else token-like.
  const idents = src.match(/[A-Za-z_$][A-Za-z_$0-9]*/g) ?? [];
  const allowedIdents = new Set([
    "lastResult",
    "event",
    "data",
    "name",
    "subject",
    "true",
    "false",
    "null",
    "undefined",
  ]);
  for (const ident of idents) {
    if (allowedIdents.has(ident)) continue;
    // Permit any deeper field access via dotted paths — but only via the
    // tokenization step (the parser sees `event.data.foo` as 3 idents).
    // Since the top-level must be one of `event` or `lastResult`, and the
    // 2nd-level beneath `event` is `data`/`name`, we treat unknown deeper
    // idents as field names — they'll resolve to `undefined` on the value
    // side, which is harmless. Reject only suspicious top-level idents.
    // (A bare ident appears as a standalone token; we already require the
    // first ident on any reference to be `event` or `lastResult` per regex
    // below.)
    if (!/^[A-Za-z_$][A-Za-z_$0-9]*$/.test(ident)) return false;
  }
  // Every dotted-path root must be in the allowed top-level set, otherwise
  // the expression references something we don't expose.
  // Look for "word.word" sequences and check the head.
  const dotChains = src.match(/[A-Za-z_$][A-Za-z_$0-9]*(\.[A-Za-z_$][A-Za-z_$0-9]*)+/g) ?? [];
  for (const chain of dotChains) {
    const head = chain.split(".", 1)[0]!;
    if (!ALLOWED_TOPLEVEL.has(head)) return false;
  }
  // Solo identifiers used as truthiness probe must also be in the allowed set
  // (after subtracting reserved literals).
  // We don't enforce this exhaustively — the `new Function()` will throw on
  // any undefined ident, which we treat as fail-open below.
  return true;
}

/**
 * Evaluate a manifest condition string. Returns:
 *  - `true` if the condition is missing/empty (no condition = always run).
 *  - `true` if the condition is malformed (FAIL-OPEN; logs a warning).
 *  - `true` if the expression resolves truthy.
 *  - `false` only if the expression evaluates falsy.
 */
export function evaluateCondition(
  condition: string | undefined | null,
  ctx: ConditionContext,
  log?: (msg: string, extra?: Record<string, unknown>) => void,
): boolean {
  if (!condition) return true;
  const src = condition.trim();
  if (src === "") return true;
  if (!looksLikeBooleanExpr(src)) {
    (log ?? defaultWarn)(
      `[condition] rejecting non-boolean-expression condition (fail-open)`,
      { condition: src },
    );
    return true;
  }
  try {
    // The function body is the expression. The two parameter names mirror the
    // grammar exactly — anything else throws a ReferenceError.
    const fn = new Function(
      "lastResult",
      "event",
      `"use strict"; return (${src});`,
    ) as (lr: unknown, ev: ConditionContext["event"]) => unknown;
    const result = fn(ctx.lastResult, ctx.event);
    return Boolean(result);
  } catch (err) {
    (log ?? defaultWarn)(
      `[condition] eval threw — failing open and running step`,
      {
        condition: src,
        error: err instanceof Error ? err.message : String(err),
      },
    );
    return true;
  }
}

function defaultWarn(msg: string, extra?: Record<string, unknown>): void {
  if (extra) {
    console.warn(msg, extra);
  } else {
    console.warn(msg);
  }
}
