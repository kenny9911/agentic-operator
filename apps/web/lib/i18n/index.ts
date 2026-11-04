import type { Dict, Language } from "./types";
import { en } from "./en";
import { zh } from "./zh";

export const DICTS: Record<Language, Dict> = { en, zh };

export { interpolate, lookup, translateWith } from "./core";
import { translateWith } from "./core";

/** Public translator bound to the real en/zh dictionaries. */
export function translate(
  language: Language,
  key: string,
  vars?: Record<string, string | number>,
): string {
  return translateWith(DICTS, language, key, vars);
}
