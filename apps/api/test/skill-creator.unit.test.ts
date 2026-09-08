import { describe, expect, it, vi } from "vitest";
import { GenerateSkillBodySchema, GenerateSkillResponseSchema, type SkillBundle } from "@agentic/contracts";
import { decodeSkillFile, loadSkillCreatorPolicy, skillBundleDigest } from "@agentic/skills";
import type { ChatRequest, ChatResponse } from "@agentic/llm-gateway";
import { generateSkill, SKILL_CREATOR_DEFAULT_MODEL_ROUTE, skillCreatorModelPolicy, SKILL_GENERATION_LIMITS, SkillGenerationError, type SkillCreatorGateway, type SkillCreatorHost } from "../src/services/skill-creator";

// Importing the service with an injected port must not initialize the live gateway or SQLite.
vi.mock("../src/services/llm", () => { throw new Error("The isolated service loaded the real gateway"); });
vi.mock("@agentic/db", () => { throw new Error("The isolated service loaded the database"); });

const ctx = { tenantId: "tnt-acme", tenantSlug: "acme", userId: "usr-operator", via: "cookie" as const };
const request = GenerateSkillBodySchema.parse({ purpose: "Create a skill that summarizes supplier exceptions.", examples: ["Summarize this month's exception records."], modelRoute: "authoring/deepseek-chat" });
const document = "---\nname: supplier-report\ndescription: Summarize supplied supplier exceptions when operations requests a report.\n---\nRead the records. Summarize exceptions with cited identifiers. Verify totals.\n";
const output = { files: [{ path: "SKILL.md", encoding: "utf8", content: document }], assumptions: [], suggestedTests: [{ id: "example", prompt: "Summarize these supplied supplier exceptions.", shouldTrigger: true, expectedCriteria: ["Preserves source identifiers."] }], changeSummary: ["Draft supplier exception instructions."] };
const response = (overrides: Partial<ChatResponse> = {}): ChatResponse => ({ text: JSON.stringify(output), provider: "deepseek", model: "deepseek-served-version", tokensIn: 100, tokensOut: 80, finishReason: "stop", latencyMs: 200, raw: { model: overrides.model ?? "deepseek-served-version" }, providerRequestId: "provider-request-1", routing: { effectiveRoute: request.modelRoute }, ...overrides });
function setup(...responses: Array<ChatResponse | Error | ((request: ChatRequest) => Promise<ChatResponse>)>): { gateway: SkillCreatorGateway; calls: ChatRequest[]; host: SkillCreatorHost } {
  const calls: ChatRequest[] = [];
  const gateway = { chat: vi.fn(async (input: ChatRequest) => {
    calls.push(input);
    const result = responses.shift();
    if (!result) throw new Error("Unexpected extra gateway call");
    if (result instanceof Error) throw result;
    return typeof result === "function" ? result(input) : result;
  }) };
  return { calls, gateway, host: { gateway, capabilities: { tools: [{ name: "documents.read", description: "Read authorized documents." }] } } };
}

