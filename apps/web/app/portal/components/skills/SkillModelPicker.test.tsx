import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SkillModelPicker } from "./SkillModelPicker";

const state = vi.hoisted(() => ({ loading: true }));
vi.mock("@/app/portal/lib/preferences-context", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));
vi.mock("@/app/portal/lib/use-tenant", () => ({ useTenant: () => "alpha" }));
vi.mock("@/lib/hooks/useLlmSettings", () => ({
  useLlmSettings: () => ({
    data: {
      settings: {
        gatewayInstances: [
          {
            id: "gateway",
            displayName: "Gateway",
            enabled: true,
            kind: "direct",
            providerId: "openai",
          },
        ],
      },
    },
  }),
  useGatewayModels: () => ({ isLoading: state.loading, data: undefined }),
}));

beforeEach(() => {
  state.loading = true;
});
describe("Skill model selection", () => {
  it("keeps an empty model required during discovery, preventing default-route submission", () => {
    const html = renderToStaticMarkup(
      <form>
        <SkillModelPicker value="gateway/" onChange={() => {}} />
      </form>,
    );
    const modelControl = html.match(/<select[^>]*required[^>]*>/u)?.[0];
    expect(modelControl).toBeDefined();
    expect(modelControl).toContain('aria-busy="true"');
    expect(modelControl).not.toContain("disabled");
  });

  it("allows the caller to disable model controls during its own request", () => {
    const html = renderToStaticMarkup(
      <SkillModelPicker value="gateway/" onChange={() => {}} disabled />,
    );
    const controls = html.match(/<select[^>]*>/gu) ?? [];
    expect(controls).toHaveLength(2);
    expect(controls.every((control) => control.includes("disabled"))).toBe(
      true,
    );
  });
});
