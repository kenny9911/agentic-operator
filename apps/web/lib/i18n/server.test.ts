import { describe, expect, it, vi } from "vitest";
import { GET } from "@/app/i18n/[language]/route";
import { getI18nBundle, getInitialI18nBundle } from "./server";
import { LANGUAGE_COOKIE } from "./types";

const cookie = vi.hoisted(() => ({ value: undefined as string | undefined }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (name === "agentic.language" ? cookie : undefined),
  }),
}));

describe("locale server boundary", () => {
  it("uses the validated cookie and defaults invalid or missing values to English", async () => {
    expect(LANGUAGE_COOKIE).toBe("agentic.language");
    cookie.value = "zh";
    expect(await getInitialI18nBundle()).toBe(getI18nBundle("zh"));
    cookie.value = "../en";
    expect(await getInitialI18nBundle()).toBe(getI18nBundle("en"));
    cookie.value = undefined;
    expect(await getInitialI18nBundle()).toBe(getI18nBundle("en"));
  });

  it("returns only the requested locale and revalidates across deployments", async () => {
    const response = await GET(new Request("http://localhost/i18n/zh"), {
      params: Promise.resolve({ language: "zh" }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe(
      "public, max-age=0, must-revalidate",
    );
    expect(await response.json()).toEqual(getI18nBundle("zh"));
  });

  it("rejects unsupported languages rather than returning an English success", async () => {
    const response = await GET(new Request("http://localhost/i18n/fr"), {
      params: Promise.resolve({ language: "fr" }),
    });
    expect(response.status).toBe(404);
  });
});
