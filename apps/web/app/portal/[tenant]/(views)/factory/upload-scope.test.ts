import { afterEach, describe, expect, it, vi } from "vitest";
import { isFactoryUploadScopeCurrent, readScopedFactoryAttachments } from "./upload-scope";
const purchasing = "/portal/acme/domains/purchasing/factory";
afterEach(() => vi.unstubAllGlobals());

describe("Factory upload Domain continuation", () => {
  it("does not continue an upload after switching to a sibling while File.text is pending", async () => {
    const location = { pathname: purchasing };
    vi.stubGlobal("window", { location });
    let resolveText!: (text: string) => void;
    const pending = readScopedFactoryAttachments("acme", [{ name: "ontology.json", text: () => new Promise<string>((resolve) => { resolveText = resolve; }) }]);
    location.pathname = "/portal/acme/domains/sales/factory";
    resolveText('{"actions":[]}');
    expect(await pending).toBeNull();
  });
  it("retains the original explicit Domain headers and rejects a subsequent scope change", async () => {
    const location = { pathname: purchasing };
    vi.stubGlobal("window", { location });
    const result = await readScopedFactoryAttachments("acme", [{ name: "ontology.json", text: async () => "{}" }]);
    expect(result?.scope.headers).toEqual({ "x-agentic-tenant": "acme", "x-agentic-domain": "purchasing" });
    location.pathname = "/portal/acme/domains/sales/factory";
    expect(isFactoryUploadScopeCurrent(result!.scope)).toBe(false);
    expect(result?.scope.headers["x-agentic-domain"]).toBe("purchasing");
  });
  it("preserves successful, empty and failed file-read diagnostics within the same Domain", async () => {
    vi.stubGlobal("window", { location: { pathname: purchasing } });
    const result = await readScopedFactoryAttachments("acme", [
      { name: "ontology.json", text: async () => "{}" },
      { name: "empty.json", text: async () => "" },
      { name: "failed.json", text: async () => { throw new Error("unreadable"); } },
    ]);
    expect(result).toMatchObject({ snaps: [{ name: "ontology.json", text: "{}" }], emptyFiles: ["empty.json"], readFailures: ["failed.json"] });
  });
});
