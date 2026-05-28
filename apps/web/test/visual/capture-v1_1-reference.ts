/**
 * One-shot Node script: drive Playwright through the v1_1 SPA and save
 * one PNG per nav view into ./v1_1-reference/.
 *
 * The legacy SPA is a single-page React app — view switching is in-memory
 * state, not URL routes. So we navigate to `/portal-legacy/index.html`
 * once, then click the sidebar buttons to switch the view in place.
 *
 * Sidebar entries (matched by visible text):
 *   Dashboard | Workflows | Agents | Runs | Events | Tasks | Logs |
 *   Deployments | Settings
 *
 * Run with:
 *   AUTH_MODE=dev pnpm dev   # in another terminal
 *   tsx apps/web/test/visual/capture-v1_1-reference.ts
 */

import { chromium } from "@playwright/test";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Playwright's `toHaveScreenshot([ "v1_1-reference", "<view>.png" ])`
// resolves to `<spec>.ts-snapshots/v1_1-reference/<view>-chromium-<os>.png`.
// We write directly into that path so a `--update-snapshots` style
// regeneration produces the canonical filenames in one go.
const PLATFORM = process.platform === "darwin" ? "darwin" : "linux";
const OUT_DIR = path.join(
  __dirname,
  "portal.spec.ts-snapshots",
  "v1_1-reference",
);
const SUFFIX = `-chromium-${PLATFORM}.png`;
fs.mkdirSync(OUT_DIR, { recursive: true });
const BASE_URL = process.env.PW_BASE_URL ?? "http://localhost:3599";

// Sidebar labels in the legacy SPA (app.jsx). "Human tasks" was renamed
// to "Tasks" in the new portal; capture under the slug expected by the
// pixel-diff spec but click the legacy label.
const VIEWS: Array<{ slug: string; label: string }> = [
  { slug: "dashboard", label: "Dashboard" },
  { slug: "workflows", label: "Workflows" },
  { slug: "agents", label: "Agents" },
  { slug: "runs", label: "Runs" },
  { slug: "events", label: "Events" },
  { slug: "tasks", label: "Human tasks" },
  { slug: "logs", label: "Logs" },
  { slug: "deployments", label: "Deployments" },
  { slug: "settings", label: "Settings" },
];

const FREEZE_CSS = `
  *, *::before, *::after {
    animation-duration: 0s !important;
    animation-delay: 0s !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0s !important;
    transition-delay: 0s !important;
  }
  animateMotion, animate, animateTransform { begin: 999999s !important; }
`;

async function capture(): Promise<void> {
  const browser = await chromium.launch({ headless: true });
  try {
    const ctx = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      reducedMotion: "reduce",
      deviceScaleFactor: 1,
    });
    const page = await ctx.newPage();

    await page.goto(`${BASE_URL}/portal-legacy/index.html`, {
      waitUntil: "domcontentloaded",
    });
    // The legacy SPA mounts via Babel-standalone; give it a beat to
    // compile + render. The first paint shows the dashboard.
    await page.waitForSelector("nav, [data-view]", { timeout: 30_000 }).catch(() => null);
    await page.waitForTimeout(2000);
    await page.addStyleTag({ content: FREEZE_CSS });

    for (const v of VIEWS) {
      console.log(`[v1_1-ref] capturing ${v.slug}`);
      // Click the sidebar entry by visible label. The legacy SPA uses
      // <button> with the label text. If the click locator misses,
      // fall back to URL hash-style trigger (some legacy builds set
      // location.hash = view).
      const btn = page.getByRole("button", { name: v.label, exact: true }).first();
      try {
        await btn.click({ timeout: 5000 });
      } catch {
        // Fallback: look up by text content on any role
        try {
          await page.getByText(v.label, { exact: true }).first().click({ timeout: 4000 });
        } catch {
          console.warn(`[v1_1-ref] could not click sidebar entry for ${v.label}; staying on current view`);
        }
      }
      await page.waitForTimeout(700);
      await page.addStyleTag({ content: FREEZE_CSS });
      await page.waitForTimeout(200);
      const out = path.join(OUT_DIR, `${v.slug}${SUFFIX}`);
      await page.screenshot({ path: out, fullPage: false });
    }
  } finally {
    await browser.close();
  }
}

capture()
  .then(() => {
    console.log("[v1_1-ref] done");
    process.exit(0);
  })
  .catch((e) => {
    console.error("[v1_1-ref] failed:", e);
    process.exit(1);
  });
