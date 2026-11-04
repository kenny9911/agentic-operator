import { chromium } from "@playwright/test";
import { parseArgs } from "node:util";
import { writeFile } from "node:fs/promises";

// Run against `next start`, using real read-only API responses. No test rows,
// mutations, request mocks, or developer browser profiles are involved.
const { values } = parseArgs({ options: {
  url: { type: "string", default: "http://127.0.0.1:3600" },
  tenant: { type: "string", default: "raas" },
  domain: { type: "string", default: "raas" },
  samples: { type: "string", default: "3" },
  "pause-ms": { type: "string", default: "15000" },
  output: { type: "string" },
  "dev-auth": { type: "boolean", default: false },
} });
const origin = new URL(values.url).origin;
if (values["dev-auth"] && !["localhost", "127.0.0.1"].includes(new URL(origin).hostname)) {
  throw new Error("The dev-auth marker is only supported against a loopback test stack");
}
const session = values["dev-auth"] ? "local-performance-probe" : process.env.AGENTIC_BENCHMARK_SESSION;
if (!session) throw new Error("Supply AGENTIC_BENCHMARK_SESSION or explicitly use --dev-auth for a local dev-auth API");
const samples = Number(values.samples);
if (!Number.isInteger(samples) || samples < 1 || samples > 50) throw new Error("samples must be 1–50");
const pauseMs = Number(values["pause-ms"]);
if (!Number.isInteger(pauseMs) || pauseMs < 0 || pauseMs > 60_000) throw new Error("pause-ms must be 0–60000");
const prefix = `/portal/${encodeURIComponent(values.tenant)}/domains/${encodeURIComponent(values.domain)}`;
const browser = await chromium.launch({ headless: true });
const results = [];