describe("provider-neutral Skill Creator service", () => {
  it("sends trusted tenant/actor/route context and maintained policy, returning editable content with honest usage provenance", async () => {
    const { calls, host } = setup(response());
    const result = await generateSkill(ctx, request, { ...host, attribution: { interactionId: "interaction-7", requestId: "request-7" } });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ tenantId: ctx.tenantId, tenantSlug: ctx.tenantSlug, routing: { requestedRoute: request.modelRoute, taskType: "agent.author" }, attribution: { billingAccountId: ctx.tenantId, actorType: "user", actorId: ctx.userId, productSurface: "skill-builder", interactionId: "interaction-7", requestId: "request-7" } });
    expect(calls[0]!.routing?.bypassTaskPolicy).toBeUndefined();
    expect(calls[0]!.provider).toBeUndefined();
    expect(calls[0]!.model).toBeUndefined();
    expect(calls[0]!.tools).toBeUndefined();
    expect(calls[0]!.messages[0]!.content).toContain(loadSkillCreatorPolicy().instructions);
    expect(GenerateSkillResponseSchema.parse(result)).toEqual(result);
    expect(result.bundle.files[0]!.content).toBe(document);
    expect(result.provenance).toMatchObject({ requestedRoute: request.modelRoute, tenantId: ctx.tenantId, actorId: ctx.userId, creatorPolicyDigest: loadSkillCreatorPolicy().contentDigest, baseFingerprint: null, outputDigest: skillBundleDigest(result.bundle), tokensIn: 100, tokensOut: 80 });
    expect(result.provenance.attempts[0]).toMatchObject({ provider: "deepseek", model: "deepseek-served-version", tokensIn: 100, tokensOut: 80 });
    expect(result.suggestedTests).toEqual(output.suggestedTests);
  });

  it("pins the default creator and repair to Pro without falling through to general tenant routing", async () => {
    const { calls, host } = setup(response({ provider: "openrouter", model: "openai/gpt-5.6-sol-pro", text: "invalid JSON" }), response({ provider: "openrouter", model: "openai/gpt-5.6-sol-pro" }));
    const result = await generateSkill(ctx, { purpose: request.purpose }, host);
    expect(calls).toHaveLength(2);
    for (const call of calls) {
      expect(call.routing?.requestedRoute).toBe(SKILL_CREATOR_DEFAULT_MODEL_ROUTE);
      expect(call.reasoning).toEqual({ effort: "high" });
      expect(call.maxTokens).toBe(SKILL_GENERATION_LIMITS.maxProOutputTokens);
      expect(call.timeoutMs).toBe(SKILL_GENERATION_LIMITS.proTimeoutMs);
    }
    expect(result.provenance.requestedRoute).toBe(SKILL_CREATOR_DEFAULT_MODEL_ROUTE);
    expect(result.provenance.attempts[0]!.model).toBe("openai/gpt-5.6-sol-pro");
  });

  it("fails visibly on unconfirmed Pro or unavailable default gateway without making a fallback call", async () => {
    const unconfirmed = setup(response({ provider: "openai", model: "standard-model" }));
    await expect(generateSkill(ctx, { purpose: request.purpose }, unconfirmed.host)).rejects.toMatchObject({ code: "pro_model_unconfirmed" });
    expect(unconfirmed.calls).toHaveLength(1);
    const failure = new Error("Pro gateway credential unavailable");
    const unavailable = setup(failure);
    await expect(generateSkill(ctx, { purpose: request.purpose }, unavailable.host)).rejects.toBe(failure);
    expect(unavailable.calls).toHaveLength(1);
  });

  it("accepts provider-reported native Pro mode while preserving the served model identity", async () => {
    const { host } = setup(response({ provider: "openai", model: "gpt-6-astra", reasoning: { mode: "pro" }, raw: { reasoning: { mode: "pro" } } }));
    const result = await generateSkill(ctx, { purpose: request.purpose }, host);
    expect(result.provenance.attempts[0]!.model).toBe("gpt-6-astra");
    expect(result.provenance.attempts[0]!.reasoning?.mode).toBe("pro");
    expect(result.provenance.attempts[0]!.reportedReasoningMode).toBe("pro");
  });

  it("does not mistake echoed requested controls for provider-confirmed Pro mode", async () => {
    for (const raw of [undefined, {}, { model: "gpt-6-astra", reasoning: { mode: "standard" } }]) {
      const { calls, host } = setup(response({ provider: "openai", model: "openai/gpt-5.6-sol-pro", reasoning: { mode: "pro" }, raw }));
      await expect(generateSkill(ctx, { purpose: request.purpose }, host)).rejects.toMatchObject({ code: "pro_model_unconfirmed" });
      expect(calls).toHaveLength(1);
    }
  });

  it("requires a Pro default configuration while honoring deliberate non-Pro editor choices", () => {
    expect(skillCreatorModelPolicy(undefined, {})).toMatchObject({ route: SKILL_CREATOR_DEFAULT_MODEL_ROUTE, requirePro: true, pro: true });
    expect(() => skillCreatorModelPolicy(undefined, { SKILL_CREATOR_MODEL_ROUTE: "openai/gpt-6-astra" })).toThrow(/Pro model/);
    expect(skillCreatorModelPolicy(undefined, { SKILL_CREATOR_MODEL_ROUTE: "openai/gpt-6-astra", SKILL_CREATOR_REASONING_MODE: "pro" })).toMatchObject({ route: "openai/gpt-6-astra", reasoning: { effort: "high", mode: "pro" } });
    expect(() => skillCreatorModelPolicy(undefined, { SKILL_CREATOR_REASONING_MODE: "standard" })).toThrow(/must be pro/);
    expect(skillCreatorModelPolicy(request.modelRoute, { SKILL_CREATOR_REASONING_MODE: "bad" })).toMatchObject({ route: request.modelRoute, requirePro: false, pro: false, reasoning: undefined });
  });

  it("preserves token credential attribution when the authenticated token has no linked user", async () => {
    const { calls, host } = setup(response());
    const result = await generateSkill({ ...ctx, via: "token", userId: null, credentialId: "cred-api" }, request, host);
    expect(calls[0]!.attribution).toMatchObject({ actorType: "api_token", actorId: "cred-api", credentialId: "cred-api" });
    expect(result.provenance.actorId).toBe("cred-api");
  });

  it("repairs malformed output exactly once on the same route and accounts for both responses", async () => {
    const { calls, host } = setup(response({ text: "not JSON" }), response({ tokensIn: 120, tokensOut: 90 }));
    const result = await generateSkill(ctx, request, host);
    expect(calls).toHaveLength(2);
    expect(calls.map((call) => call.routing?.taskType)).toEqual(["agent.author", "output.repair"]);
    expect(calls.map((call) => call.routing?.requestedRoute)).toEqual([request.modelRoute, request.modelRoute]);
    expect(calls[1]!.messages.at(-1)!.content).toContain("not JSON");
    expect(result.provenance).toMatchObject({ tokensIn: 220, tokensOut: 170 });
    expect(result.provenance.attempts).toHaveLength(2);
  });

  it("fails after one unsuccessful schema/package repair without returning a fallback skill", async () => {
    const { calls, host } = setup(response({ text: "not JSON" }), response({ text: JSON.stringify({ ...output, files: [{ path: "SKILL.md", encoding: "utf8", content: "Missing metadata" }] }) }));
    await expect(generateSkill(ctx, request, host)).rejects.toMatchObject({ code: "invalid_output", attempts: expect.any(Array) });
    expect(calls).toHaveLength(2);
  });

  it("propagates a provider failure unchanged and makes no repair/fallback call", async () => {
    const failure = new Error("Provider is not configured for this tenant");
    const { calls, host } = setup(failure);
    await expect(generateSkill(ctx, request, host)).rejects.toBe(failure);
    expect(calls).toHaveLength(1);
  });

  it("propagates repair provider failures unchanged and retains no synthesized result", async () => {
    const failure = new Error("Provider quota exhausted");
    const { calls, host } = setup(response({ text: "invalid" }), failure);
    await expect(generateSkill(ctx, request, host)).rejects.toBe(failure);
    expect(calls).toHaveLength(2);
  });

  it("rejects mock results, tool calls and model-reported errors without execution or repair", async () => {
    for (const result of [response({ provider: "mock" }), response({ toolCalls: [{ id: "call-1", name: "shell.execute", input: { command: "touch /tmp/forbidden" } }] }), response({ finishReason: "error" })]) {
      const { calls, host } = setup(result);
      await expect(generateSkill(ctx, request, host)).rejects.toBeInstanceOf(SkillGenerationError);
      expect(calls).toHaveLength(1);
      expect(calls[0]!.tools).toBeUndefined();
    }
  });

  it("passes cancellation through to the gateway and never starts a repair after cancellation", async () => {
    const controller = new AbortController();
    const cancelled = new Error("User cancelled generation");
    const { calls, host } = setup(async (call) => {
      expect(call.signal).toBe(controller.signal);
      controller.abort(cancelled);
      return response({ text: "invalid" });
    });
    await expect(generateSkill(ctx, request, { ...host, signal: controller.signal })).rejects.toBe(cancelled);
    expect(calls).toHaveLength(1);
    const next = setup(response());
    await expect(generateSkill(ctx, request, { ...next.host, signal: controller.signal })).rejects.toBe(cancelled);
    expect(next.calls).toHaveLength(0);
  });

  it("retains unknown token usage as null instead of pretending it was zero", async () => {
    const { host } = setup(response({ text: "invalid", tokensIn: null, tokensOut: null }), response());
    const result = await generateSkill(ctx, request, host);
    expect(result.provenance.tokensIn).toBeNull();
    expect(result.provenance.tokensOut).toBeNull();
    expect(result.provenance.attempts[1]!.tokensIn).toBe(100);
  });

  it("preserves omitted binary and text resources, supplying binary metadata only and allowing repair of unfinished drafts", async () => {
    const { calls, host } = setup(response());
    const binary = { path: "assets/template.bin", encoding: "base64" as const, content: Buffer.alloc(100_000, 0xff).toString("base64") };
    const baseBundle: SkillBundle = { files: [{ path: "SKILL.md", encoding: "utf8", content: "An unfinished draft." }, binary, { path: "references/rules.md", encoding: "utf8", content: "Follow the supplied reporting date." }] };
    const result = await generateSkill(ctx, request, { ...host, baseBundle });
    expect(result.bundle.files.find((file) => file.path === binary.path)).toEqual(binary);
    expect(result.bundle.files.find((file) => file.path === "references/rules.md")).toEqual(baseBundle.files[2]);
    const prompt = calls[0]!.messages[1]!.content as string;
    expect(prompt).toContain("An unfinished draft.");
    expect(prompt).not.toContain(binary.content);
    expect(JSON.parse(prompt).existingFiles.find((file: { path: string }) => file.path === binary.path)).toMatchObject({ contentType: "binary", contentIncluded: false, bytes: 100_000 });
    expect(result.provenance.baseFingerprint).toMatch(/^[a-f0-9]{64}$/);
    baseBundle.files[1]!.content = "changed";
    expect(decodeSkillFile(result.bundle.files.find((file) => file.path === binary.path)!)[0]).toBe(0xff);
  });

  it.each(["binary", "binary-ascii", "large-text"])("prevents silently replacing excluded %s resources", async (kind) => {
    const protectedFile = kind.startsWith("binary")
      ? { path: "assets/protected", content: kind === "binary" ? "/w==" : Buffer.from("%PDF-ASCII-but-declared-binary").toString("base64"), encoding: "base64" as const }
      : { path: "references/protected", content: "r".repeat(SKILL_GENERATION_LIMITS.maxResourceTextBytes + 1), encoding: "utf8" as const };
    const bad = response({ text: JSON.stringify({ ...output, files: [...output.files, { path: protectedFile.path, content: "replacement", encoding: "utf8" }] }) });
    const { calls, host } = setup(bad, response());
    const result = await generateSkill(ctx, request, { ...host, baseBundle: { files: [{ path: "SKILL.md", content: document, encoding: "utf8" }, protectedFile] } });
    expect(calls).toHaveLength(2);
    expect(calls[1]!.messages.at(-1)!.content).toContain("Cannot replace");
    expect(result.bundle.files.find((file) => file.path === protectedFile.path)).toEqual(protectedFile);
  });

  it("requires complete SKILL.md context and fails visibly before dispatch if it cannot fit", async () => {
    const { calls, host } = setup(response());
    await expect(generateSkill(ctx, request, { ...host, baseBundle: { files: [{ path: "SKILL.md", content: document + "x".repeat(SKILL_GENERATION_LIMITS.maxBaseTextBytes), encoding: "utf8" }] } })).rejects.toMatchObject({ code: "context_too_large" });
    expect(calls).toHaveLength(0);
  });

  it("bounds overall prompt context and repair excerpts without sending multi-megabyte model output back", async () => {
    const oversized = setup(response());
    await expect(generateSkill(ctx, request, { ...oversized.host, capabilities: { tools: Array.from({ length: 200 }, (_, index) => ({ name: `tool-${index}`, description: "d".repeat(1000) })) } })).rejects.toMatchObject({ code: "context_too_large" });
    expect(oversized.calls).toHaveLength(0);
    const { calls, host } = setup(response({ text: "x".repeat(SKILL_GENERATION_LIMITS.maxOutputBytes + 1) }), response());
    await generateSkill(ctx, request, host);
    expect(calls).toHaveLength(2);
    for (const call of calls) expect(Buffer.byteLength(JSON.stringify(call.messages))).toBeLessThanOrEqual(SKILL_GENERATION_LIMITS.maxPromptBytes);
    const repair = JSON.parse(calls[1]!.messages.at(-1)!.content as string);
    expect(Buffer.byteLength(repair.previousOutputExcerpt)).toBeLessThanOrEqual(SKILL_GENERATION_LIMITS.maxRepairExcerptBytes);
    expect(repair.previousOutputTruncated).toBe(true);
  });

  it("keeps unavailable capability claims as disclosures and preserves scripts as unexecuted resources", async () => {
    const claimed = { ...output, files: [{ path: "SKILL.md", encoding: "utf8", content: document.replace("---\nRead", "allowed-tools: shell.execute\n---\nRead") }, { path: "scripts/report.py", encoding: "utf8", content: "raise Exception('must not run')\n" }] };
    const { calls, host } = setup(response({ text: JSON.stringify(claimed) }));
    const result = await generateSkill(ctx, request, host);
    expect(result.assumptions.join(" ")).toContain("shell.execute");
    expect(result.assumptions.join(" ")).toContain("no confirmed script execution route");
    expect(result.diagnostics.map((issue) => issue.code)).toContain("scripts_unexecuted");
    expect(calls).toHaveLength(1);
    expect(result.bundle.files.find((file) => file.path === "scripts/report.py")!.content).toBe(claimed.files[1]!.content);
  });

  it("rejects spoofed capability, base bundle, provider and tenant fields in request bodies", async () => {
    const { calls, host } = setup(response());
    for (const field of ["capabilities", "baseBundle", "provider", "tenantId"]) {
      await expect(generateSkill(ctx, { ...request, [field]: "spoofed" }, host)).rejects.toThrow();
    }
    expect(calls).toHaveLength(0);
  });

  it("uses stable byte-based base fingerprints and changes request digests when trusted inputs change", async () => {
    const first = setup(response());
    const second = setup(response());
    const third = setup(response());
    const baseBundle: SkillBundle = { files: [{ path: "SKILL.md", content: document, encoding: "utf8" }] };
    const a = await generateSkill(ctx, request, { ...first.host, baseBundle });
    const b = await generateSkill(ctx, request, { ...second.host, baseBundle: { files: [{ path: "SKILL.md", content: Buffer.from(document).toString("base64"), encoding: "base64" }] } });
    const c = await generateSkill(ctx, { ...request, purpose: "Create a different report skill." }, { ...third.host, baseBundle });
    expect(a.provenance.baseFingerprint).toBe(b.provenance.baseFingerprint);
    expect(a.provenance.requestDigest).toBe(b.provenance.requestDigest);
    expect(c.provenance.requestDigest).not.toBe(a.provenance.requestDigest);
  });
});
