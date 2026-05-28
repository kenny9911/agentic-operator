/**
 * parseResumeApi — wraps POST /api/v1/parse-resume on the real RoboHire.io
 * API. Turns a candidate's resume (raw PDF bytes via base64 OR a fetchable
 * URL) into structured candidate data downstream agents can score.
 *
 * Transport (probed 2026-05-27 against the live host):
 *   - The endpoint is `multipart/form-data` ONLY. JSON body returns
 *     `400 "PDF file is required"`. The multipart field MUST be named
 *     `file`; `pdf` and `resume` both return 500.
 *
 * Input contract (one of):
 *   {
 *     resume_base64: string,    // base64-encoded PDF bytes
 *     filename?:     string,    // optional; used as the upload filename
 *     mime?:         string,    // optional content-type hint
 *   }
 *   OR
 *   {
 *     resume_url: string,       // fetchable URL we'll download once before
 *                               // forwarding the bytes to RoboHire.
 *   }
 *   OR no args — the tool falls back to ctx.lastResult (typically the
 *   output of fs.readFromInbox / readResumeFromDisk in the immediately
 *   preceding tool step). This avoids round-tripping a 4 KB base64 string
 *   through the LLM, which corrupts it (observed against Haiku 4.5).
 *
 * `resume_text` is intentionally NOT supported here — the upstream rejects
 * it. Use a separate text-to-pdf pipeline if you only have plain text.
 *
 * Per-tenant configuration (manifest `tool_use[].config`):
 *   { api_key_env?, api_key?, base_url?, timeout_ms? }
 *   — see rest-helper.ts for the resolution order.
 */

import { defineTool } from "@agentic/agent-kit";
import { z } from "zod";

import { rhBaseUrl, rhAuthToken, rhTimeoutMs } from "./rest-helper";

const PARSE_RESUME_FIELD = "file";
const DEFAULT_FILENAME = "resume.pdf";
const DEFAULT_MIME = "application/pdf";

interface ResumeBytes {
  bytes: Uint8Array<ArrayBuffer>;
  filename: string;
  mime: string;
}

function decodeBase64(b64: string): Uint8Array<ArrayBuffer> {
  // `Buffer.from(..., 'base64')` returns a Buffer whose underlying
  // ArrayBuffer can be a pooled SharedArrayBuffer slice — `new Blob([buf])`
  // then trips the lib.dom Blob typings (which only accept regular
  // ArrayBuffer-backed views). Copy bytes into a fresh ArrayBuffer-backed
  // Uint8Array so the value satisfies BlobPart.
  const buf = Buffer.from(b64, "base64");
  const ab = new ArrayBuffer(buf.byteLength);
  const view = new Uint8Array(ab);
  view.set(buf);
  return view;
}

async function fetchUrl(url: string, timeoutMs: number): Promise<ResumeBytes> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      throw new Error(
        `parseResumeApi: GET ${url} failed: ${res.status} ${res.statusText}`,
      );
    }
    const downloaded = await res.arrayBuffer();
    const ab = new ArrayBuffer(downloaded.byteLength);
    const buf = new Uint8Array(ab);
    buf.set(new Uint8Array(downloaded));
    let filename = DEFAULT_FILENAME;
    try {
      const u = new URL(url);
      const last = u.pathname.split("/").filter(Boolean).pop();
      if (last && last.length > 0) filename = last;
    } catch {
      /* keep default */
    }
    const mime = res.headers.get("content-type") ?? DEFAULT_MIME;
    return { bytes: buf, filename, mime };
  } finally {
    clearTimeout(timer);
  }
}

export const parseResumeApi = defineTool({
  name: "parseResumeApi",
  description:
    "Call RoboHire.io POST /api/v1/parse-resume to turn a resume PDF into " +
    "structured candidate data. Pass {resume_base64, filename?, mime?} OR " +
    "{resume_url} OR no args (will chain from the previous tool's output, " +
    "e.g. fs.readFromInbox). The wrapper handles multipart encoding so the " +
    "caller stays in JSON-shaped input. Returns the upstream success body " +
    "verbatim under .data.",
  output: z.record(z.string(), z.unknown()),
  async handler(ctx) {
    const raw = (ctx.event?.data ?? {}) as Record<string, unknown>;

    let payload: ResumeBytes;
    if (typeof raw.resume_base64 === "string" && raw.resume_base64.length > 0) {
      payload = {
        bytes: decodeBase64(raw.resume_base64),
        filename:
          typeof raw.filename === "string" && raw.filename.length > 0
            ? raw.filename
            : DEFAULT_FILENAME,
        mime:
          typeof raw.mime === "string" && raw.mime.length > 0
            ? raw.mime
            : DEFAULT_MIME,
      };
    } else if (typeof raw.resume_url === "string" && raw.resume_url.length > 0) {
      payload = await fetchUrl(raw.resume_url, rhTimeoutMs(ctx));
    } else {
      // Last-resort: harvest from the previous tool's output. We accept
      // the fs.readFromInbox / readResumeFromDisk shape
      // `{ base64, filename, mime, ... }`. Removes the need for the LLM
      // to echo a 4 KB base64 string between two tool_use blocks (which
      // Haiku 4.5 reliably corrupts on inputs of this size).
      const prev = (ctx.lastResult ?? null) as Record<string, unknown> | null;
      const prevB64 =
        prev && typeof prev.base64 === "string" ? (prev.base64 as string) : "";
      if (!prev || prevB64.length === 0) {
        throw new Error(
          "parseResumeApi: no input. Pass {resume_base64, filename?, mime?} " +
            "or {resume_url}, OR call fs.readFromInbox in the immediately " +
            "previous tool step so this handler can pick up the bytes from " +
            "lastResult (preferred for PDF intake — avoids round-tripping " +
            "a 4 KB base64 string through the LLM, which corrupts it).",
        );
      }
      payload = {
        bytes: decodeBase64(prevB64),
        filename:
          typeof prev.filename === "string" && (prev.filename as string).length > 0
            ? (prev.filename as string)
            : DEFAULT_FILENAME,
        mime:
          typeof prev.mime === "string" && (prev.mime as string).length > 0
            ? (prev.mime as string)
            : DEFAULT_MIME,
      };
    }

    const url = `${rhBaseUrl(ctx)}/parse-resume`;
    const form = new FormData();
    form.append(
      PARSE_RESUME_FIELD,
      new Blob([payload.bytes], { type: payload.mime }),
      payload.filename,
    );

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), rhTimeoutMs(ctx));
    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        // Authorization only — DO NOT set Content-Type ourselves; the
        // runtime needs to generate the multipart boundary header.
        headers: { Authorization: `Bearer ${rhAuthToken(ctx)}` },
        body: form,
        signal: controller.signal,
      });
    } catch (err) {
      throw new Error(
        `parseResumeApi: request error — ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      clearTimeout(timer);
    }

    const text = await res.text();
    let parsed: unknown = text;
    if (text.length > 0) {
      try {
        parsed = JSON.parse(text);
      } catch {
        /* keep as text */
      }
    }
    if (!res.ok) {
      throw new Error(
        `parseResumeApi: RoboHire returned ${res.status} — body=${JSON.stringify(parsed)}`,
      );
    }
    return {
      data: parsed,
      meta: {
        provider: "robohire.io",
        endpoint: "POST /api/v1/parse-resume (multipart)",
        upstreamStatus: res.status,
        filename: payload.filename,
        bytes: payload.bytes.length,
      },
    };
  },
});
