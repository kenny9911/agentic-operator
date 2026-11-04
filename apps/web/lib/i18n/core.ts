import type { Dict, Language } from "./types";

/** Merge fallback leaves on the server, without shipping a second locale. */
export function withEnglishFallback(english: Dict, selected: Dict): Dict {
  const merged: Dict = { ...english };
  for (const [key, value] of Object.entries(selected)) {
    const fallback = english[key];
    merged[key] =
      typeof value === "object" && typeof fallback === "object"
        ? withEnglishFallback(fallback, value)
        : value;
  }
  return merged;
}

/** Translate a complete, server-merged dictionary. */
export function translateDictionary(
  dictionary: Dict,
  key: string,
  vars?: Record<string, string | number>,
): string {
  return interpolate(lookup(dictionary, key) ?? key, vars);
}

/** Replace `{name}` placeholders with values from `vars`. Unmatched
 *  placeholders are left intact; numbers are stringified. */
export function interpolate(
  template: string,
  vars?: Record<string, string | number>,
): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name)
      ? String(vars[name])
      : match,
  );
}

/** Resolve a dot-path to a leaf string, or `undefined` if the path is
 *  missing or lands on a non-leaf (object) node. */
export function lookup(dict: Dict, dotKey: string): string | undefined {
  let cur: string | Dict | undefined = dict;
  for (const part of dotKey.split(".")) {
    if (cur && typeof cur === "object" && part in cur) {
      cur = (cur as Dict)[part];
    } else {
      return undefined;
    }
  }
  return typeof cur === "string" ? cur : undefined;
}

/** Core translator with injectable dictionaries (for tests). Fallback
 *  chain: active-language → en → the key itself. Never throws / blanks. */
export function translateWith(
  dicts: Record<Language, Dict>,
  language: Language,
  key: string,
  vars?: Record<string, string | number>,
): string {
  const resolved = lookup(dicts[language], key) ?? lookup(dicts.en, key);
  if (resolved === undefined && process.env.NODE_ENV !== "production") {
    // eslint-disable-next-line no-console
    console.warn(`[i18n] missing translation key: "${key}"`);
  }
  return interpolate(resolved ?? key, vars);
}
