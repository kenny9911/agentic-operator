import { isLanguage, type Dict, type I18nBundle, type Language } from "./types";

function isDictionary(value: unknown): value is Dict {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.values(value).every(
      (entry) => typeof entry === "string" || isDictionary(entry),
    )
  );
}

/** One request per chosen locale; failed requests can be retried. */
export function createI18nLoader(
  fetcher: typeof fetch = (...args) => fetch(...args),
) {
  const cache = new Map<Language, Promise<I18nBundle>>();
  return (language: Language): Promise<I18nBundle> => {
    const cached = cache.get(language);
    if (cached) return cached;
    const pending = fetcher(`/i18n/${language}`, {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    })
      .then(async (response) => {
        if (!response.ok)
          throw new Error(`Language unavailable: ${response.status}`);
        const bundle: unknown = await response.json();
        if (
          !bundle ||
          typeof bundle !== "object" ||
          !("language" in bundle) ||
          !isLanguage(bundle.language) ||
          bundle.language !== language ||
          !("dictionary" in bundle) ||
          !isDictionary(bundle.dictionary)
        ) {
          throw new Error("Invalid language dictionary");
        }
        return bundle as I18nBundle;
      })
      .catch((error: unknown) => {
        cache.delete(language);
        throw error;
      });
    cache.set(language, pending);
    return pending;
  };
}

const loadI18n = createI18nLoader();

/** Keep rendered copy stable until ready; obsolete requests never win. */
export function createI18nSelection(
  initial: I18nBundle,
  load: (language: Language) => Promise<I18nBundle> = loadI18n,
) {
  let generation = 0;
  const ready = new Map<Language, I18nBundle>([[initial.language, initial]]);
  return {
    cancel() {
      generation += 1;
    },
    select(
      language: Language,
      onReady: (bundle: I18nBundle) => void,
      onError: () => void,
    ): void {
      const request = ++generation;
      const cached = ready.get(language);
      if (cached) {
        onReady(cached);
        return;
      }
      void load(language).then(
        (bundle) => {
          ready.set(language, bundle);
          if (request === generation) onReady(bundle);
        },
        () => {
          if (request === generation) onError();
        },
      );
    },
  };
}
