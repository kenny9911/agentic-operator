"use client";

import { useEffect, useRef, useState } from "react";
import {
  RUN_INPUT_MAX_ATTACHMENTS,
  RUN_INPUT_MAX_ATTACHMENT_TEXT_CHARS,
  RUN_INPUT_MAX_FILE_BYTES,
  RUN_INPUT_MAX_TEXT_CHARS,
  RUN_INPUT_MAX_TOTAL_CHARS,
  type RunInputAttachment,
} from "@agentic/contracts";
import { useI18n } from "@/app/portal/lib/preferences-context";
import { formatApiError } from "@/lib/api-response";
import { buildRunInputContext, parseRunInputFile, runInputFileType, type RunInputParseOptions } from "@/lib/run-input";

export interface RunInputFileDraft {
  key: string;
  file: File;
  parsed?: RunInputAttachment;
  error?: string;
}

export function useRunInput(options: RunInputParseOptions = {}) {
  const { t } = useI18n();
  const [prompt, setPrompt] = useState("");
  const [context, setContext] = useState("");
  const [contextKey, setContextKey] = useState("");
  const [files, setFiles] = useState<RunInputFileDraft[]>([]);
  const [error, setError] = useState<string | null>(null);
  const requests = useRef(new Map<string, AbortController>());

  useEffect(() => {
    const active = requests.current;
    return () => {
      for (const controller of active.values()) controller.abort();
      active.clear();
    };
  }, []);

  async function parseFile(item: RunInputFileDraft) {
    const controller = new AbortController();
    requests.current.set(item.key, controller);
    setFiles((current) => current.map((file) =>
      file.key === item.key ? { ...file, error: undefined } : file));
    try {
      const parsed = await parseRunInputFile(item.file, controller.signal, options);
      if (controller.signal.aborted) return;
      setFiles((current) => current.map((file) =>
        file.key === item.key ? { ...file, parsed, error: undefined } : file));
    } catch (cause) {
      if (controller.signal.aborted) return;
      setFiles((current) => current.map((file) =>
        file.key === item.key ? { ...file, error: formatApiError(cause, t) } : file));
    } finally {
      requests.current.delete(item.key);
    }
  }

  async function addFiles(selected: File[]) {
    setError(null);
    if (files.length + selected.length > RUN_INPUT_MAX_ATTACHMENTS) {
      setError(t("runInput.tooManyFiles", { count: RUN_INPUT_MAX_ATTACHMENTS }));
      return;
    }
    for (const file of selected) {
      if (!runInputFileType(file)) {
        setError(t("runInput.unsupportedFile", { name: file.name }));
        return;
      }
      if (!file.size || file.size > RUN_INPUT_MAX_FILE_BYTES) {
        setError(t("runInput.invalidSize", { name: file.name, sizeMiB: RUN_INPUT_MAX_FILE_BYTES / (1024 * 1024) }));
        return;
      }
    }
    const additions = selected.map((file) => ({ key: crypto.randomUUID(), file }));
    setFiles((current) => [...current, ...additions]);
    await Promise.allSettled(additions.map(parseFile));
  }

  function removeFile(key: string) {
    requests.current.get(key)?.abort();
    requests.current.delete(key);
    setFiles((current) => current.filter((file) => file.key !== key));
    setError(null);
  }

  function editFile(key: string, text: string) {
    setFiles((current) => current.map((file) =>
      file.key === key && file.parsed
        ? { ...file, parsed: { ...file.parsed, text } }
        : file));
  }

  let value: ReturnType<typeof buildRunInputContext>;
  let validationError: string | null = null;
  try {
    value = buildRunInputContext(prompt, context, contextKey,
      files.flatMap((file) => file.parsed ? [file.parsed] : []));
  } catch {
    validationError = t("runInput.tooMuchText", {
      textChars: RUN_INPUT_MAX_TEXT_CHARS.toLocaleString("en-US"),
      attachmentChars: RUN_INPUT_MAX_ATTACHMENT_TEXT_CHARS.toLocaleString("en-US"),
      totalChars: RUN_INPUT_MAX_TOTAL_CHARS.toLocaleString("en-US"),
    });
  }
  const pending = files.some((file) => !file.parsed && !file.error);
  const blocked = files.some((file) => !file.parsed) || Boolean(validationError);

  return {
    prompt, setPrompt, context, setContext, contextKey, setContextKey,
    files, addFiles, removeFile, editFile, retryFile: parseFile,
    pending, blocked, value, error: error ?? validationError,
  };
}

export type RunInputEditor = ReturnType<typeof useRunInput>;
