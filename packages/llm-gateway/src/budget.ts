/**
 * Per-tenant budget enforcement for the LLM gateway (P1-LLM-05).
 *
 * The gateway calls `assertBudgetAvailable()` BEFORE each provider chat() and
 * `recordActualSpend()` AFTER each successful call. Both functions are no-ops
 * when no tenantId is supplied — code-agents called outside a tenant context
 * (e.g. internal __system jobs) skip the check.
 *
 * Strategy: **deduct-then-execute**, NOT reserve-then-execute.
 *
 *   - `assertBudgetAvailable()` is a pure read: it compares the row's
 *     `used_tokens_month` / `used_usd_month` to the corresponding cap and
 *     throws `LLMError('cost_limit_exceeded')` if already over.
 *   - `recordActualSpend()` does the deduction AFTER the call, using the
 *     actual `tokens_in + tokens_out` and the catalog USD price for that
 *     provider+model.
 *
 * Trade-off:
 *
 *   - Pro: simple, no in-flight reservation bookkeeping; failures are cheap
 *     (we don't have to refund unspent reservations).
 *   - Con: a single tenant can race up to N concurrent calls past the cap
 *     before any deduction lands. The total overshoot is bounded by
 *     (concurrent_calls × max_cost_per_call) which for v1's 8-concurrent-runs
 *     limit and Claude Sonnet pricing is ~few cents — well within the noise.
 *     Phase 4 can swap in reserve-then-execute via a row-level lock when
 *     concurrency grows.
 *
 * The "no row yet" case is treated as "no caps configured" (unlimited),
 * matching the GET /v1/budgets behavior of materializing rows lazily.
 */

import { getDb, tenantBudgets } from "@agentic/db";
import { eq, sql } from "drizzle-orm";
import { LLMError } from "./errors";
import type { ProviderId } from "./types";

// Module augmentation so callers can attach a tenantId to ChatRequest
// without touching the types.ts file (owned by the Agents engineer track).
// The gateway reads this slot before each chat() call to apply budget caps.
declare module "./types" {
  interface ChatRequest {
    /**
     * Tenant scope for budget enforcement (P1-LLM-05). When set, the gateway
     * asserts the tenant has remaining budget BEFORE the call and deducts
     * actual spend AFTER. When omitted, no budget check is run.
     */
    tenantId?: string;
  }
}

/**
 * Per-million-token USD prices for cost estimation. These are coarse
 * estimates used for budget accounting — the LLM gateway does NOT charge
 * tenants; this is just for the per-tenant USD cap. Updated as needed when
 * provider pricing shifts; tenant-specific overrides could live in a future
 * column.
 *
 * Stored as USD CENTS per 1M tokens (so 300 = $3.00/Mt) to keep arithmetic
 * integer-only and align with `tenant_budgets.used_usd_month` (cents).
 */
const PRICE_PER_MTOK_CENTS: Record<ProviderId, { in: number; out: number }> = {
  anthropic: { in: 300, out: 1500 }, // claude-3-7-sonnet ~$3/$15
  openai: { in: 250, out: 1000 },
  openrouter: { in: 200, out: 800 }, // rough avg; routed prices vary
  gemini: { in: 100, out: 400 },
  groq: { in: 50, out: 80 },
  together: { in: 30, out: 60 },
  mistral: { in: 100, out: 300 },
  deepseek: { in: 15, out: 60 },
  qwen: { in: 30, out: 90 },
  azure: { in: 250, out: 1000 }, // mirrors openai
  bedrock: { in: 300, out: 1500 }, // mirrors anthropic claude on bedrock
  vertex: { in: 100, out: 400 }, // mirrors gemini
  custom: { in: 100, out: 300 }, // generic placeholder
  mock: { in: 0, out: 0 }, // no cost for test provider
};

function costCents(
  provider: ProviderId,
  tokensIn: number,
  tokensOut: number,
): number {
  const p = PRICE_PER_MTOK_CENTS[provider] ?? { in: 0, out: 0 };
  // ceil to avoid systematic under-charge when rounding
  return Math.ceil((tokensIn * p.in + tokensOut * p.out) / 1_000_000);
}

/**
 * Assert the tenant has budget left. Returns silently when no row exists or
 * when both caps are null/unset. Throws `LLMError('cost_limit_exceeded')`
 * when either the token cap OR the USD cap is exceeded.
 */
export function assertBudgetAvailable(
  tenantId: string | undefined,
  provider: ProviderId,
): void {
  if (!tenantId) return;
  const db = getDb();
  const row = db
    .select()
    .from(tenantBudgets)
    .where(eq(tenantBudgets.tenantId, tenantId))
    .all()[0];
  if (!row) return; // no budget row = unlimited
  if (
    row.monthlyTokenCap !== null &&
    row.usedTokensMonth >= row.monthlyTokenCap
  ) {
    throw new LLMError(
      `tenant ${tenantId} exceeded monthly token cap (${row.usedTokensMonth}/${row.monthlyTokenCap})`,
      "cost_limit_exceeded",
      provider,
    );
  }
  if (row.monthlyUsdCap !== null && row.usedUsdMonth >= row.monthlyUsdCap) {
    throw new LLMError(
      `tenant ${tenantId} exceeded monthly USD cap (${row.usedUsdMonth}c/${row.monthlyUsdCap}c)`,
      "cost_limit_exceeded",
      provider,
    );
  }
}

/**
 * Record actual spend after a successful provider call. Idempotent against
 * concurrent updates via SQL `SET col = col + delta`.
 */
export function recordActualSpend(args: {
  tenantId: string | undefined;
  provider: ProviderId;
  tokensIn: number;
  tokensOut: number;
}): { tokens: number; usdCents: number } | null {
  const { tenantId, provider, tokensIn, tokensOut } = args;
  if (!tenantId) return null;
  const tokens = (tokensIn ?? 0) + (tokensOut ?? 0);
  const usdCents = costCents(provider, tokensIn ?? 0, tokensOut ?? 0);
  if (tokens === 0 && usdCents === 0) return { tokens: 0, usdCents: 0 };

  const db = getDb();
  // Materialize row first if missing — keeps the increment atomic on the
  // existing row regardless.
  const exists = db
    .select({ tenantId: tenantBudgets.tenantId })
    .from(tenantBudgets)
    .where(eq(tenantBudgets.tenantId, tenantId))
    .all()[0];
  if (!exists) {
    db.insert(tenantBudgets)
      .values({
        tenantId,
        monthlyTokenCap: null,
        monthlyUsdCap: null,
        usedTokensMonth: tokens,
        usedUsdMonth: usdCents,
      })
      .onConflictDoNothing({ target: tenantBudgets.tenantId })
      .run();
  } else {
    db.update(tenantBudgets)
      .set({
        usedTokensMonth: sql`${tenantBudgets.usedTokensMonth} + ${tokens}`,
        usedUsdMonth: sql`${tenantBudgets.usedUsdMonth} + ${usdCents}`,
        updatedAt: new Date(),
      })
      .where(eq(tenantBudgets.tenantId, tenantId))
      .run();
  }
  return { tokens, usdCents };
}

// Re-exported for tests + callers that want to forecast costs.
export { costCents as __costCentsForTest };
