# P2 Foundation status

Owner: Foundation engineer. Authored 2026-05-20.

Quality gate at submit time: `pnpm --filter @agentic/web typecheck` ✓,
`pnpm --filter @agentic/web lint` ✓, `pnpm --filter @agentic/web test` ✓
(8 files, 47 tests), `pnpm --filter @agentic/web build` ✓ (Next 16 +
Turbopack).

## Per-task summary

| Task | Status | Key file(s) | Test / acceptance |
| --- | --- | --- | --- |
| P2-FE-01 Build pipeline | ✓ done | `apps/web/next.config.mjs` | Production `next build` green; 18 routes register under `/portal/[tenant]/*`. SPA at `apps/web/public/portal/` retained, accessible at `/portal-legacy/*`. |
| P2-FE-02 Design tokens | ✓ done | `apps/web/styles/tokens.css` | All v1_1 vars + density scale + z-index ladder + keyframes + reset. `app/global.css` shrunk to a one-line `@import`. |
| P2-FE-03 Inline-style policy | ✓ done | `apps/web/app/portal/STYLE-GUIDE.md` | Doc explaining inline-only policy, density usage, z-index discipline. |
| P2-FE-04 Monaco from npm | ✓ done | `apps/web/app/portal/components/monaco.tsx` (+ proxy `MonacoEditor.tsx`) | `agentic-dark` theme defined verbatim from v1_1 lines 382-426. `monaco-editor@0.55.1` installed; bundle scan confirms no `unpkg.com/monaco` references in `.next/`. |
| P2-FE-05 Layout shell | ✓ done | `apps/web/app/portal/{layout,page}.tsx`, `[tenant]/page.tsx`, `components/shell/{providers,chrome,sidebar,topbar,nav,tenant-switcher,logo}.tsx` | Auth-gated 232px sidebar + 44px TopBar matching v1_1 app.jsx:108-374. URL drives breadcrumb. |
| P2-FE-06 Core primitives | ✓ done | `apps/web/app/portal/components/index.ts` and siblings | See barrel inventory below. Sparkline math factored to a pure helper with 5 unit tests; formatters have 15 unit tests. |
| P2-FE-16 Tweaks panel | ✓ done | `apps/web/app/portal/components/tweaks/{panel,use-tweaks}.ts(x)` | localStorage-backed `useTweaks` (replaces v1_1 postMessage). 7 controls wired (theme, density, accent, liveStream, showDebug, tenant, dataSource gated behind `showDebug`). Cmd+Shift+T toggles. |
| P2-FE-19 Auth (cookie session) | ✓ done | `apps/web/lib/auth/session.ts`, `apps/web/app/api/auth/{login,logout}/route.ts`, `app/(auth)/sign-in/page.tsx`, `app/portal/layout.tsx` redirect | `jose` HS256 signing. Cookie name `agentic_session`. Dev mode (`AUTH_MODE=dev` or non-prod) mints a synthetic Liu Wei session inline so `/sign-in` forwards straight into the portal. 2 vitest tests cover sign / verify. |
| P2-FE-20 Density wired | ✓ done | `apps/web/app/portal/lib/density.ts`, `tokens.css` `--density-mult` | `:root[data-density="compact"] { --density-mult: 0.85 }`, comfortable `1.18`. `useDensity()` hook + `densityScalar` pure helper. 5 unit tests. Components can opt in via `calc()` strings or the hook. |
| P2-FE-22 Toasts | ✓ done | `apps/web/app/portal/components/toast/index.tsx` | Module-scoped subscription store (firable outside React via `toast({...})`). `<ToastRegion />` mounts in `chrome.tsx`. Max 4 stacked, 4 s auto-dismiss. Used by the TenantSwitcher "New tenant" stub already. |
| P2-FE-23 Cmd-K | ✓ done | `apps/web/app/portal/components/cmd-k/index.tsx` | ⌘/Ctrl+K global keydown opens; Escape closes; ↑/↓/Enter to navigate. Searches view jumps, agents (DataContext), runs (TanStack Query), events, tasks. |
| P2-FE-25 Tenant in URL | ✓ done | `apps/web/app/portal/[tenant]/`, `app/portal/lib/use-tenant.ts` | `useTenant()` + `useTenantNavigate()` from `useParams`/`useRouter`. TenantSwitcher pushes the new tenant. 5 vitest cases for the path-rewrite math. |
| P2-FE-26 Z-index ladder | ✓ done | `tokens.css` (`--z-base/overlay/modal/toast/tooltip`), `apps/web/eslint.config.mjs` | Custom ESLint `no-restricted-syntax` rule fails the build on any `Property[key.name='zIndex'][value.type='Literal']`. Verified by introducing a temp violation; rule fired with the documented message. Existing violators (Modal, Splitter, events page, DeployAgentModal, workflows inspectors) migrated to the var-based form. |

## Stable primitive contract

`apps/web/app/portal/components/index.ts` — view engineers (B + C) import
exclusively from this barrel. Adding a primitive: drop a `<name>.tsx`,
re-export from the barrel, ship.

