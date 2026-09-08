import { afterEach, describe, expect, it, vi } from "vitest";
import {
  flattenContentToText,
  type ChatMessage,
  type ChatRequest,
  type DocumentBlock,
  type ImageBlock,
} from "@agentic/llm-gateway";
import {
  createOpenAICompatibleAdapter,
  mapOpenAICompatibleMessages,
} from "../../../packages/llm-gateway/src/adapters/openai-compatible";
import {
  buildOpenAIResponsesRequest,
  createOpenAIResponsesAdapter,
} from "../../../packages/llm-gateway/src/adapters/openai-responses";
import {
  createAnthropicAdapter,
  mapAnthropicRequest,
} from "../../../packages/llm-gateway/src/adapters/anthropic";
import {
  createGeminiAdapter,
  mapGeminiGenerateContentRequest,
} from "../../../packages/llm-gateway/src/adapters/gemini";
import { createAzureAdapter } from "../../../packages/llm-gateway/src/adapters/azure";
import { MockAdapter } from "../../../packages/llm-gateway/src/adapters/mock";

const image: ImageBlock = {
  type: "image",
  mimeType: "image/png",
  data: "aW1hZ2U=",
};
const document: DocumentBlock = {
  type: "document",
  mimeType: "application/pdf",
  name: "requirements.pdf",
  data: "JVBERi0xLjcK",
};
const request: ChatRequest = {
  messages: [
    { role: "system", content: "Extract the user's attached requirements." },
    {
      role: "user",
      content: [
        { type: "text", text: "Compare these files." },
        image,
        document,
      ],
    },
  ],
  maxTokens: 1024,
};

afterEach(() => vi.unstubAllGlobals());

/** Capture the bytes after SDK serialization; never dispatch a paid request. */
function captureWire(response: unknown) {
  const bodies: Record<string, unknown>[] = [];
  const fetch = vi.fn(
    async (input: string | URL | Request, init?: RequestInit) => {
      const body =
        init?.body ??
        (input instanceof Request ? await input.text() : undefined);
      bodies.push(JSON.parse(String(body)) as Record<string, unknown>);
      return new Response(JSON.stringify(response), {
        headers: { "content-type": "application/json" },
      });
    },
  );
  vi.stubGlobal("fetch", fetch);
  return { bodies, fetch };
}

