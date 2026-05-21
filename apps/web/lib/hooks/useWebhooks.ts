/**
 * useIngestWebhook — TanStack Query mutation around `POST /v1/webhooks/:provider`.
 *
 * The `/v1/webhooks/:provider` route is the inbound entry-point for external
 * systems to dispatch events into Inngest. It is HMAC-verified (no Bearer
 * auth) — every caller has to know the provider's HMAC secret to land a
 * payload. From the operator UI we never use this for live ingestion (real
 * traffic comes from third-party services); the hook exists so the Settings
 * → Webhooks panel can run a "Send test payload" probe against the route.
 *
 * Wired by docs/team-execution/03-logging-audit.md: closes the gap where the
 * api route existed but had no api-client wrapper or hook. The route was
 * already registered in `apps/api/src/server.ts` — this hook just provides
 * a typed front-end for it.
 */
"use client";

import {
  useMutation,
  useQueryClient,
  type UseMutationResult,
} from "@tanstack/react-query";
import { AUDIT_KEYS } from "./useAudit";

interface ApiOk<T> {
  ok: true;
  data: T;
}
interface ApiErr {
  ok: false;
  error: { code: string; message: string };
}

export interface WebhookIngestResponse {
  provider: string;
  event: string;
}

export interface WebhookIngestArgs {
  /** Provider slug (becomes `WEBHOOK_<UPPER>` event name). */
  provider: string;
  /** Raw body the caller would have sent. Stringified before HMAC sign. */
  body: unknown;
  /**
   * sha256 HMAC signature of the body using the provider's secret. The api
   * accepts `x-signature-256`, `x-hub-signature-256`, `stripe-signature`,
   * or `x-signature` — we pass through `x-signature-256` as the canonical
   * header (matches GitHub's convention).
   */
  signature: string;
}

async function ingestWebhook(args: WebhookIngestArgs): Promise<WebhookIngestResponse> {
  const body =
    typeof args.body === "string" ? args.body : JSON.stringify(args.body ?? {});
  const res = await fetch(
    `/v1/webhooks/${encodeURIComponent(args.provider)}`,
    {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
        "x-signature-256": args.signature,
        Accept: "application/json",
      },
      body,
    },
  );
  const json = (await res.json()) as ApiOk<WebhookIngestResponse> | ApiErr;
  if (!json.ok) {
    throw new Error(
      `/v1/webhooks/${args.provider}: ${json.error.code} — ${json.error.message}`,
    );
  }
  return json.data;
}

/**
 * Ingest a webhook payload. On success invalidates the audit log so the
 * `webhook.ingest` row appears in Settings → Audit without a manual refresh.
 */
export function useIngestWebhook(): UseMutationResult<
  WebhookIngestResponse,
  Error,
  WebhookIngestArgs
> {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ingestWebhook,
    onSettled: () => {
      // Audit row is written by the api on success — refresh the audit list.
      void client.invalidateQueries({ queryKey: AUDIT_KEYS.all });
    },
  });
}