async function settle(page, state) {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const deadline = Date.now() + 30_000;
  while (state.pending.size || Date.now() - state.lastActivity < 250) {
    if (Date.now() > deadline) throw new Error(`API requests did not settle: ${[...state.pending.values()].join(", ")}`);
    await page.waitForTimeout(50);
  }
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function sample(language, index) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: "block" });
  await context.addCookies([
    { name: "agentic_session", value: session, url: origin, httpOnly: true },
    { name: "agentic.language", value: language, url: origin },
  ]);
  await context.addInitScript(({ language }) => {
    localStorage.setItem("agentic.tweaks", JSON.stringify({ theme: "dark", language, density: "default", accent: "#d0ff00" }));
    window.__portalTiming = { lcp: 0, longTasks: 0 };
    new PerformanceObserver(list => { for (const e of list.getEntries()) window.__portalTiming.lcp = e.startTime; }).observe({ type: "largest-contentful-paint", buffered: true });
    new PerformanceObserver(list => { for (const e of list.getEntries()) window.__portalTiming.longTasks += Math.max(0, e.duration - 50); }).observe({ type: "longtask", buffered: true });
  }, { language });
  const page = await context.newPage();
  page.setDefaultTimeout(30_000);
  page.setDefaultNavigationTimeout(45_000);
  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 40, downloadThroughput: 1_250_000, uploadThroughput: 625_000 });
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  const state = { pending: new Map(), lastActivity: Date.now(), api: [], errors: [] };
  const isApi = url => url.startsWith(origin) && /\/(v1\/|health(?:\?|$))/.test(url);
  page.on("request", request => {
    if (isApi(request.url())) { state.pending.set(request, new URL(request.url()).pathname); state.lastActivity = Date.now(); }
  });
  const finish = request => { if (state.pending.delete(request)) state.lastActivity = Date.now(); };
  page.on("requestfinished", finish);
  page.on("requestfailed", finish);
  page.on("pageerror", error => state.errors.push(error.message));
  page.on("response", response => {
    if (isApi(response.url())) state.api.push({ path: new URL(response.url()).pathname, status: response.status() });
  });
  try {
    console.log(`Measuring ${language} sample ${index}`);
    const response = await page.goto(`${origin}${prefix}/dashboard`, { waitUntil: "domcontentloaded" });
    if (!response?.ok()) throw new Error(`Dashboard HTTP ${response?.status()}`);
    await page.locator("#portal-view-content").getByRole("heading", { name: /^(Dashboard|仪表盘)$/ }).waitFor();
    // A visible heading alone precedes hydration and the first client requests.
    await page.waitForFunction(() => performance.getEntriesByType("resource").some(e => new URL(e.name).pathname === "/v1/counts"));
    await settle(page, state);
    const initial = await page.evaluate(() => {
      const n = performance.getEntriesByType("navigation")[0];
      const r = performance.getEntriesByType("resource");
      const js = r.filter(e => new URL(e.name).pathname.endsWith(".js"));
      return {
        dataSettledMs: performance.now(), ttfbMs: n.responseStart,
        fcpMs: performance.getEntriesByName("first-contentful-paint")[0]?.startTime ?? null,
        lcpMs: window.__portalTiming.lcp, longTaskBlockingMs: window.__portalTiming.longTasks,
        jsDecodedBytes: js.reduce((sum, e) => sum + e.decodedBodySize, 0),
        jsTransferredBytes: js.reduce((sum, e) => sum + e.transferSize, 0),
        totalTransferredBytes: n.transferSize + r.reduce((sum, e) => sum + e.transferSize, 0),
        externalFontRequests: r.filter(e => /fonts\.(googleapis|gstatic)\.com/.test(e.name)).length,
        domainMetadataRequests: r.filter(e => /\/v1\/domains\/[^/]+$/.test(new URL(e.name).pathname)).length,
      };
    });
    const switches = [];
    for (const feature of ["agents", "dashboard", "workflows", "dashboard"]) {
      const titles = { agents: /^(Agents|智能体)$/, dashboard: /^(Dashboard|仪表盘)$/, workflows: /^(Workflows|工作流)$/ };
      const link = page.locator(`a[href="${prefix}/${feature}"]`).first();
      // Keyboard activation avoids the sidebar hover animation moving the
      // pointer target between Playwright's mousemove and mousedown events.
      await link.focus();
      const start = await page.evaluate(() => performance.now());
      const requestsBefore = state.api.length;
      await link.press("Enter");
      await page.waitForURL(`**${prefix}/${feature}`, { waitUntil: "commit" });
      await page.locator("#portal-view-content").getByRole("heading", { name: titles[feature] }).waitFor();
      await settle(page, state);
      switches.push({ to: feature, settledMs: (await page.evaluate(() => performance.now())) - start, apiResponses: state.api.length - requestsBefore });
    }
    // Leave the Domain cache scope, then revisit it without a document reload.
    const picker = page.locator(`a[href="/portal/${values.tenant}/domains"]`).first();
    await picker.focus();
    await picker.press("Enter");
    await page.waitForURL(`**/portal/${values.tenant}/domains`, { waitUntil: "commit" });
    await page.locator("#portal-view-content").getByRole("heading", { name: /^(Domains|Business Domains|业务域)$/ }).waitFor();
    await settle(page, state);
    const scopeStart = await page.evaluate(() => performance.now());
    const scopeRequests = state.api.length;
    await page.goBack({ waitUntil: "commit" });
    await page.waitForURL(`**${prefix}/dashboard`, { waitUntil: "commit" });
    await page.locator("#portal-view-content").getByRole("heading", { name: /^(Dashboard|仪表盘)$/ }).waitFor();
    await settle(page, state);
    switches.push({ to: "dashboard-after-scope-switch", settledMs: (await page.evaluate(() => performance.now())) - scopeStart, apiResponses: state.api.length - scopeRequests });
    const failedReads = state.api.filter(r => r.path.startsWith("/v1/") && r.status >= 400);
    if (failedReads.length || state.errors.length) throw new Error(`Invalid sample: ${JSON.stringify({ failedReads, errors: state.errors })}`);
    return { language, sample: index, initial, switches, apiStatuses: state.api, browserErrors: state.errors };
  } catch (error) {
    console.error(JSON.stringify({ url: page.url(), headings: await page.getByRole("heading").allTextContents(), errors: state.errors, api: state.api.slice(-15) }));
    throw error;
  } finally { await context.close(); }
}

try {
  // Warm server-side code and OS file cache once. Each measured navigation
  // still gets a fresh browser context (cold HTTP and JS caches).
  await sample("en", 0);
  for (let i = 1; i <= samples; i++) for (const language of ["en", "zh"]) {
    // Respect the shared real API's rate limit; the pause is outside timing.
    await new Promise(resolve => setTimeout(resolve, pauseMs));
    const result = await sample(language, i);
    results.push(result);
    console.log(JSON.stringify({ language, sample: i, initial: result.initial, switches: result.switches, browserErrors: result.browserErrors }));
  }
  const report = { measuredAt: new Date().toISOString(), origin, route: `${prefix}/dashboard`, browser: browser.version(), conditions: { cpuSlowdown: 4, latencyMs: 40, downloadMbps: 10, uploadMbps: 5, quietWindowMs: 250, pauseBetweenSamplesMs: pauseMs, api: "real responses; local development authentication", build: "production next start" }, results };
  if (values.output) await writeFile(values.output, `${JSON.stringify(report, null, 2)}\n`);
} finally { await browser.close(); }
