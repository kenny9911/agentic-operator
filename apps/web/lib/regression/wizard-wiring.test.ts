/**
 * Wizard-wiring regression guard.
 *
 * History: the production Import-Manifest wizard and the "+ New tenant"
 * flow were both re-mocked twice during the 2026-05-20 build cycle —
 * once by a stale-buffer overwrite from another worktree, once by a
 * checkpoint rollback. Each revert silently reintroduced:
 *
 *   - `setTimeout(..., 900)` standing in for the validate call
 *   - the `+ New tenant` toast "Not yet implemented"
 *   - `useEffect(load, [])` in `DataProvider` (so tenant switches don't
 *     reload the canvas)
 *   - the static `TENANTS` fixture in `chrome.tsx` instead of `useTenants()`
 *
 * Each of these passed typecheck and lint because they're all valid TS.
 * The only signal was a human noticing the wizard was lying. This file
 * exists to catch the regression at CI time before the revert lands on
 * `main`. The tests are deliberately structural — they read the source
 * file and assert the wiring patterns are present and the mock patterns
 * are absent. They are intentionally NOT runtime tests because the
 * production page tree requires Next.js + RSC + a live api to exercise
 * end-to-end (that's the Playwright suite's job).
 *
 * If a legitimate refactor changes a pattern this test asserts, update
 * the regex below in the SAME commit. Do not delete the file.
 *
 * See: docs/audits/qa-report-2026-05-20.md, commit a14f3a3.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..");

function read(rel: string): string {
  return readFileSync(resolve(REPO_ROOT, rel), "utf8");
}

describe("regression: production wizard wiring", () => {
  describe("ImportManifestModal — must call the real backend", () => {
    const src = read("app/portal/components/import-manifest/ImportManifestModal.tsx");

    it("posts to /v1/tenants/:slug/manifest-import", () => {
      // Either a literal /v1/tenants/.../manifest-import or a template that
      // builds the same path. Accept both forms.
      const literal = /\/v1\/tenants\/\$\{[^}]+\}\/manifest-import/;
      const interpolated = /`\/v1\/tenants\/\$\{[^`]+manifest-import/;
      expect(
        literal.test(src) || interpolated.test(src),
        "ImportManifestModal must POST to /v1/tenants/:slug/manifest-import — looks like the setTimeout mock was reintroduced",
      ).toBe(true);
    });

    it("handles both validate and commit modes", () => {
      expect(/mode:\s*["']validate["']/.test(src)).toBe(true);
      expect(/mode:\s*["']commit["']/.test(src)).toBe(true);
    });

    it("does NOT contain the legacy setTimeout validation mock", () => {
      // The old mock was `setTimeout(() => { setParsed(buildSampleParse()); setValidating(false); }, 900)`.
      // Match any setTimeout near setValidating(false) — that's the smell.
      // (A setTimeout for unrelated UX is fine; the diagnostic is the pair.)
      const mockPair = /setTimeout\([\s\S]{0,300}setValidating\(\s*false/;
      expect(
        mockPair.test(src),
        "ImportManifestModal looks re-mocked: a setTimeout closes around setValidating(false). Revert detected.",
      ).toBe(false);
    });

    it("does NOT call buildSampleParse() in the validation path", () => {
      // buildSampleParse() was the canary helper for the mock. If it's
      // ever invoked from a runtime path again, that's a regression.
      const usage = /\bbuildSampleParse\s*\(/;
      // It's fine if the helper is *defined* (unused), but it must not
      // be *invoked* anywhere.
      if (usage.test(src)) {
        // Allow `function buildSampleParse(` definitions; only flag calls.
        // Strip definitions first.
        const stripped = src.replace(/function\s+buildSampleParse\s*\([^]*?\n\}/g, "");
        expect(
          /\bbuildSampleParse\s*\(/.test(stripped),
          "ImportManifestModal calls the mock helper buildSampleParse(). Revert detected.",
        ).toBe(false);
      }
    });
  });

  describe("tenant-switcher — must open TenantCreateModal", () => {
    const src = read("app/portal/components/shell/tenant-switcher.tsx");

    it("imports TenantCreateModal", () => {
      expect(/from\s+["'][^"']*TenantCreateModal["']/.test(src)).toBe(true);
    });

    it("does NOT show the 'Not yet implemented' toast for + New tenant", () => {
      // The toast pattern was distinctive — a `tone: "amber"` with title
      // containing "Not yet implemented" + the New-tenant description.
      const stub =
        /toast\([^)]*Not yet implemented/ ||
        /Tenant provisioning is post-v1/;
      expect(
        stub.test(src),
        "+ New tenant still toasts 'Not yet implemented'. Revert detected.",
      ).toBe(false);
    });

    it("invalidates the tenants query after a successful create", () => {
      // Either via the exported TENANTS_KEYS constant or a literal
      // ["tenants"] queryKey — accept both.
      const invalidatesViaKeys = /invalidateQueries[^)]*TENANTS_KEYS/.test(src);
      const invalidatesViaLiteral = /invalidateQueries[^)]*\["tenants"\]/.test(src);
      expect(
        invalidatesViaKeys || invalidatesViaLiteral,
        "After tenant create, TanStack ['tenants'] must be invalidated so the sidebar refreshes",
      ).toBe(true);
    });
  });

  describe("chrome — must read live tenants, not the static fixture", () => {
    const src = read("app/portal/components/shell/chrome.tsx");

    it("calls useTenants()", () => {
      expect(/\buseTenants\s*\(/.test(src)).toBe(true);
    });

    it("does not exclusively use the static TENANTS fixture", () => {
      // It's fine to import TENANTS as a fallback. What matters is that
      // useTenants() is also wired in. The previous bug was the file
      // ONLY using TENANTS.map(...). If useTenants is present (asserted
      // above) and TENANTS appears only as a fallback, we're good.
      const fixtureMap = /\bTENANTS\s*\.\s*map\b/;
      const useTenants = /\buseTenants\s*\(/;
      if (fixtureMap.test(src)) {
        expect(
          useTenants.test(src),
          "chrome.tsx uses TENANTS.map but no useTenants() — the sidebar is stuck on the static fixture",
        ).toBe(true);
      }
    });
  });

  describe("DataProvider — must re-fetch on tenant change", () => {
    const src = read("lib/hooks/data-context.tsx");

    it("imports usePathname (or another tenant-reactive source)", () => {
      const usesPathname = /\busePathname\s*\(/.test(src);
      const usesParams = /\buseParams\s*\(/.test(src);
      expect(
        usesPathname || usesParams,
        "DataProvider must react to URL tenant changes — usePathname() / useParams() missing",
      ).toBe(true);
    });

    it("does NOT use a bare [] dependency array for the bootstrap fetch", () => {
      // Match the *load* effect specifically — there might be other
      // useEffect calls in the file. The bootstrap loader is the one
      // that calls /api/spa/bootstrap.
      // Strategy: find the useEffect that contains "/api/spa/bootstrap"
      // and inspect its deps line.
      const effectBlock = src.match(
        /useEffect\(\s*\(\)\s*=>\s*\{[\s\S]*?\/api\/spa\/bootstrap[\s\S]*?\},\s*\[([^\]]*)\]/,
      );
      expect(
        effectBlock,
        "Could not locate the bootstrap useEffect in data-context.tsx — refactor may have hidden it",
      ).not.toBeNull();
      if (effectBlock) {
        const deps = effectBlock[1].trim();
        expect(
          deps.length > 0,
          "DataProvider useEffect has empty [] deps — switching tenant won't refetch. Revert detected.",
        ).toBe(true);
      }
    });
  });
});
