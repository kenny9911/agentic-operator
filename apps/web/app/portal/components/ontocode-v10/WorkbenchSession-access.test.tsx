import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiResponseError } from "@/lib/api-response";
import { translate } from "@/lib/i18n";

const state = vi.hoisted(() => ({ query: { isPending: false, isError: true, data: undefined as unknown, error: undefined as unknown } }));
vi.mock("next/navigation", () => ({
  useParams: () => ({ tenant: "acceptance", domain: "sales", sessionId: "ocs-from-purchasing" }),
  usePathname: () => "/portal/acceptance/domains/sales/ontocode-workspace/ocs-from-purchasing",
  useRouter: () => ({}), useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/app/portal/lib/preferences-context", () => ({ useI18n: () => ({ language: "en", t: (key: string) => translate("en", key) }) }));
vi.mock("@/lib/hooks/useOntoCodeWorkspace", async (importActual) => ({ ...await importActual<object>(), useOntoCodeSession: () => state.query }));
import { WorkbenchSessionConnected } from "./WorkbenchSession";
const render = () => renderToStaticMarkup(<WorkbenchSessionConnected />);

beforeEach(() => { state.query = { isPending: false, isError: true, data: undefined, error: undefined }; });

describe("native workbench requires a readable Domain-scoped Session", () => {
  it.each([403, 404])("shows a scoped return path for HTTP %s without mounting execution controls", (status) => {
    state.query.error = new ApiResponseError("/v1/ontocode/sessions/ocs-from-purchasing", status, "session_not_found", "");
    const html = render();
    expect(html).toContain('data-session-load-state="unavailable"');
    expect(html).toContain('href="/portal/acceptance/domains/sales/ontocode-workspace"');
    expect(html).toContain("sales");
    expect(html).not.toContain("Continue");
    expect(html).not.toContain("继续");
    expect(html).not.toContain("<textarea");
    expect(html).not.toContain("加载中");
  });
  it("does not mount the workbench during initial authorization", () => {
    state.query = { isPending: true, isError: false, data: undefined, error: undefined };
    const html = render();
    expect(html).toContain("Loading Build Session");
    expect(html).not.toContain("<button");
    expect(html).not.toContain("<textarea");
  });
  it("fails closed for an empty receipt and shows service errors distinctly", () => {
    state.query = { isPending: false, isError: false, data: {}, error: undefined };
    expect(render()).toContain('data-session-load-state="unavailable"');
    state.query.isError = true;
    state.query.error = new Error("unavailable");
    expect(render()).toContain('data-session-load-state="failed"');
  });
});
