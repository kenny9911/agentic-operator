"use client";

/**
 * useDensity (P2-FE-20) — returns the active density scalar.
 *
 * Implementation: reads the CSS variable `--density-mult` off
 * `document.documentElement` after mount, returns 1 during SSR. Listens
 * for changes via a `MutationObserver` on the `data-density` attribute
 * so a Tweaks-panel switch propagates without a remount.
 *
 * Components that need pixel-level density-aware sizing multiply their
 * base values by the returned scalar (e.g. `padding: 14 * d`). Components
 * that can compute it in CSS should prefer `calc(<n>px * var(--density-mult))`
 * directly in their inline style strings.
 */

import { useEffect, useState } from "react";

const DENSITY_MAP: Record<string, number> = {
  compact: 0.85,
  default: 1,
  comfortable: 1.18,
};

export function useDensity(): number {
  const [scalar, setScalar] = useState<number>(1);

  useEffect(() => {
    function read() {
      const attr =
        document.documentElement.getAttribute("data-density") ?? "default";
      setScalar(DENSITY_MAP[attr] ?? 1);
    }
    read();
    const mo = new MutationObserver(read);
    mo.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-density"],
    });
    return () => mo.disconnect();
  }, []);

  return scalar;
}

/** Pure helper for tests / SSR — given a density key, return the scalar. */
export function densityScalar(density: string | null | undefined): number {
  return DENSITY_MAP[density ?? "default"] ?? 1;
}

export const DENSITY_SCALAR = DENSITY_MAP;