describe("uploaded media reaches provider request bodies", () => {
  it.each(["openai", "openrouter", "custom"] as const)(
    "preserves text, image bytes, and PDF name/bytes on %s chat",
    async (id) => {
      const { bodies, fetch } = captureWire({
        id: "chat-1",
        model: "vision-model",
        choices: [{ message: { content: "Parsed" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 30, completion_tokens: 5, total_tokens: 35 },
      });
      const adapter = createOpenAICompatibleAdapter({
        id,
        name: id,
        apiKey: "test-key",
        baseURL: "https://provider.test/v1",
        defaultModel: "vision-model",
        fetch,
      });
      expect((await adapter.chat(request)).text).toBe("Parsed");
      expect(bodies).toHaveLength(1);
      expect(bodies[0]?.messages).toEqual([
        request.messages[0],
        {
          role: "user",
          content: [
            { type: "text", text: "Compare these files." },
            {
              type: "image_url",
              image_url: { url: "data:image/png;base64,aW1hZ2U=" },
            },
            {
              type: "file",
              file: {
                filename: "requirements.pdf",
                file_data: "data:application/pdf;base64,JVBERi0xLjcK",
              },
            },
          ],
        },
      ]);
    },
  );

  it("preserves media through the OpenAI Responses SDK", async () => {
    const { bodies, fetch } = captureWire({
      id: "resp-1",
      model: "vision-model",
      status: "completed",
      output: [
        {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "Parsed", annotations: [] }],
        },
      ],
      usage: { input_tokens: 30, output_tokens: 5, total_tokens: 35 },
    });
    const adapter = createOpenAIResponsesAdapter({
      id: "openai",
      name: "OpenAI",
      apiKey: "test-key",
      baseURL: "https://provider.test/v1",
      defaultModel: "vision-model",
      fetch,
    });
    expect((await adapter.chat(request)).text).toBe("Parsed");
    expect(bodies).toHaveLength(1);
    expect(bodies[0]?.input).toEqual([
      request.messages[0],
      {
        role: "user",
        content: [
          { type: "input_text", text: "Compare these files." },
          {
            type: "input_image",
            image_url: "data:image/png;base64,aW1hZ2U=",
            detail: "auto",
          },
          {
            type: "input_file",
            filename: "requirements.pdf",
            file_data: "data:application/pdf;base64,JVBERi0xLjcK",
          },
        ],
      },
    ]);
    expect(bodies[0]?.store).toBe(false);
  });

  it("preserves native Anthropic image and PDF sources through its SDK", async () => {
    const { bodies } = captureWire({
      id: "msg-1",
      type: "message",
      role: "assistant",
      model: "claude-haiku-4-5",
      content: [{ type: "text", text: "Parsed" }],
      stop_reason: "end_turn",
      stop_sequence: null,
      usage: { input_tokens: 30, output_tokens: 5 },
    });
    const adapter = createAnthropicAdapter({ apiKey: "test-key" });
    expect((await adapter.chat(request)).text).toBe("Parsed");
    expect(bodies).toHaveLength(1);
    expect(bodies[0]?.messages).toEqual([
      {
        role: "user",
        content: [
          { type: "text", text: "Compare these files." },
          {
            type: "image",
            source: {
              type: "base64",
              media_type: "image/png",
              data: image.data,
            },
          },
          {
            type: "document",
            title: document.name,
            source: {
              type: "base64",
              media_type: "application/pdf",
              data: document.data,
            },
          },
        ],
      },
    ]);
  });

  it("preserves Gemini inline image and PDF bytes through its SDK", async () => {
    const { bodies } = captureWire({
      candidates: [
        {
          content: { role: "model", parts: [{ text: "Parsed" }] },
          finishReason: "STOP",
        },
      ],
      usageMetadata: {
        promptTokenCount: 30,
        candidatesTokenCount: 5,
        totalTokenCount: 35,
      },
    });
    const adapter = createGeminiAdapter({ apiKey: "test-key" });
    expect((await adapter.chat(request)).text).toBe("Parsed");
    expect(bodies).toHaveLength(1);
    expect(bodies[0]?.contents).toEqual([
      {
        role: "user",
        parts: [
          { text: "Compare these files." },
          { inlineData: { mimeType: image.mimeType, data: image.data } },
          { inlineData: { mimeType: document.mimeType, data: document.data } },
        ],
      },
    ]);
  });
});

describe("media inputs fail explicitly when unsupported", () => {
  it.each(["system", "assistant", "tool"] as const)(
    "rejects media on %s messages in every supported projector",
    (role) => {
      const messages: ChatMessage[] = [{ role, content: [image] }];
      const req = { messages };
      for (const project of [
        () => mapOpenAICompatibleMessages(messages),
        () => buildOpenAIResponsesRequest(req, "vision-model"),
        () => mapAnthropicRequest(req, "claude-haiku-4-5"),
        () => mapGeminiGenerateContentRequest(req, "gemini-3.5-flash"),
      ]) {
        expect(project).toThrow("require a user message");
      }
    },
  );

  it("rejects Azure and mock media before any provider dispatch", async () => {
    const { fetch } = captureWire({});
    const adapters = [
      new MockAdapter(),
      createAzureAdapter({
        apiKey: "test-key",
        endpoint: "https://provider.test",
        apiVersion: "2024-10-21",
        defaultDeployment: "vision-model",
      }),
    ];
    for (const adapter of adapters) {
      await expect(adapter.chat(request)).rejects.toMatchObject({
        code: "bad_request",
        provider: adapter.id,
        message: `${adapter.id} adapter does not support image or document inputs`,
      });
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it("prevents legacy text flattening from silently discarding media", () => {
    expect(() => flattenContentToText([image])).toThrow("cannot be flattened");
    expect(() => flattenContentToText([document])).toThrow(
      "cannot be flattened",
    );
    expect(flattenContentToText([{ type: "text", text: "Unchanged" }])).toBe(
      "Unchanged",
    );
  });
});
