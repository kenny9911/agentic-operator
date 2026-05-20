/**
 * Pixel-diff harness for the App Router portal vs the v1_1 SPA.
 *
 * Captures a 1440×900 screenshot of each of the 9 nav views and compares
 * it against a stored reference under `./v1_1-reference/<view>.png` with
 * a 0.1 % pixel-diff tolerance (FR-PORT-3).
 *
 * Reference set:
 *   The v1_1 SPA originally lived at `apps/web/public/portal/` and was
 *   served at `/portal/index.html`. With the App Router taking over the
 *   `/portal/...` namespace, the SPA was relocated to
 *   `apps/web/public/portal-legacy/` (P2-FE-21 transitional) and served
 *   at `/portal-legacy/index.html`. The capture-reference step below
 *   reads from there. After capture, the legacy SPA is deleted (the
 *   reference images stay).
 *
 *   The reference images are checked in once and treated as the
 *   "design-locked" baseline. Re-generating requires an explicit
 *   `--update-snapshots` invocation by a human reviewer.
 *
 * Strategy:
 *   - Each view runs in its own `test()` so a single drift doesn't
 *     blast the whole suite.
 *   - We wait on `networkidle` to give SSE / TanStack hydration a
 *     chance to paint. The dashboard's event ticker is animated; we
 *     freeze it by setting `reducedMotion=reduce` AND injecting a
 *     CSS rule that pauses every animation.
 *   - Auth: the portal is gated. The Foundation auth (`@/lib/auth`)
 *     auto-mints a dev session in non-prod. We pre-set the cookie
 *     manually before each navigation so `next dev` doesn't need any
 *     side-channel setup.
 */

import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";

const NAV_VIEWS = [
  "dashboard",
  "workflows",
  "agents",
  "runs",
  "events",
  "tasks",
  "logs",
  "deployments",
  "settings",
] as const;
type NavView = (typeof NAV_VIEWS)[number];

const NEW_PORTAL_PATH = (view: NavView): string =>
  `/portal/raas/${view}`;

/**
 * Freeze animations. The dashboard event ticker advances every 1.5 s
 * which would otherwise create flaky diffs; the runs page has subtle
 * status dots; the workflows page has live `<animateMotion>` dots.
 * Injecting `* { animation: none !important; transition: none !important; }`
 * deterministically pins the layout to the post-mount state.
 */
async function freezeAnimations(page: Page): Promise<void> {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const css =
    "*, *::before, *::after { animation-duration: 0s !important;" +
    " animation-delay: 0s !important; animation-iteration-count: 1 !important;" +
    " transition-duration: 0s !important; transition-delay: 0s !important; }" +
    " animateMotion, animate, animateTransform { begin: 999999s !important; }";
  await page.addStyleTag({ content: css });
}

async function prepareDevAuth(page: Page): Promise<void> {
  // The auth plugin auto-mints a session in dev mode (AUTH_MODE=dev or
  // !production). The portal layout reads `agentic_session` cookie at
  // SSR. We hit `/sign-in` once to let the server mint it, then
  // continue. This is faster than calling /api/auth/login because it
  // round-trips through the same gate.
  await page.goto("/sign-in?return=/portal/raas/dashboard");
  await page.waitForURL(/\/portal\//, { timeout: 15_000 });
}

// Use `mode: "default"` so a failing test does NOT mark subsequent tests
// as skipped — we want a per-view tally even when several drift.
test.describe.configure({ mode: "default" });

test.describe("Portal v1_1 pixel parity", () => {
  test.beforeEach(async ({ page }) => {
    await prepareDevAuth(page);
  });

  for (const view of NAV_VIEWS) {
    test(`view: ${view}`, async ({ page }) => {
      await page.goto(NEW_PORTAL_PATH(view));
      // Allow ChartJS / SVG / monaco to settle. We don't wait for
      // `networkidle` exclusively because SSE keeps the connection open
      // forever; instead, wait for the main nav shell to render then
      // pause briefly.
      await page.waitForSelector("nav", { timeout: 15_000 });
      await page.waitForLoadState("domcontentloaded");
      await page.waitForTimeout(800);
      await freezeAnimations(page);
      await page.waitForTimeout(200);

      // Compare against `./v1_1-reference/<view>.png`. Playwright reads
      // the file path relative to the spec; we pass an absolute project
      // path so the path is stable regardless of test parallelism.
      await expect(page).toHaveScreenshot(
        ["v1_1-reference", `${view}.png`],
        {
          fullPage: false,
          // The portal is mostly static once hydrated; the only
          // intentional movement was animation, which freezeAnimations
          // already silenced.
          animations: "disabled",
        },
      );
    });
  }
});
