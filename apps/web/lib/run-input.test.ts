import { afterEach, describe, expect, it, vi } from "vitest";
import { RUN_INPUT_MAX_FILE_BYTES } from "@agentic/contracts";
import { buildRunInputContext, parseRunInputFile, runInputFileType, runInputPrompt } from "./run-input";

const attachment = {
  id: "input-1", name: "notes.txt", mimeType: "text/plain", size: 5,
  text: "Reviewed notes",
};

afterEach(() => vi.unstubAllGlobals());

describe("run input submission", () => {
  it("supplies an explicit instruction for attachment-only runs while preserving authored prompts", () => {
    expect(runInputPrompt("  ", [attachment], "Use the attached files.")).toBe("Use the attached files.");
    expect(runInputPrompt(" Keep my spacing\n", [attachment], "Use the attached files.")).toBe(" Keep my spacing\n");
    expect(runInputPrompt("", undefined, "Use the attached files.")).toBe("");
    expect(runInputPrompt("", [{ ...attachment, text: "  " }], "Use the attached files.")).toBe("");
  });
  it("omits empty optional input and trims the named memory session", () => {
    expect(buildRunInputContext(" ", "", " ", [])).toBeUndefined();
    expect(buildRunInputContext(" Read notes ", " New client ", " client-1 ", [attachment]))
      .toEqual({ prompt: "Read notes", context: "New client", contextKey: "client-1", attachments: [attachment] });
  });

  it("rejects excessive combined text without discarding reviewed attachments", () => {
    expect(() => buildRunInputContext("p".repeat(32_000), "c".repeat(32_000), "",
      [{ ...attachment, text: "a".repeat(32_000) }, { ...attachment, id: "input-2", text: "b".repeat(10_000) }]))
      .toThrow(/100000/);
  });

  it("uses supported extensions when browsers omit or generalize the MIME type", () => {
    expect(runInputFileType({ name: "PHOTO.JPG", type: "" })).toBe("image/jpeg");
    expect(runInputFileType({ name: "notes.md", type: "application/octet-stream" })).toBe("text/markdown");
    expect(runInputFileType({ name: "slides.pptx", type: "application/octet-stream" })).toBeNull();
    expect(runInputFileType({ name: "unsafe.exe", type: "text/plain" })).toBeNull();
  });
});

describe("file parsing request", () => {
  it("sends binary-safe base64 under the URL tenant and returns editable parsed text", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true, data: attachment }), {
      status: 200, headers: { "Content-Type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetch);
    vi.stubGlobal("window", { location: { pathname: "/portal/acme/agents" } });
    const signal = new AbortController().signal;
    const file = new File([new Uint8Array([0, 128, 255, 10])], "photo.png", { type: "image/png" });
    expect(await parseRunInputFile(file, signal)).toEqual(attachment);
    const [path, options] = fetch.mock.calls[0]!;
    expect(path).toBe("/v1/run-inputs/parse");
    expect(options.headers["x-agentic-tenant"]).toBe("acme");
    expect(options.credentials).toBe("same-origin");
    expect(options.signal).toBe(signal);
    expect(JSON.parse(options.body)).toEqual({ name: "photo.png", mimeType: "image/png", base64: "AID/Cg==" });
  });

  it("rejects oversized and unsupported files before reading or uploading them", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const arrayBuffer = vi.fn();
    await expect(parseRunInputFile({ name: "large.pdf", type: "application/pdf", size: RUN_INPUT_MAX_FILE_BYTES + 1, arrayBuffer } as unknown as File))
      .rejects.toThrow(/8 MiB/);
    await expect(parseRunInputFile(new File(["binary"], "archive.zip")))
      .rejects.toThrow(/not supported/);
    expect(arrayBuffer).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("uses the selected Test Lab provider and model for file parsing", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true, data: attachment })));
    vi.stubGlobal("fetch", fetch);
    await parseRunInputFile(new File(["notes"], "notes.txt"), undefined, { provider: "openai", model: "gpt-4o" });
    expect(JSON.parse(fetch.mock.calls[0]![1].body)).toMatchObject({ provider: "openai", model: "gpt-4o" });
  });

  it("rejects an unverified parser response and preserves explicit server errors", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, data: { id: "incomplete" } })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: false, error: { code: "MODEL_UNAVAILABLE", message: "No vision model configured" } }), { status: 503 }));
    vi.stubGlobal("fetch", fetch);
    const file = new File(["notes"], "notes.txt");
    await expect(parseRunInputFile(file)).rejects.toThrow();
    await expect(parseRunInputFile(file)).rejects.toThrow(/No vision model configured/);
  });

  it("does not upload after a removed file's request is aborted", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const controller = new AbortController();
    controller.abort();
    await expect(parseRunInputFile(new File(["notes"], "notes.txt"), controller.signal))
      .rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
});
