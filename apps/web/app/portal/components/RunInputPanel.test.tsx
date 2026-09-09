import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { en } from "@/lib/i18n/en";
import type { RunInputEditor } from "@/lib/hooks/useRunInput";

vi.mock("@/app/portal/lib/preferences-context", () => ({
  useI18n: () => ({ t: (key: string) => key.split(".").reduce<unknown>((value, part) =>
    (value as Record<string, unknown>)[part], en) }),
}));

import { RunInputPanel } from "./RunInputPanel";

function editor(override: Partial<RunInputEditor> = {}): RunInputEditor {
  return {
    prompt: "Review the contract", context: "", contextKey: "",
    setPrompt: vi.fn(), setContext: vi.fn(), setContextKey: vi.fn(),
    files: [], addFiles: vi.fn(), removeFile: vi.fn(), editFile: vi.fn(), retryFile: vi.fn(),
    pending: false, blocked: false, value: undefined, error: null, ...override,
  };
}

describe("RunInputPanel", () => {
  it("offers accessible uploads, instructions and bounded memory controls", () => {
    const html = renderToStaticMarkup(<RunInputPanel editor={editor()} />);
    expect(html).toContain('type="file"');
    expect(html).toContain("multiple");
    expect(html).toContain('accept=".pdf,.png,.jpg,.jpeg,.gif,.webp,.txt,.md,.csv,.tsv,.json,.xml,.html,.htm,.log"');
    expect(html).toContain("Text files are read directly");
    expect(html).toContain("AI extracts text from PDFs and images");
    expect(html).toContain("Memory session name");
    expect(html).toContain("Draft and live memory are separate");
    expect(html).toContain("Review the contract");
  });

  it("renders parsed content as editable text and escapes document HTML", () => {
    const html = renderToStaticMarkup(<RunInputPanel editor={editor({ files: [{
      key: "file-1", file: new File(["notes"], "notes.txt"),
      parsed: { id: "input-1", name: "notes.txt", mimeType: "text/plain", size: 5, text: "<script>alert(1)</script>" },
    }] })} />);
    expect(html).toContain("Extracted text — edit before running");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("<script>");
  });

  it("shows parsing status, retryable errors and prevents changes during a run", () => {
    const files = [
      { key: "file-1", file: new File(["notes"], "notes.txt") },
      { key: "file-2", file: new File(["photo"], "photo.png"), error: "Vision model unavailable" },
    ];
    const html = renderToStaticMarkup(<RunInputPanel editor={editor({ files, pending: true, blocked: true })} disabled hidePrompt />);
    expect(html).toContain('role="status"');
    expect(html).toContain('role="alert"');
    expect(html).toContain("Vision model unavailable");
    expect(html).toContain("Retry parsing");
    expect(html).not.toContain("Review the contract");
    expect(html.match(/disabled=""/g)?.length).toBeGreaterThanOrEqual(6);
  });
});
