/**
 * Response normalisation for Meta ERP calls — the fail-closed boundary.
 *
 * The real ERP answers a business failure with **HTTP 200** and
 * `{"status":"ERROR","message":"PBP-ServiceLogic-401069 ..."}`. Reading only the
 * status code therefore reports success on a call that returned nothing, and
 * the agent proceeds on empty data — the exact failure CLAUDE.md records from
 * the RoboHire match-resume integration, where a nested envelope read one level
 * too shallow made every candidate score null while the call "succeeded".
 *
 * So: a non-2xx, a non-JSON body, or `status != SUCCESS` all raise. Callers get
 * the payload only when the ERP actually said it worked.
 */

const MAX_DIAGNOSTIC_CHARS = 2_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function clip(text: string): string {
  return text.length > MAX_DIAGNOSTIC_CHARS
    ? `${text.slice(0, MAX_DIAGNOSTIC_CHARS)}…`
    : text;
}

/**
 * Turn a known upstream failure into the sentence that names the fix.
 *
 * These three are the gateway's own vocabulary, documented in the skill's
 * result-reading table. Passing them through raw makes every one of them look
 * like the same opaque 200, when each has a different and specific remedy.
 */
function remediation(body: string): string | null {
  if (body.includes("couldn't access")) {
    return "the APIG application (appId = METAERP_PROJECT) is not authorised for this operation — authorise it in APIG and retry";
  }
  if (body.includes("Service Not Found")) {
    return "the path is not registered on this estate — re-check the APIG registration path and the env prefix";
  }
  if (body.includes("userId is null")) {
    return "this is a UI-form operation reached with an IAM token — route it through the uiapi transport instead";
  }
  return null;
}

/**
 * `status` is doing two different jobs depending on who wrote it.
 *
 * The gateway uses it as the envelope verdict (SUCCESS / ERROR). A document
 * payload uses it as a business field — a freshly created plan comes back with
 * `status: "草稿"`. Treating any string `status` as a verdict therefore fails
 * every successful create, so only the envelope's own vocabulary counts; an
 * unrecognised value is data, and the payload passes through.
 */
const ENVELOPE_VERDICTS = new Set(["SUCCESS", "ERROR", "FAIL", "FAILED", "FAILURE"]);

function isEnvelopeVerdict(value: string): boolean {
  return ENVELOPE_VERDICTS.has(value.trim().toUpperCase());
}

export interface NormalizeInput {
  operation: string;
  status: number;
  body: string;
  url: string;
}

/** The payload the ERP returned, unwrapped from its envelope. */
export function normalizeMetaerpResponse(input: NormalizeInput): unknown {
  const { operation, status, body, url } = input;
  const hint = remediation(body);
  const suffix = hint ? ` — ${hint}` : "";

  if (status < 200 || status >= 300) {
    throw new Error(
      `metaerp.invoke: '${operation}' returned HTTP ${status} from ${url}${suffix} — ${clip(body)}`,
    );
  }
  let parsed: unknown;
  try {
    parsed = body.trim() ? JSON.parse(body) : {};
  } catch {
    throw new Error(
      `metaerp.invoke: '${operation}' returned a non-JSON body${suffix} — ${clip(body)}`,
    );
  }
  if (hint) {
    // A 200 carrying one of those messages is a failure wearing a success code.
    throw new Error(`metaerp.invoke: '${operation}' failed${suffix} — ${clip(body)}`);
  }
  if (!isRecord(parsed)) return parsed;

  if (typeof parsed.status === "string" && isEnvelopeVerdict(parsed.status)) {
    if (parsed.status.toUpperCase() === "SUCCESS") {
      return "data" in parsed ? parsed.data : parsed;
    }
    const detail =
      [parsed.errorCode, parsed.code, parsed.message, parsed.errorMessage]
        .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
        .join(" ") || clip(body);
    throw new Error(
      `metaerp.invoke: '${operation}' returned status=${parsed.status} — ${detail}`,
    );
  }
  // The mock ERP's own failure shape, so a mock-routed operation fails the same
  // way a real one does rather than returning {ok:false} as if it were data.
  if (parsed.ok === false) {
    const detail =
      typeof parsed.error === "string" ? parsed.error : clip(body);
    throw new Error(`metaerp.invoke: '${operation}' failed — ${detail}`);
  }
  return parsed;
}
