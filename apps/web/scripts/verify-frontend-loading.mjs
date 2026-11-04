import assert from "node:assert/strict";
import { parseArgs } from "node:util";
import { writeFile } from "node:fs/promises";
import { chromium, expect } from "@playwright/test";

// Read-only checks against `next start` and the real API. Each scenario uses
// an isolated browser context. Delays hold real responses; no fixture data or
// replacement responses are installed, and attempted API writes are blocked.
const { values } = parseArgs({
  options: {
    url: { type: "string", default: "http://127.0.0.1:3601" },
    tenant: { type: "string", default: "raas" },
    domain: { type: "string", default: "raas" },
    output: { type: "string" },
    "dev-auth": { type: "boolean", default: false },
  },
});
const origin = new URL(values.url).origin;
if (
  values["dev-auth"] &&
  !["localhost", "127.0.0.1"].includes(new URL(origin).hostname)
) {
  throw new Error(
    "--dev-auth requires a loopback stack with an explicitly dev-auth API",
  );
}
const session = values["dev-auth"]
  ? "local-performance-probe"
  : process.env.AGENTIC_BENCHMARK_SESSION;
if (!session)
  throw new Error(
    "Provide AGENTIC_BENCHMARK_SESSION or --dev-auth for the local dev-auth API",
  );
const prefix = `/portal/${encodeURIComponent(values.tenant)}/domains/${encodeURIComponent(values.domain)}`;
const browser = await chromium.launch({ headless: true });
const results = [];

function gate() {
  let release;
  const promise = new Promise((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

async function scenario(name, language, run, storedLanguage) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    serviceWorkers: "block",
  });
  const cookies = [
    { name: "agentic_session", value: session, url: origin, httpOnly: true },
  ];
  if (language)
    cookies.push({ name: "agentic.language", value: language, url: origin });
  await context.addCookies(cookies);
  if (storedLanguage) {
    await context.addInitScript((language) => {
      if (localStorage.getItem("agentic.tweaks") === null) {
        localStorage.setItem(
          "agentic.tweaks",
          JSON.stringify({
            theme: "dark",
            language,
            density: "default",
            accent: "#d0ff00",
          }),
        );
      }
    }, storedLanguage);
  }
  const page = await context.newPage();
  page.setDefaultTimeout(20_000);
  page.setDefaultNavigationTimeout(30_000);
  const requests = [];
  const errors = [];
  const writes = [];
  const apiFailures = [];
  const externalFonts = [];
  page.on("request", (request) => {
    requests.push(request.url());
    if (
      request.resourceType() === "font" &&
      new URL(request.url()).origin !== origin
    ) {
      externalFonts.push(request.url());
    }
  });
  page.on("response", (response) => {
    const url = new URL(response.url());
    if (
      url.origin === origin &&
      url.pathname.startsWith("/v1/") &&
      response.status() >= 400
    ) {
      apiFailures.push({ path: url.pathname, status: response.status() });
    }
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await context.route("**/v1/**", async (route) => {
    const request = route.request();
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method())) {
      writes.push(`${request.method()} ${new URL(request.url()).pathname}`);
      await route.abort("blockedbyclient");
      return;
    }
    await route.continue();
  });
  try {
    const details = await run({ page, context, requests });
    assert.deepEqual(
      writes,
      [],
      "A read-only verification attempted an API mutation",
    );
    assert.deepEqual(errors, [], "Browser runtime/hydration errors");
    assert.deepEqual(apiFailures, [], "A required real API read failed");
    assert.deepEqual(externalFonts, [], "A font requested an external origin");
    assert.equal(
      requests.filter((url) => /fonts\.(googleapis|gstatic)\.com/.test(url))
        .length,
      0,
      "External font dependency returned",
    );
    const result = { name, passed: true, ...details };
    results.push(result);
    console.log(JSON.stringify(result));
  } catch (error) {
    console.error(
      JSON.stringify({
        name,
        url: page.url(),
        errors,
        apiFailures,
        blockedWrites: writes,
      }),
    );
    throw error;
  } finally {
    await context.close();
  }
}

async function agentsReady(page, language) {
  await expect(
    page.locator("#portal-view-content").getByRole("heading", {
      name: language === "zh" ? "智能体" : "Agents",
      exact: true,
    }),
  ).toBeVisible();
  // The heading is server-rendered. Wait for the real query and preferences
  // effect before asserting hydration behavior or pressing interactive controls.
  await page.waitForFunction(() =>
    performance
      .getEntriesByType("resource")
      .some((entry) => new URL(entry.name).pathname === "/v1/agents"),
  );
  await expect(
    page.getByRole("button", {
      name: language === "zh" ? "中" : "EN",
      exact: true,
    }),
  ).toHaveAttribute("aria-pressed", "true");
}

const languageRequests = (requests) =>
  requests.filter((url) => new URL(url).pathname.startsWith("/i18n/"));

