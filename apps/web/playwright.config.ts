/**
 * Playwright config for the Phase 2 pixel-diff harness.
 *
 * Boots `pnpm dev` against the web workspace (port 3599) and runs the
 * visual specs under `./test/visual/`. The dev server is reused if it's
 * already up, so CI can split the boot into a separate step if needed.
 *
 * Viewport pinned to 1440×900 per FR-PORT-3 ("design baseline at
 * 1440 wide"). Each portal view captures a single full-page screenshot
 * and compares against a stored reference image with a 0.1 % tolerance.
 *
 * The reference set lives under `./test/visual/v1_1-reference/`. When
 * the reference is absent, Playwright writes the current capture there
 * on the first run — that lets engineers establish a baseline from a
 * known-good build by pointing the harness at it once. After that, any
 * pixel drift fails the test until the reference is regenerated.
 */

import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./test/visual",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: process.env.PW_BASE_URL ?? "http://localhost:3599",
    viewport: { width: 1440, height: 900 },
    // Animations are fine to leave on — the screenshot is taken after
    // `await page.waitForLoadState('networkidle')` which gives most CSS
    // transitions enough time to settle. Specific tests can disable
    // them via `await page.emulateMedia({ reducedMotion: 'reduce' })`.
    deviceScaleFactor: 1,
    actionTimeout: 10_000,
    navigationTimeout: 30_000,
  },
  projects: [
    {
      // No Desktop Chrome preset — the preset bakes in viewport 1280×720
      // which fights with our top-level 1440×900 pin. Bare `chromium`
      // takes only what we pass under `use:`.
      name: "chromium",
      use: {
        browserName: "chromium",
      },
    },
  ],
  // We expect dev server to be up before running. The webServer block
  // is left commented because the typical workflow during this
  // engineering wave is to launch the dev server manually and then
  // run `pnpm playwright test`. CI can flip this on by setting
  // PW_AUTO_WEBSERVER=1.
  ...(process.env.PW_AUTO_WEBSERVER === "1"
    ? {
        webServer: {
          command: "pnpm dev",
          port: 3599,
          reuseExistingServer: true,
          timeout: 120_000,
          cwd: "../..",
        },
      }
    : {}),
  expect: {
    toMatchSnapshot: {
      // 0.1 % per FR-PORT-3 — caps the total fraction of pixels that
      // are allowed to differ. `maxDiffPixelRatio` is the canonical
      // Playwright parameter for "I care about percentage of pixels,
      // not raw counts".
      maxDiffPixelRatio: 0.001,
      // Small per-pixel diff to absorb font-rendering noise across
      // operating systems. 0 would be too strict.
      threshold: 0.2,
    },
  },
});
