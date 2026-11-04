import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  PreferencesProvider,
  useI18n,
} from "@/app/portal/lib/preferences-context";
import { I18nBootstrapProvider } from "./bootstrap";
import { withEnglishFallback } from "./core";
import type { I18nBundle } from "./types";

function Copy() {
  const { language, t } = useI18n();
  return (
    <p lang={language}>
      {t("greeting", { name: "Kenny" })} · {t("nested.fallback")}
    </p>
  );
}

describe("server-selected dictionary bootstrap", () => {
  it("renders the selected language and English fallback on the first render", () => {
    const initialBundle: I18nBundle = {
      language: "zh",
      dictionary: withEnglishFallback(
        {
          greeting: "Hello {name}",
          nested: { fallback: "Fallback", selected: "English" },
        },
        { greeting: "你好 {name}", nested: { selected: "中文" } },
      ),
    };
    const render = () =>
      renderToStaticMarkup(
        <I18nBootstrapProvider initialBundle={initialBundle}>
          <PreferencesProvider>
            <Copy />
          </PreferencesProvider>
        </I18nBootstrapProvider>,
      );
    expect(render()).toBe('<p lang="zh">你好 Kenny · Fallback</p>');
    expect(render()).toBe(render());
    expect(initialBundle.dictionary.nested).toEqual({
      fallback: "Fallback",
      selected: "中文",
    });
  });
});
