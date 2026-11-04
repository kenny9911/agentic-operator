import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { translate } from "@/lib/i18n";
import type { Language } from "@/lib/i18n/types";

const state = vi.hoisted(() => ({ language: "en" as Language, items: [] as unknown[] }));
vi.mock("@/app/portal/lib/preferences-context", () => ({
  useI18n: () => ({ language: state.language, t: (key: string) => translate(state.language, key) }),
}));
vi.mock("@/app/portal/lib/use-tenant", () => ({ useDomainSlug: () => "purchasing" }));
vi.mock("@/lib/portal-link", () => ({ default: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props}>{children}</a> }));
vi.mock("@/app/portal/components", () => ({ HelpTip: ({ children }: { children: React.ReactNode }) => <span>{children}</span> }));
vi.mock("@/lib/hooks/useBusinessOntologyDomains", () => ({ useBusinessOntologyDomains: () => ({ data: { items: state.items }, isPending: false, isError: false }) }));
vi.mock("@/lib/hooks/useOntoCodeWorkspace", () => ({
  useBootstrapOntoCodeSession: () => ({}), useCreateOntoCodeProject: () => ({}), useCreateOntoCodeSession: () => ({}),
  useOntoCodeProjects: () => ({ data: { items: [] }, isPending: false, isError: false }),
}));
import { CreateSessionPanel } from "./CreateSessionPanel";

beforeEach(() => { state.language = "en"; state.items = []; });
const render = () => renderToStaticMarkup(<CreateSessionPanel tenant="acme" open standalone onCreated={() => {}} />);

describe("Domain-scoped OntoCode creation", () => {
  it("makes the missing source actionable without sending users to Tenant administration", () => {
    const html = render();
    expect(html).toContain("No active Ontology sources");
    expect(html).toContain('href="/portal/acme/domains/purchasing/ontology"');
    expect(html).toContain("Ontology sources &amp; runtime");
    expect(html).toContain("Create Session");
    expect(html).toContain("disabled");
    expect(html).not.toContain("Business Domains");
    expect(html).not.toMatch(/[\u3400-\u9fff]/);
  });
  it("localizes the same source-registration path in Chinese", () => {
    state.language = "zh";
    const html = render();
    expect(html).toContain("没有活跃的本体来源");
    expect(html).toContain("本体来源与运行配置");
    expect(html).toContain('href="/portal/acme/domains/purchasing/ontology"');
  });
  it("renders the actual registered source and its readiness", () => {
    state.items = [{ id: "reg-purchasing", status: "active", archivedAt: null, isDefault: true, displayName: "Purchase ontology", ontologyDomainId: "purchase-model", source: "upload", executionReadiness: { executable: false } }];
    const html = render();
    expect(html).toContain("Purchase ontology");
    expect(html).toContain("Uploaded snapshot");
    expect(html).toContain("needs a ready runtime profile");
  });
  it("renders a translated cancel action in the modal", () => {
    const html = renderToStaticMarkup(<CreateSessionPanel tenant="acme" open onCreated={() => {}} onClose={() => {}} />);
    expect(html).toContain("Cancel");
    expect(html).not.toContain("common.cancel");
  });
  it("provides a readable publish prerequisite in both languages", () => {
    const key = "workflowPage.toast.publishError.tenant_inngest_disabled";
    expect(translate("en", key)).toContain("Start runtime");
    expect(translate("zh", key)).toContain("启动运行服务");
  });
});
