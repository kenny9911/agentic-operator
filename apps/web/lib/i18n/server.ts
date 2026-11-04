import { cookies } from "next/headers";
import { en } from "./en";
import { zh } from "./zh";
import { withEnglishFallback } from "./core";
import {
  isLanguage,
  LANGUAGE_COOKIE,
  type I18nBundle,
  type Language,
} from "./types";

// This module is server-only (next/headers enforces the component boundary).
// Full dictionaries must never be imported by PreferencesProvider or another
// client module. Missing Chinese leaves are resolved before serialization.
const bundles: Record<Language, I18nBundle> = {
  en: { language: "en", dictionary: en },
  zh: { language: "zh", dictionary: withEnglishFallback(en, zh) },
};

export function getI18nBundle(language: Language): I18nBundle {
  return bundles[language];
}

export async function getInitialI18nBundle(): Promise<I18nBundle> {
  const language = (await cookies()).get(LANGUAGE_COOKIE)?.value;
  return getI18nBundle(isLanguage(language) ? language : "en");
}
