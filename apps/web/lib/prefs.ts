import { cookies } from "next/headers";
import { isTenantSlug, parseRememberedTenant } from "./tenant-preference";

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
  // No tenant is guessed here. `/portal` uses the authenticated session on
  // first visit, then this field records whichever tenant the user opens.
  tenant: "",
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

/** Return only an explicitly remembered, valid tenant (never a default). */
export async function readRememberedTenant(): Promise<string | null> {
  const store = await cookies();
  return parseRememberedTenant(store.get(COOKIE_NAME)?.value);
}

/** Persist an explicitly selected tenant while retaining all other prefs. */
export async function writeRememberedTenant(tenant: string): Promise<void> {
  if (!isTenantSlug(tenant)) {
    throw new TypeError(`Invalid tenant slug: ${tenant}`);
  }
  const store = await cookies();
  let current: Record<string, unknown> = { ...DEFAULT_PREFS };
  try {
    const raw = store.get(COOKIE_NAME)?.value;
    if (raw) current = { ...current, ...JSON.parse(raw) };
  } catch {}
  store.set(COOKIE_NAME, JSON.stringify({ ...current, tenant }), {
    path: "/",
    httpOnly: false,
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 365,
  });
}

export const ACCENT_DIMS: Record<string, string> = {
  "#d0ff00": "#5a6e00",
  "#5deeff": "#1a6770",
  "#ffb547": "#7a4f0d",
  "#b594ff": "#553e87",
};

export { COOKIE_NAME as PREFS_COOKIE };
