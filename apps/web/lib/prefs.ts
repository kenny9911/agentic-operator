import { cookies } from "next/headers";

/**
 * User preferences stored in cookies (replaces prototype's tweaks-panel).
 * Read server-side in layouts to set <html> attributes; written client-side
 * via setPrefCookie() (M7 wires up actual UI).
 */

export type Theme = "dark" | "light";
export type Density = "compact" | "default" | "comfortable";

export interface Prefs {
  theme: Theme;
  density: Density;
  accent: string;
  tenant: string;
  liveStream: boolean;
}

export const DEFAULT_PREFS: Prefs = {
  theme: "dark",
  density: "default",
  accent: "#d0ff00",
  tenant: "raas",
  liveStream: true,
};

const COOKIE_NAME = "agentic_prefs";

export async function readPrefs(): Promise<Prefs> {
  const store = await cookies();
  const raw = store.get(COOKIE_NAME)?.value;
  if (!raw) return DEFAULT_PREFS;
  try {
    const parsed = JSON.parse(raw) as Partial<Prefs>;
    return { ...DEFAULT_PREFS, ...parsed };
  } catch {
    return DEFAULT_PREFS;
  }
}

export const ACCENT_DIMS: Record<string, string> = {
  "#d0ff00": "#5a6e00",
  "#5deeff": "#1a6770",
  "#ffb547": "#7a4f0d",
  "#b594ff": "#553e87",
};

export { COOKIE_NAME as PREFS_COOKIE };
