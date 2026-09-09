import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { events, getDb } from "@agentic/db";
import {
  RUN_INPUT_MAX_ATTACHMENT_TEXT_CHARS,
  RUN_INPUT_MAX_TEXT_CHARS,
} from "@agentic/contracts";
import { getTenantInngest } from "@agentic/runtime";
import { buildTestEnv, type TestEnv } from "./harness";
import { resolvePayloadRef } from "../src/queries/runs";

const runInput = {
  prompt: "Review the invoice",
  context: "Currency: SGD",
  contextKey: "invoice-review",
  attachments: [
    {
      id: "attachment-reviewed",
      name: "invoice.pdf",
      mimeType: "application/pdf",
      size: 10,
      text: "Invoice INV-9 total 91 SGD",
    },
  ],
};
const markdownEnding = "\n## Final finding\nLarge attachment ending survives replay.";
const largeMarkdown = "# Research evidence\n\n- Reviewed source material.\n"
  .repeat(5_000)
  .slice(0, 200_000 - markdownEnding.length) + markdownEnding;
const largeRunInput = {
  ...runInput,
  attachments: [{
    id: "attachment-large-markdown",
    name: "research-evidence.md",
    mimeType: "text/markdown",
    size: Buffer.byteLength(largeMarkdown),
    text: largeMarkdown,
  }],
};

describe("run input dispatch and replay", () => {
  let env: TestEnv;
  const eventIds: string[] = [];
  beforeAll(async () => {
    env = await buildTestEnv();
  });
  afterAll(async () => {
    vi.restoreAllMocks();
    for (const id of eventIds)
      getDb().delete(events).where(eq(events.id, id)).run();
    await env.cleanup();
  });

  it.each([
    ["reviewed input", runInput],
    ["200,000-character Markdown including its final finding", largeRunInput],
  ])("preserves %s in the event ledger, broker delivery, and replay", async (_name, runInput) => {
    const send = vi
      .spyOn(getTenantInngest("__system"), "send")
      .mockResolvedValue({ ids: ["accepted"] } as never);
    try {
      const response = await env.fetch("/v1/events", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "RUN_INPUT_REVIEW",
          subject: "invoice-9",
          payload: { prompt: "Review" },
          runInput,
        }),
      });
      expect(response.status, await response.clone().text()).toBe(200);
      const { data } = (await response.json()) as {
        data: { event_id: string };
      };
      eventIds.push(data.event_id);
      expect(send.mock.calls[0]?.[0]).toMatchObject({
        data: { __runInput: runInput },
      });
      const event = getDb()
        .select()
        .from(events)
        .where(eq(events.id, data.event_id))
        .all()[0]!;
      expect(
        await resolvePayloadRef(event.payloadRef!, Number.POSITIVE_INFINITY),
      ).toMatchObject({ __runInput: runInput });
      const replay = await env.fetch(`/v1/events/${data.event_id}/replay`, {
        method: "POST",
      });
      expect(replay.status, await replay.clone().text()).toBe(200);
      const replayBody = (await replay.json()) as {
        data: { new_event_id: string };
      };
      eventIds.push(replayBody.data.new_event_id);
      expect(send.mock.calls[1]?.[0]).toMatchObject({
        data: { __runInput: runInput },
      });
      const replayEvent = getDb()
        .select()
        .from(events)
        .where(eq(events.id, replayBody.data.new_event_id))
        .all()[0]!;
      expect(
        await resolvePayloadRef(
          replayEvent.payloadRef!,
          Number.POSITIVE_INFINITY,
        ),
      ).toMatchObject({ __runInput: runInput });
    } finally {
      send.mockRestore();
    }
  });

  it("rejects private metadata injection and oversized parsed input before dispatch", async () => {
    const send = vi
      .spyOn(getTenantInngest("__system"), "send")
      .mockResolvedValue({ ids: ["accepted"] } as never);
    try {
      for (const body of [
        { name: "RUN_INPUT_REVIEW", payload: { __runInput: runInput } },
        { name: "RUN_INPUT_REVIEW", runInput: { prompt: "a".repeat(RUN_INPUT_MAX_TEXT_CHARS + 1) } },
        {
          name: "RUN_INPUT_REVIEW",
          runInput: {
            attachments: [{
              ...runInput.attachments[0],
              text: "a".repeat(RUN_INPUT_MAX_ATTACHMENT_TEXT_CHARS + 1),
            }],
          },
        },
      ]) {
        const response = await env.fetch("/v1/events", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        expect(response.status).toBe(400);
      }
      expect(send).not.toHaveBeenCalled();
    } finally {
      send.mockRestore();
    }
  });
});
