"use client";

/**
 * SessionContext — expose the signed-in user to client components.
 *
 * `lib/auth/session.ts → readSession()` is server-only (uses `next/headers`).
 * The portal layout reads it once in the server component and passes the
 * Session object through to the chrome, which seeds this context so any
 * client component can read `useSession()` synchronously.
 *
 * Created in Wave 4 to support the Settings page subtitle (FE-P0-4 sub-fix
 * 4c) wiring "operator" name to the actual session instead of the hardcoded
 * "Liu Wei (Owner)" string.
 */

import { createContext, useContext, type ReactNode } from "react";

export interface SessionUser {
  /** Stable user id (the `sub` JWT claim). */
  sub: string;
  /** Display name (e.g. "Liu Wei"). */
  name: string;
  /** Two-letter initials for the avatar chip. */
  initials: string;
  /** Active tenant slug at session creation time. */
  tenant: string;
}

const SessionCtx = createContext<SessionUser | null>(null);

export function SessionProvider({
  value,
  children,
}: {
  value: SessionUser;
  children: ReactNode;
}) {
  return <SessionCtx.Provider value={value}>{children}</SessionCtx.Provider>;
}

/**
 * Read the current session inside a client component. Returns `null` outside
 * the provider; callers should treat that as "not yet hydrated" and render a
 * placeholder rather than crashing.
 */
export function useSession(): SessionUser | null {
  return useContext(SessionCtx);
}
