"use client";

/**
 * useTweaks (P2-FE-16) — persistent runtime preferences.
 *
 * Replaces the v1_1 `postMessage` plumbing (audit §7 R-7) with a
 * localStorage-backed React state. The first read happens in `useEffect`
 * so SSR doesn't crash on `window.localStorage`. Components that need
 * the value before mount get the defaults until hydration finishes.
 *
 * Schema lives at `DEFAULT_TWEAKS`. Each key is read/written individually
 * (one JSON blob in storage to avoid quota fragmentation).
 *
 * The dataSource control from the portal delta (D-3) is preserved so the
 * Tweaks panel still lists it, but the value is a no-op — data is always
 * fetched from /v1/* by Phase 1.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

export interface Tweaks {
  theme: "dark" | "light";
  density: "compact" | "default" | "comfortable";
  liveStream: boolean;
  showDebug: boolean;
  tenant: string;
  accent: string;
  /** Latent — the data source is always the real API now. */
  dataSource: "json" | "neo4j";
}

export const DEFAULT_TWEAKS: Tweaks = {
  theme: "dark",
  density: "default",
  liveStream: true,
  showDebug: false,
  tenant: "raas",
  accent: "#d0ff00",
  dataSource: "json",
};

export const ACCENT_DIMS: Record<string, string> = {
  "#d0ff00": "#5a6e00",
  "#5deeff": "#1a6770",
  "#ffb547": "#7a4f0d",
  "#b594ff": "#553e87",
};

const STORAGE_KEY = "agentic.tweaks";

function readFromStorage(): Tweaks {
  if (typeof window === "undefined") return DEFAULT_TWEAKS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_TWEAKS;
    const parsed = JSON.parse(raw) as Partial<Tweaks>;
    return { ...DEFAULT_TWEAKS, ...parsed };
  } catch {
    return DEFAULT_TWEAKS;
  }
}

function writeToStorage(t: Tweaks) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(t));
  } catch {
    // quota exceeded / private mode — ignore.
  }
}

export type SetTweak = <K extends keyof Tweaks>(
  keyOrEdits: K | Partial<Tweaks>,
  val?: Tweaks[K],
) => void;

/**
 * useTweaks — returns `[tweaks, setTweak]`. setTweak accepts either
 * `(key, value)` or an object of edits.
 */
export function useTweaks(): [Tweaks, SetTweak] {
  const [tweaks, setTweaks] = useState<Tweaks>(DEFAULT_TWEAKS);
  const hydratedRef = useRef(false);

  // Hydrate on mount.
  useEffect(() => {
    if (hydratedRef.current) return;
    hydratedRef.current = true;
    setTweaks(readFromStorage());
  }, []);

  // Cross-tab sync.
  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key !== STORAGE_KEY) return;
      setTweaks(readFromStorage());
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  // Apply theme/density/accent to <html> whenever the values change.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const html = document.documentElement;
    html.dataset.theme = tweaks.theme;
    html.dataset.density = tweaks.density;
    html.style.setProperty("--signal", tweaks.accent);
    html.style.setProperty(
      "--signal-dim",
      ACCENT_DIMS[tweaks.accent] ?? "#5a6e00",
    );
  }, [tweaks.theme, tweaks.density, tweaks.accent]);

  const setTweak: SetTweak = useCallback((keyOrEdits, val) => {
    setTweaks((prev) => {
      const edits =
        typeof keyOrEdits === "object" && keyOrEdits !== null
          ? (keyOrEdits as Partial<Tweaks>)
          : ({ [keyOrEdits as string]: val } as Partial<Tweaks>);
      const next = { ...prev, ...edits };
      writeToStorage(next);
      return next;
    });
  }, []);

  return useMemo(() => [tweaks, setTweak], [tweaks, setTweak]);
}
