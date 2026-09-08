import {
  RUN_INPUT_MAX_FILE_BYTES,
  RunInputAttachmentSchema,
  RunInputContextSchema,
  type RunInputAttachment,
  type RunInputContext,
  type ParseRunInputBody,
} from "@agentic/contracts";
import { fetchApiData } from "./api-response";
import { tenantHeader } from "./hooks/tenant-header";

export const RUN_INPUT_FILE_ACCEPT =
  ".pdf,.png,.jpg,.jpeg,.gif,.webp,.txt,.md,.csv,.tsv,.json,.xml,.html,.htm,.log";

const MIME_BY_EXTENSION: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  txt: "text/plain",
  md: "text/markdown",
  csv: "text/csv",
  tsv: "text/tab-separated-values",
  json: "application/json",
  xml: "application/xml",
  html: "text/html",
  htm: "text/html",
  log: "text/plain",
};

export function runInputFileType(file: Pick<File, "name" | "type">): string | null {
  const extension = file.name.split(".").at(-1)?.toLowerCase() ?? "";
  return MIME_BY_EXTENSION[extension] ?? null;
}

/** Only reviewed text crosses the run boundary; raw file bytes stay out of runs. */
export function buildRunInputContext(
  prompt: string,
  context: string,
  contextKey: string,
  attachments: RunInputAttachment[],
): RunInputContext | undefined {
  const value = {
    ...(prompt.trim() ? { prompt: prompt.trim() } : {}),
    ...(context.trim() ? { context: context.trim() } : {}),
    ...(contextKey.trim() ? { contextKey: contextKey.trim() } : {}),
    ...(attachments.length ? { attachments } : {}),
  };
  return Object.keys(value).length ? RunInputContextSchema.parse(value) : undefined;
}

export function runInputPrompt(
  prompt: string,
  attachments: RunInputAttachment[] | undefined,
  fileOnlyPrompt: string,
): string {
  return prompt.trim() || !hasRunInputAttachmentText(attachments) ? prompt : fileOnlyPrompt;
}

export function hasRunInputAttachmentText(attachments: RunInputAttachment[] | undefined): boolean {
  return Boolean(attachments?.some((attachment) => attachment.text.trim()));
}

export type RunInputParseOptions = Pick<ParseRunInputBody, "provider" | "model">;

export async function parseRunInputFile(
  file: File,
  signal?: AbortSignal,
  options: RunInputParseOptions = {},
): Promise<RunInputAttachment> {
  if (file.size === 0 || file.size > RUN_INPUT_MAX_FILE_BYTES) {
    throw new Error("File must contain between 1 byte and 8 MiB.");
  }
  const mimeType = runInputFileType(file);
  if (!mimeType) throw new Error("This file type is not supported.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  signal?.throwIfAborted();
  // Bound spread calls for multi-megabyte files to avoid the JS argument limit.
  const chunks: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 0x8000)));
  }
  const response = await fetchApiData<unknown>("/v1/run-inputs/parse", {
    method: "POST",
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...tenantHeader(),
    },
    body: JSON.stringify({
      name: file.name,
      mimeType,
      base64: btoa(chunks.join("")),
      ...(options.provider ? { provider: options.provider } : {}),
      ...(options.model ? { model: options.model } : {}),
    }),
    signal,
  });
  return RunInputAttachmentSchema.parse(response);
}