```ts
// design + status primitives
Icon, type IconName, type IconProps
Badge, ActorTag, StatusDot, Kbd, Empty, eventTone,
  type BadgeProps, type BadgeTone, type ActorTagProps,
  type StatusDotProps, type StatusName
Panel, type PanelProps
Stat, type StatProps
Sparkline, computeSparkPaths, type SparklineProps, type SparkPaths
ViewHeader, type ViewHeaderProps
Button, type ButtonProps, type ButtonTone

// list / table / form primitives
SearchInput, FilterChip, CodeBlock, Th, Td,
  type SearchInputProps, type FilterChipProps
KV, type KVProps

// resizable + modal scaffolding
Splitter, type SplitterProps
ModalOverlay

// code editing
MonacoEditor, type MonacoEditorProps

// cross-cutting plumbing
ToastRegion, useToast, type ToastTone
CommandPalette, useCommandPalette
```

Helpers (separate import paths, not the barrel):

- `@/app/portal/lib/format` — `fmtAgo`, `fmtDur`, `fmtBytes`, `fmtNum`, `fmtTime`
- `@/app/portal/lib/density` — `useDensity()`, `densityScalar()`
- `@/app/portal/lib/use-tenant` — `useTenant()`, `useTenantNavigate()`, `DEFAULT_TENANT`

Style guide enforced: `apps/web/app/portal/STYLE-GUIDE.md` (P2-FE-03).

## Auth flow walkthrough

1. **Cookie shape.** A signed JWT (`jose` HS256) at `agentic_session`, 30 d
   max age, `httpOnly` true, `secure` only in production, `sameSite=lax`.
   Payload: `{ sub, name, initials, tenant }`.
2. **Sign-in.** `/sign-in` reads the existing session; if present, it
   redirects to `?return=` (default `/portal/raas/dashboard`). In dev or
   non-prod it mints a fixture session inline (`Liu Wei / raas`) and
   forwards. In production it renders the magic-link copy (full magic-link
   round-trip is a post-v1 follow-up).
3. **Portal gate.** `app/portal/layout.tsx` server-side awaits
   `readSession()`. No session → `redirect('/sign-in?return=/portal')`.
4. **Login endpoint.** `POST /api/auth/login { email, name?, tenant? }` →
   writes the cookie, returns `{ ok: true, data: { tenant } }`.
5. **Logout endpoint.** `POST /api/auth/logout` clears the cookie.
6. **Secret rotation.** Reads `SESSION_SECRET` from env. Falls back to a
   placeholder in dev only — production builds must inject a real value.

API-side cookie acceptance is **not yet wired** — `apps/api/src/plugins/auth.ts`
still expects `Authorization: Bearer …`. In dev with `AUTH_MODE=dev` this
is fine because the API resolves a fixed dev tenant regardless. Wiring
cookie auth into Fastify is a small follow-up (read the same JWT, verify
with the same `SESSION_SECRET`, set `req.auth`) — flagging here so the
backend engineer can pick it up.

## What view engineers (B + C) need to know

- **Import surface.** Pull every shared primitive from
  `@/app/portal/components`. The lowercase file inside (icon.tsx → Icon.tsx)
  was renamed mid-task because Next 16 treats `app/portal/components/icon.*`
  as a special icon route; all internal imports updated.
- **Path = source of truth.** Don't keep `view` in component state. Use
  `useParams<{...}>()` + Next routes. Tenant comes from `useTenant()`.
- **Live data.** Mount nothing yourself — `chrome.tsx` already mounts
  `useStream()` once per portal session, and `PortalProviders` owns the
  TanStack `QueryClient` + the `DataProvider`. Just call `useRuns()` /
  `useEvents()` / etc. and read the snapshot from `useRaasData()`.
- **Toasts.** Failed mutations must surface — call `toast({ tone: "red",
  title, description })` from inside (or outside) a component. The region
  is already mounted in chrome.
- **Z-index.** Never write a numeric `zIndex` literal in a portal `.tsx`.
  Use the `--z-*` tokens via `zIndex: "var(--z-modal)" as unknown as number`.
  ESLint will fail your PR otherwise.
- **Density.** Most components don't need density-aware sizing — the
  prototype's whitespace tolerates the 0.85 → 1.18 range. If a row or KPI
  needs it, prefer `padding: "calc(14px * var(--density-mult))"` over the
  hook (CSS path keeps SSR clean).
- **Tweaks panel & Cmd-K.** Both are mounted globally; nothing to do.
  Hotkeys: ⌘+K (palette), ⌘+Shift+T (tweaks).

## Known follow-ups (out of strict scope but flagged)

- Cookie-auth path on the Fastify side (`apps/api/src/plugins/auth.ts`).
- A Playwright visual diff confirming `compact` ≠ `default` (spec item in
  P2-FE-20). The unit tests cover the scalar math; the visual regression
  belongs with the wider pixel-diff harness (audit R-6) that another
  engineer is wiring.
- The Next.js ESLint preset isn't extended in `eslint.config.mjs` — the
  FlatCompat bridge tripped a circular-reference bug. Wiring a typed
  ESLint preset back in is a separate fix.
- Magic-link production sign-in (audit §8 #1). `/sign-in` documents the
  contract; the actual mail-out flow is post-v1.
