import { afterAll, describe, expect, it, vi } from "vitest";
import {
  ParseRunInputBodySchema,
  RunInputContextSchema,
} from "@agentic/contracts";
import {
  LLMGateway,
  type ChatRequest,
  type ChatResponse,
} from "@agentic/llm-gateway";
import {
  decodeRunInputFile,
  parseRunInputFile,
} from "../src/services/run-input-parser";
import { _setLLMGatewayForTests } from "../src/services/llm";
import { buildTestEnv } from "./harness";

const upload = (
  text = "Invoice total: 42",
  name = "invoice.txt",
  mimeType = "text/plain",
) =>
  ParseRunInputBodySchema.parse({
    name,
    mimeType,
    base64: Buffer.from(text).toString("base64"),
  });
const response = (text = "Invoice total: 42", finishReason = "stop") =>
  ({
    text,
    finishReason,
    provider: "custom",
    model: "capture",
    tokensIn: 10,
    tokensOut: 5,
  }) as ChatResponse;

afterAll(() => _setLLMGatewayForTests(null));

describe("uploaded run input", () => {
  it("rejects a mock provider selected by routing or fallback", async () => {
    await expect(parseRunInputFile(upload(), "tenant-a", {
      chat: async () => ({ ...response(), provider: "mock" }),
    })).rejects.toThrow(/real model provider/);
  });
  it("parses source with tenant-attributed gateway and returns editable text without raw bytes", async () => {
    const chat = vi.fn(async (_request: ChatRequest) => response());
    const result = await parseRunInputFile(upload(), "tenant-a", { chat });
    expect(result).toMatchObject({
      name: "invoice.txt",
      text: "Invoice total: 42",
      mimeType: "text/plain",
      size: 17,
    });
    expect(result.id).toMatch(/^attachment-[a-f0-9]{64}$/);
    expect(result).not.toHaveProperty("base64");
    expect(chat.mock.calls[0]![0]).toMatchObject({
      tenantId: "tenant-a",
      purpose: "run-input:parse-file",
    });
    expect(JSON.stringify(chat.mock.calls[0]![0].messages[1])).toContain(
      "Invoice total: 42",
    );
  });

  it.each([
    [
      "picture.png",
      "image/png",
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      "image",
    ],
    ["picture.jpg", "image/jpeg", Buffer.from([255, 216, 255, 224]), "image"],
    ["picture.gif", "image/gif", Buffer.from("GIF89a"), "image"],
    ["picture.webp", "image/webp", Buffer.from("RIFFxxxxWEBP"), "image"],
    ["scan.pdf", "application/pdf", Buffer.from("%PDF-1.7"), "document"],
  ])("sends %s as native media", async (name, mimeType, bytes, type) => {
    const body = ParseRunInputBodySchema.parse({
      name,
      mimeType,
      base64: bytes.toString("base64"),
    });
    const chat = vi.fn(async (_request: ChatRequest) =>
      response("Extracted source"),
    );
    await parseRunInputFile(body, "tenant-b", { chat });
    expect(chat.mock.calls[0]![0].messages[1]!.content).toContainEqual(
      expect.objectContaining({ type, mimeType, data: body.base64 }),
    );
  });

  it.each([
    { ...upload(), base64: "%%%%" },
    { ...upload(), name: "../secret.txt" },
    { ...upload(), name: "renamed.pdf", mimeType: "application/pdf" },
    { ...upload(), mimeType: "image/png" },
    { ...upload(), name: "program.exe" },
    { ...upload(), base64: Buffer.from([0xff]).toString("base64") },
    { ...upload(), base64: Buffer.from("binary\0file").toString("base64") },
  ])("rejects malformed files before a model call", async (body) => {
    const chat = vi.fn();
    await expect(
      parseRunInputFile(body, "tenant-a", { chat }),
    ).rejects.toThrow();
    expect(chat).not.toHaveBeenCalled();
  });

  it("rejects oversized source text and upload bodies", () => {
    expect(() => decodeRunInputFile(upload("a".repeat(128_001)))).toThrow(
      /128,000/,
    );
    expect(
      ParseRunInputBodySchema.safeParse({
        ...upload(),
        base64: "a".repeat(12_000_000),
      }).success,
    ).toBe(false);
  });

  it("accepts a maximum-size media upload without overflowing the validator stack", () => {
    const bytes = Buffer.alloc(8 * 1024 * 1024);
    bytes.write("%PDF-1.7");
    const body = ParseRunInputBodySchema.parse({
      name: "large.pdf",
      mimeType: "application/pdf",
      base64: bytes.toString("base64"),
    });
    expect(decodeRunInputFile(body).bytes.length).toBe(bytes.length);
  });

  it.each([
    ["", "stop"],
    ["unfinished", "length"],
    ["a".repeat(32_001), "stop"],
  ])("does not silently accept incomplete extraction", async (text, reason) => {
    await expect(
      parseRunInputFile(upload(), "tenant-a", {
        chat: async () => response(text, reason),
      }),
    ).rejects.toThrow();
  });

  it("validates aggregate prompt budget and trims the explicit context key", () => {
    expect(
      RunInputContextSchema.parse({ contextKey: " session-a " }).contextKey,
    ).toBe("session-a");
    const attachment = {
      id: "file",
      name: "file.txt",
      mimeType: "text/plain",
      size: 1,
      text: "a".repeat(32_000),
    };
    expect(
      RunInputContextSchema.safeParse({
        prompt: "a".repeat(32_000),
        attachments: [attachment, attachment, attachment],
      }).success,
    ).toBe(false);
    expect(
      RunInputContextSchema.safeParse({
        attachments: Array.from({ length: 6 }, () => ({
          ...attachment,
          text: "ok",
        })),
      }).success,
    ).toBe(false);
  });

  it("exposes parsing through the authenticated API envelope", async () => {
    const env = await buildTestEnv();
    const requests: ChatRequest[] = [];
    const gateway = new LLMGateway({
      defaultProvider: "custom",
      defaultModel: "capture",
      timeoutMs: 1_000,
    });
    gateway.registerProvider({
      id: "custom",
      name: "Capture",
      hasKey: true,
      defaultModel: "capture",
      async chat(request) {
        requests.push(request);
        return {
          text: "Reviewed invoice: 42",
          provider: "custom",
          model: "capture",
          tokensIn: 10,
          tokensOut: 5,
          raw: {},
        } as never;
      },
    });
    _setLLMGatewayForTests(gateway);
    const res = await env.fetch("/v1/run-inputs/parse", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(upload()),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      ok: true,
      data: { text: "Reviewed invoice: 42", name: "invoice.txt" },
    });
    expect(requests[0]!.tenantId).toBeTruthy();
    const bad = await env.fetch("/v1/run-inputs/parse", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...upload(), base64: "%%%%" }),
    });
    expect(bad.status).toBe(400);
    expect(requests).toHaveLength(1);
    await env.cleanup();
  });
});
