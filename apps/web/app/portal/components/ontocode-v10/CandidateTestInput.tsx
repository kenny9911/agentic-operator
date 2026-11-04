"use client";

import React, { useRef, useState } from "react";
import {
  OntoCodeCandidateTestCaseSchema,
  PostOntoCodeTurnRequestSchema,
  type OntoCodeCandidateTestCase,
  type PostOntoCodeTurnRequest,
} from "@agentic/contracts";
import { useI18n } from "@/app/portal/lib/preferences-context";
import styles from "./candidate-test-input.module.css";

export interface CandidateTestDraft {
  id: string;
  entryEvent: string;
  payload: string;
  kind: OntoCodeCandidateTestCase["kind"];
  expectedEvent: string;
}

export function parseCandidateTestDrafts(drafts: CandidateTestDraft[]):
  | { ok: true; cases: OntoCodeCandidateTestCase[] }
  | { ok: false; key: string; number: number } {
  if (!drafts.length || drafts.length > 500) return { ok: false, key: "noCases", number: 0 };
  const cases: OntoCodeCandidateTestCase[] = [];
  for (const [index, draft] of drafts.entries()) {
    let payload: unknown;
    try { payload = JSON.parse(draft.payload); } catch {
      return { ok: false, key: "invalidPayload", number: index + 1 };
    }
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return { ok: false, key: "invalidPayload", number: index + 1 };
    }
    const parsed = OntoCodeCandidateTestCaseSchema.safeParse({
      id: draft.id, entryEvent: draft.entryEvent, payload, kind: draft.kind,
      ...(draft.expectedEvent.trim() ? { expectedEvent: draft.expectedEvent.trim() } : {}),
    });
    if (!parsed.success) return { ok: false, key: "invalidCase", number: index + 1 };
    cases.push(parsed.data);
  }
  return { ok: true, cases };
}

/** Keep payloads in the existing typed turn input; the server selects and binds
 * the current immutable Candidate and applies its normal approval policy. */
export function candidateTestTurn(cases: OntoCodeCandidateTestCase[], text: string): PostOntoCodeTurnRequest {
  return PostOntoCodeTurnRequestSchema.parse({
    text, behavior: "execute", action: "run_tests",
    arguments: { source: "ontocode-candidate-test-input", testCases: cases },
  });
}

export interface CandidateTestInputProps {
  candidateRevision: number | null;
  disabledReason?: string | null;
  onSubmit: (cases: OntoCodeCandidateTestCase[]) => Promise<"queued" | "approval">;
}

const emptyCase = (id: string): CandidateTestDraft => ({ id, entryEvent: "", payload: "", kind: "pass", expectedEvent: "" });

export function CandidateTestInput({ candidateRevision, disabledReason, onSubmit }: CandidateTestInputProps) {
  const { t } = useI18n();
  const [drafts, setDrafts] = useState<CandidateTestDraft[]>([emptyCase("case-1")]);
  const nextId = useRef(2);
  const submitting = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const change = (index: number, patch: Partial<CandidateTestDraft>) => {
    setDrafts((items) => items.map((item, i) => i === index ? { ...item, ...patch } : item));
    setError(null); setStatus(null);
  };

  return <form className={styles.form} aria-label={t("candidateTests.title")} onSubmit={async (event) => {
    event.preventDefault();
    if (submitting.current || disabledReason || candidateRevision === null) return;
    const parsed = parseCandidateTestDrafts(drafts);
    if (!parsed.ok) { setError(t(`candidateTests.${parsed.key}`, { number: parsed.number })); return; }
    submitting.current = true; setBusy(true); setError(null); setStatus(null);
    try { setStatus(t(`candidateTests.${await onSubmit(parsed.cases)}`)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t("candidateTests.submitFailed")); }
    finally { submitting.current = false; setBusy(false); }
  }}>
    <h3 className={styles.title}>{t("candidateTests.title")}</h3>
    <p className={styles.help}>{t("candidateTests.description")}</p>
    {candidateRevision !== null ? <p className={styles.help}>{t("candidateTests.candidate", { revision: candidateRevision })}</p> : null}
    {drafts.map((draft, index) => <fieldset className={styles.case} key={draft.id} disabled={busy}>
      <legend>{t("candidateTests.case", { number: index + 1 })}</legend>
      <label>{t("candidateTests.entryEvent")}<input value={draft.entryEvent} maxLength={240} required onChange={(event) => change(index, { entryEvent: event.target.value })} /></label>
      <label>{t("candidateTests.payload")}<textarea value={draft.payload} required rows={5} spellCheck={false} onChange={(event) => change(index, { payload: event.target.value })} /></label>
      <label>{t("candidateTests.kind")}<select value={draft.kind} onChange={(event) => change(index, { kind: event.target.value as CandidateTestDraft["kind"] })}>{(["pass", "reject", "edge", "fault"] as const).map((kind) => <option value={kind} key={kind}>{t(`candidateTests.kinds.${kind}`)}</option>)}</select></label>
      <label>{t("candidateTests.expectedEvent")}<input value={draft.expectedEvent} maxLength={240} onChange={(event) => change(index, { expectedEvent: event.target.value })} /></label>
      {drafts.length > 1 ? <button type="button" onClick={() => { setDrafts((items) => items.filter((item) => item.id !== draft.id)); setStatus(null); }}>{t("candidateTests.remove")}</button> : null}
    </fieldset>)}
    <div className={styles.actions}>
      <button type="button" disabled={busy || drafts.length >= 500} onClick={() => { setDrafts((items) => [...items, emptyCase(`case-${nextId.current++}`)]); setStatus(null); }}>{t("candidateTests.add")}</button>
      <button className={styles.primary} type="submit" disabled={busy || !!disabledReason || candidateRevision === null}>{t(busy ? "candidateTests.running" : "candidateTests.run")}</button>
    </div>
    {disabledReason || candidateRevision === null ? <p className={styles.help}>{disabledReason || t("candidateTests.noCandidate")}</p> : null}
    {error ? <p className={styles.error} role="alert">{error}</p> : null}
    {status ? <p className={styles.help} role="status">{status}</p> : null}
  </form>;
}
