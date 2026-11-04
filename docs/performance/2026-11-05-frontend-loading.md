# Frontend loading review — 2026-11-05

The production-build browser benchmark measured an initial dashboard FCP reduction from **1,012 ms to 294 ms**, sampled LCP from **1,604 ms to 974 ms**, and dashboard API-settled time from **2,105 ms to 1,560 ms**. Initial JavaScript transfer decreased **43.5%**. Returning to a previously visited Domain after leaving its cache scope decreased from **711 ms to 367 ms**.

These are controlled local measurements with a production Next.js build, not deployed production or real-user timings. Ordinary warm dashboard navigation was already fast and changed little.

## Comparison and conditions

The baseline is integration commit `86dc662c`, which combines the existing committed Domain/runtime work at `e2f06ef6` with main `84a1f3b3`. The comparison is against the performance changes built on that integration. The Domain/runtime prerequisite is present on both sides; these results do not compare against an older application without Domain navigation.

Both runs used:

- `next start`, with a warm server and operating-system file cache after one excluded warm-up scenario.
- Chromium `148.0.7778.96`, headless, 1440 × 1000 viewport; a fresh browser context per sample, with cold browser HTTP/JavaScript caches and service workers blocked.
- Configured CDP throttling of 4× CPU slowdown, 40 ms network latency, 10 Mbps download and 5 Mbps upload.
- Three measured samples per language, English and Chinese, alternating within each run. Language cookie and localStorage agreed. There were six measured samples per build, with a 15-second pause between samples outside the measured interval.
- Real, read-only API responses and local development authentication. No mocked responses, synthetic runtime rows, or API mutations.
- The dashboard for an existing Tenant/Domain, followed by Agents → Dashboard → Workflows → Dashboard, then the Domain picker and browser Back to the same dashboard.

The baseline and changed builds were served on loopback ports 3600 and 3601 respectively. Runs completed on November 5, 2026, at approximately 04:24 and 04:27 Singapore time. Both had zero browser runtime errors and zero failed `/v1/*` reads. `/health` returned a real unhealthy report with HTTP 503 in both runs; the benchmark accepts that report and does not claim the entire runtime was healthy.

The [benchmark script](../../apps/web/scripts/benchmark-portal.mjs) defines API settling as no tracked `/v1/*` or `/health` requests in flight, at least 250 ms since the last tracked API activity, and two animation frames. It also waits for the route heading and, on initial load, evidence that the client counts request ran. This is an application-specific readiness approximation: it excludes persistent SSE and later polling, and does not prove every future render or background operation has finished. A warm switch with no new API activity does not necessarily incur an additional fixed 250 ms delay. LCP and accumulated long-task blocking are sampled at initial settling, before navigation interactions.

## Results

Values below are **pooled medians of all six samples per build**, not averages of the two language medians. Timing values are rounded to the nearest millisecond; percentages use unrounded medians.

| Initial dashboard metric | Before | After | Change |
| --- | ---: | ---: | ---: |
| First contentful paint | 1,012 ms | 294 ms | −71.0% |
| Sampled largest contentful paint | 1,604 ms | 974 ms | −39.3% |
| Dashboard API-settled time | 2,105 ms | 1,560 ms | −25.9% |
| JavaScript transferred | 624,835 B | 353,193 B | −43.5% |
| JavaScript decoded body size | 2,063,245 B | 1,298,273 B | −37.1% |
| Total measured transfer | 698,746 B | 673,238 B | −3.7% |
| Browser requests to external Google font services | 1 | 0 | Removed |
| Browser domain-detail requests during initial load | 1 | 0 | Moved to server verification |

JavaScript transfer uses completed script resources' `PerformanceResourceTiming.transferSize`, including response overhead. Decoded size uses `decodedBodySize`. Total transfer includes the navigation response and completed resource entries at the initial checkpoint. The reduction in JavaScript must not be presented as an equal reduction in total payload: the selected dictionary now travels as server-provided HTML/RSC data, and fonts are served locally.

| Navigation, in scenario order | Before | After | Change | API responses before → after |
| --- | ---: | ---: | ---: | ---: |
| Dashboard → Agents | 614 ms | 557 ms | −9.3% | 1 → 1 |
| Agents → warm Dashboard | 129 ms | 128 ms | −1.4% | 0 → 0 |
| Dashboard → Workflows | 965 ms | 712 ms | −26.3% | 14 → 9 |
| Workflows → Dashboard | 432 ms | 377 ms | −12.8% | 5 → 1 |
| Domain picker → previous Dashboard using browser Back | 711 ms | 367 ms | −48.4% | 19 → 3 |

API response counts are medians over the timed interval, including background refreshes that happen within it. They are not counts of unique endpoints. The last row measures re-entering an already visited Tenant/Domain cache scope; it does not measure a first visit to another Tenant or Domain.

Per-language initial medians, three samples each:

| Language | FCP before → after | Sampled LCP before → after | API-settled before → after |
| --- | ---: | ---: | ---: |
| English | 1,012 → 292 ms | 1,660 → 988 ms | 2,110 → 1,559 ms |
| Chinese | 1,012 → 296 ms | 1,600 → 960 ms | 2,098 → 1,561 ms |

The changes did **not** improve every measure. Median navigation TTFB increased from 9.3 ms to 20.1 ms, consistent with doing domain verification before returning the page. Accumulated long-task blocking at the initial checkpoint increased from 209.5 ms to 227.5 ms. No INP, field Core Web Vitals, or general rendering-CPU improvement is established by this experiment. Three samples per language are a small local comparison; small differences, especially the warm dashboard result, should not be treated as statistically established gains. Live query freshness and event-driven invalidation also affect the API-settled measurements.