async function verifyLazyDialog(openerName, loadedText) {
  await scenario(
    `lazy ${openerName} dialog`,
    "en",
    async ({ page, requests }) => {
      await page.goto(`${origin}${prefix}/agents`, {
        waitUntil: "domcontentloaded",
      });
      await agentsReady(page, "en");
      const opener = page.getByRole("button", {
        name: openerName,
        exact: true,
      });
      const hold = gate();
      const delayed = [];
      let delayEnabled = true;
      await page.route(/\/_next\/static\/.*\.js(?:\?|$)/, async (route) => {
        if (delayEnabled) {
          delayed.push(route.request().url());
          await hold.promise;
        }
        await route.continue();
      });
      try {
        await opener.click();
        const loading = page.getByRole("dialog", {
          name: "Loading…",
          exact: true,
        });
        await expect(loading).toBeVisible();
        await expect.poll(() => delayed.length).toBeGreaterThan(0);
        await expect(
          loading.getByRole("button", { name: "Cancel", exact: true }),
        ).toBeFocused();
        await page.keyboard.press("Escape");
        await expect(page.getByRole("dialog")).toHaveCount(0);
        await expect(opener).toBeFocused();

        // Reopen while the same real chunk is pending, then verify focus survives
        // the fallback-to-dialog replacement as well as the eventual close.
        await opener.click();
        await expect(loading).toBeVisible();
        delayEnabled = false;
        hold.release();
        const dialog = page.getByRole("dialog");
        await expect(
          dialog.getByText(loadedText, { exact: true }),
        ).toBeVisible();
        await expect(
          page.getByRole("dialog", { name: "Loading…", exact: true }),
        ).toHaveCount(0);
        await expect
          .poll(() =>
            dialog.evaluate((element) =>
              element.contains(document.activeElement),
            ),
          )
          .toBe(true);
        await page.keyboard.press("Escape");
        await expect(page.getByRole("dialog")).toHaveCount(0);
        await expect(opener).toBeFocused();
        return {
          delayedRealChunks: delayed.length,
          escapeAndFocusRestoration: true,
          localeRequests: languageRequests(requests).length,
        };
      } finally {
        delayEnabled = false;
        hold.release();
      }
    },
  );
}

try {
  await scenario(
    "Chinese SSR, reload, and rapid language switches",
    "zh",
    async ({ page, context, requests }) => {
      const response = await page.goto(`${origin}${prefix}/agents`, {
        waitUntil: "domcontentloaded",
      });
      assert.match(await response.text(), /<html\b[^>]*\blang="zh"/);
      await agentsReady(page, "zh");
      assert.equal(
        languageRequests(requests).length,
        0,
        "Chinese startup fetched a redundant locale",
      );
      await page.reload({ waitUntil: "domcontentloaded" });
      await agentsReady(page, "zh");
      assert.equal(
        languageRequests(requests).length,
        0,
        "Chinese reload fetched a redundant locale",
      );

      const hold = gate();
      await page.route(`${origin}/i18n/en`, async (route) => {
        await hold.promise;
        await route.continue();
      });
      try {
        const started = page.waitForRequest(`${origin}/i18n/en`);
        await page.getByRole("button", { name: "EN", exact: true }).click();
        await started;
        await expect(page.locator("html")).toHaveAttribute("lang", "zh");
        await page.getByRole("button", { name: "中", exact: true }).click();
        const responseFinished = page.waitForResponse(`${origin}/i18n/en`);
        hold.release();
        await (await responseFinished).finished();
        await page.evaluate(
          () =>
            new Promise((resolve) =>
              requestAnimationFrame(() => requestAnimationFrame(resolve)),
            ),
        );
        await expect(page.locator("html")).toHaveAttribute("lang", "zh");
        await expect(
          page.getByRole("button", { name: "中", exact: true }),
        ).toHaveAttribute("aria-pressed", "true");
        await page.getByRole("button", { name: "EN", exact: true }).click();
        await agentsReady(page, "en");
        await page.getByRole("button", { name: "中", exact: true }).click();
        await agentsReady(page, "zh");
        assert.equal(
          languageRequests(requests).length,
          1,
          "Cached language switches issued extra requests",
        );
        assert.equal(
          (await context.cookies()).find(
            (cookie) => cookie.name === "agentic.language",
          )?.value,
          "zh",
        );
        return {
          initialLocaleRequests: 0,
          reloadLocaleRequests: 0,
          languageSwitchRequests: 1,
          staleSwitchIgnored: true,
        };
      } finally {
        hold.release();
      }
    },
  );

  await scenario(
    "legacy localStorage Chinese preference migration",
    null,
    async ({ page, context, requests }) => {
      const response = await page.goto(`${origin}${prefix}/agents`, {
        waitUntil: "domcontentloaded",
      });
      assert.match(await response.text(), /<html\b[^>]*\blang="en"/);
      await agentsReady(page, "zh");
      assert.equal(languageRequests(requests).length, 1);
      assert.equal(
        (await context.cookies()).find(
          (cookie) => cookie.name === "agentic.language",
        )?.value,
        "zh",
      );
      const reloaded = await page.reload({ waitUntil: "domcontentloaded" });
      assert.match(await reloaded.text(), /<html\b[^>]*\blang="zh"/);
      await agentsReady(page, "zh");
      assert.equal(
        languageRequests(requests).length,
        1,
        "Migration repeated after cookie persistence",
      );
      return { migrationRequests: 1, migratedReloadRequests: 0 };
    },
    "zh",
  );

  await verifyLazyDialog("New Agent", "New Agent");
  await verifyLazyDialog("Import manifest", "Import agent manifest");

  await scenario("settings Appearance deep link", "en", async ({ page }) => {
    await page.goto(`${origin}${prefix}/settings?section=appearance`, {
      waitUntil: "domcontentloaded",
    });
    await expect(
      page
        .locator("#portal-view-content")
        .getByRole("heading", { name: "Settings", exact: true }),
    ).toBeVisible();
    await expect(
      page
        .getByRole("group", { name: "Theme", exact: true })
        .getByRole("button", { name: "System", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "English", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "中文", exact: true }),
    ).toBeVisible();
    assert.equal(new URL(page.url()).searchParams.get("section"), "appearance");
    return { selectedSection: "appearance" };
  });

  const report = {
    verifiedAt: new Date().toISOString(),
    origin,
    browser: browser.version(),
    results,
  };
  if (values.output)
    await writeFile(values.output, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Passed ${results.length} read-only frontend loading scenarios.`);
} finally {
  await browser.close();
}