## Five changes

1. **Load only the selected locale initially.** The server reads a validated language cookie and provides one complete dictionary. English fallback leaves are merged server-side for Chinese. The other locale is fetched only when selected; repeated requests are deduplicated, stale completions cannot overwrite a newer selection, and failed loads preserve the currently rendered language. Existing localStorage preferences migrate to the cookie.
2. **Serve fonts locally.** `next/font/local` replaces the render-blocking Google Fonts stylesheet. Only the sans face is globally preloaded; mono and display faces load when used. The checked-in font assets include source and license records.
3. **Defer optional interfaces.** Tenant creation/import, agent dialogs, workflow editors/help/run console, and inactive Settings sections use conditional dynamic imports. Loading dialogs remain dismissible and restore focus. The one-time token-reveal dialog stays eager so loading cannot bypass its acknowledgment requirement.
4. **Verify domain metadata before hydration.** The Domain server layout forwards the opaque session cookie and explicit owner selector to the API with `no-store`, validates the response, and hydrates the exact domain-detail query. Child page queries can then mount without a preceding browser metadata request. Denied or archived domains omit protected children even if the browser has cached success; newer browser query data is preserved.
5. **Retain isolated caches for visited scopes.** A portal instance retains up to four Tenant/Domain query clients with least-recently-used eviction. Legacy query keys remain isolated, inactive requests/retries are canceled, and logout or password reauthentication clears every retained scope. Ordinary navigation within a scope keeps its client; actual scope changes remount observers against the correct client. Scoped SSE cursors resume each stream from its prior position, and a single portal-shell listener owns shared cache invalidation, avoiding historical replay and duplicate invalidations on return.

## Reproduction

Use Node **26.8.1**, pnpm **11**, installed workspace dependencies, and Playwright Chromium. Prepare an existing authorized Tenant/Domain and a running API. Keep its data and configuration unchanged between builds. Build and start the baseline and changed checkouts separately; use the changed checkout's benchmark script to measure both servers.

```bash
# Run in each checkout; keep production build artifacts separate from next dev.
nvm use
AGENTIC_API_URL=http://127.0.0.1:3540 pnpm --filter @agentic/web build

# In a baseline-checkout terminal, after building commit 86dc662c:
AGENTIC_API_URL=http://127.0.0.1:3540 pnpm --filter @agentic/web exec node scripts/next-with-env.mjs start --port 3600

# In a changed-checkout terminal, after its build:
AGENTIC_API_URL=http://127.0.0.1:3540 pnpm --filter @agentic/web exec node scripts/next-with-env.mjs start --port 3601
```

For an explicitly configured local `AUTH_MODE=dev` API, run these from the changed checkout, sequentially:

```bash
pnpm --filter @agentic/web exec node scripts/benchmark-portal.mjs --url http://127.0.0.1:3600 --tenant raas --domain raas --samples 3 --pause-ms 15000 --dev-auth --output /tmp/agentic-frontend-before.json
pnpm --filter @agentic/web exec node scripts/benchmark-portal.mjs --url http://127.0.0.1:3601 --tenant raas --domain raas --samples 3 --pause-ms 15000 --dev-auth --output /tmp/agentic-frontend-after.json
pnpm --filter @agentic/web exec node scripts/verify-frontend-loading.mjs --url http://127.0.0.1:3601 --tenant raas --domain raas --dev-auth
```

Replace the Tenant/Domain selectors with existing authorized scopes as needed. For authenticated environments, omit `--dev-auth` and supply `AGENTIC_BENCHMARK_SESSION` through private local environment configuration; do not put a session value in the command, report, or commit. `--dev-auth` is restricted to loopback URLs and does not configure or bypass API authentication itself.

The raw benchmark JSON files remain local. They include runtime request paths and are intentionally not committed. This report retains only aggregate performance measurements and verification outcomes.

## Validation and limits

The final production build, all 29 workspace typecheck tasks, and lint passed. The earlier full frontend coverage run passed 1,155 tests across 132 files, with 88.07% lines and 78.54% branches on the repository's configured coverage surface; that run preceded the final SSE cursor changes. The latest focused cursor-related checks passed 48 tests. Five final read-only production-browser scenarios passed: Chinese SSR/reload and rapid switching; localStorage migration; deferred New Agent dialog; deferred manifest-import dialog; and the Settings Appearance deep link. These scenarios checked real reads, delayed real chunk responses, hydration/runtime errors, Escape/focus restoration, and absence of external font requests.

Repository-wide validation has distinct blockers and must not be described as fully passing:

- Root `pnpm test` stops because the preexisting release artifact `artifacts/ontology/Agents-generation/v0_4_001/release_bundle_v0_4_001.json` is absent in the checkout. This is outside the frontend changes; no substitute release artifact was manufactured.
- Recursive workspace `test` stops at `@agentic/mcp` because its plain `vitest run` finds no test files. The repository CI uses `pnpm -r test:coverage`; the two commands are not interchangeable evidence of a passing CI run.
- The final full web, runtime, and API retries encountered `ENOSPC` after storage filled, including API database-open failures. Those attempts do not establish passing full-suite results for the final changes. Focused checks for the integration fixes passed separately: Domain hierarchy 15/15, LLM settings 40/40, and RAAS requirement sync 9/9. Consult the PR's latest required checks for final delivery status.

The baseline integration also exposed two fixture/compatibility issues addressed during validation: reserved legacy tenant slugs such as `__system` must not be forced into new native-adapter coordinates, and a cron delivery test must provision its real namespace before checking the lifecycle-gated producer. Existing adapter validation and the scheduler's archive gate remain enforced.
