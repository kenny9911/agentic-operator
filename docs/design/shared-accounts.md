# Shared OntoPlanet accounts

Agent OS can authenticate through the OntoPlanet account authority hosted by
Ontology Studio. PostgreSQL owns usernames, password hashes, approval decisions,
product access and sessions. Operator's Fastify API calls this authority; its
Next.js portal continues to have no database or account-service credentials.

This first stage shares accounts. Users sign in separately to each product;
it does not implement OpenID Connect or promise seamless browser SSO. CSI SSO
does not determine these accounts' status or access.

## Configuration

Configure the API's existing governed environment, without committing values:

```dotenv
AUTH_MODE=accounts
ACCOUNT_AUTHORITY_URL=http://localhost:3500
ACCOUNT_OPERATOR_CLIENT_SECRET=
WEB_ORIGIN=http://localhost:3599
```

The client secret must be the same dedicated Operator backchannel secret as
Studio and contain at least 32 bytes. Set it through the deployment's secret
manager. Production requires an HTTPS authority origin, and the URL must not
contain credentials, paths, queries or fragments. Local HTTP is accepted only
for localhost/loopback outside production. Keep the API private to the web
proxy where possible. `WEB_ORIGIN` is also checked on browser-originated account
mutations. These settings are never exposed as `NEXT_PUBLIC_*` values.

Apply migration `0084_account_authority_projection` using the governed
`pnpm db:migrate` path and the canonical SQLite writer supervisor. The migration
adds projection columns and preserves all existing user IDs and foreign keys.
It neither migrates runtime state to PostgreSQL nor creates account credentials.
Do not apply it by opening a second writable database connection beside the API.

Existing local mode remains available for installations that have not migrated.
In accounts mode, no local password or legacy session JWT is accepted for a
human login, and an unavailable authority never triggers a local fallback.
Tenant-scoped API tokens retain their separate machine-authentication policy.

## Product entry and remembered sessions

The OntoPlanet Agent OS link targets the configured Operator web origin's root
(`/`, locally port 3599). Operator verifies its own existing session through the
API. A valid session continues to `/portal`, where the current tenant routing applies. An unsigned visitor sees an automatically opened sign-in/signup
dialog on the Agent OS origin. Closing the dialog leaves an Enter Agent OS
button; no tokens or cookies are transferred from the suite landing page.

The standalone `/sign-in` and `/sign-up` pages remain available, including safe
same-origin `return` deep links. Password fields have keyboard-accessible view/hide
buttons and standard username/current-password/new-password autocomplete metadata.
Password saving is handled by the browser's password manager; the application does
not store passwords in browser storage.

In accounts mode, “Keep me signed in” is checked by default and sends an explicit
boolean `rememberMe` to the authority. A checked login requests a 30-day authority
session and sets the cookie lifetime from the returned `expiresAt`. Unchecked or
omitted `rememberMe` requests a 24-hour authority session and sets a browser session
cookie without Max-Age or Expires. Existing sessions are preserved and continue to
be revalidated; legacy local authentication keeps its existing cookie policy.
Account pause and revocation still take effect independently of remembered expiry.

## Account and product access lifecycle

Registration submits username/password and an optional display name. The
authority normalizes a username to lowercase ASCII and accepts 3–32 characters
matching `[a-z0-9][a-z0-9_.-]{2,31}`. A password requires at least 15 Unicode
characters and at most 72 UTF-8 bytes. Registration returns `pending` and never
issues a session. An administrator approves or rejects the account in Studio;
an approved account also needs explicit Agent OS tenant grants before login.

The Studio administrator reads the Operator tenant picker through
`GET /v1/auth/authority/tenants`, authenticated with the dedicated client key.
Its raw response is `{ tenants: [{ id, slug, name }] }`. It excludes archived
tenants and reserved `__*` tenants. Grants contain
these immutable local tenant IDs, never inferred slugs. No tenant is created as
a side effect of login.

An approved login receives a product-bound opaque session from PostgreSQL.
Only the API sets the host-only, HttpOnly, SameSite=Lax `agentic_session` cookie
(Secure in production). Plaintext tokens are neither returned in portal JSON
nor stored in SQLite. Every protected human request inspects the token against
the current PostgreSQL account and product grants. There is no positive
authorization cache. Invalid/expired/revoked sessions deny access; authority
transport or schema failures return service unavailable.

Pause/reject and password changes revoke sessions centrally. Logout revokes the
current product session; if the authority is unavailable, the local cookie is
still cleared but the API reports that revocation could not be confirmed.
Password change uses `/v1/me/password`, verifies the current credential centrally,
and redirects to sign-in after central session revocation. Resuming an account
requires a fresh login.

## Local projection and authorization

`users.authority_account_id` is the unique immutable mapping to the existing
Operator `users.id`. `authority_username` and `name` are display projections.
New authority principals have no local password or platform-superadmin role.
Username-only accounts have no email; the legacy non-null string uses an empty
value, and the unique email index remains enforced for legacy principals only.
No account is linked by email or username. Existing principals keep their IDs;
linking a historical principal requires an explicit reviewed mapping migration
after ownership verification, rather than automatic matching during login.

Current central tenant grants are projected to `memberships` on authenticated
requests. These rows support existing queries but do not constitute a second
grant authority. Membership writes and account lifecycle/password edits are
refused locally in accounts mode. Runtime data, tokens, evidence and audit foreign
keys remain tenant-scoped. This delivery uses the main branch's existing tenant
model; the separate Tenant/Domain hierarchy work is not included.

All existing lifecycle, run-log, OntoCode and Factory SSE surfaces re-inspect
accounts asynchronously before writing data, including buffered frames. Writes
are serialized or checked before each awaited frame. Revoked accounts, changed
grants or authority failure close the connection. Quiet streams recheck on their
existing heartbeat/poll (up to 15 seconds); they transmit no subsequent protected
frame after a failed recheck. This does not cancel an already-authorized durable
agent run, which has its own operational cancellation policy.

The fixed-tenant `AO_API_KEY` live execution bridge is still separate. Shared
accounts do not make that service credential suitable for multi-tenant access.

## Backchannel contract

The API sends `Authorization: Bearer <ACCOUNT_OPERATOR_CLIENT_SECRET>` to
Studio's `/api/accounts/operator/{register,login,inspect,revoke,password}`.
Tokens are carried only in request/response bodies over the authenticated
backchannel and the host cookie. Requests have a five-second timeout, reject
redirects and never include underlying transport errors or secret material in
user-facing errors. The public `/v1/auth/config` reveals only `accounts` or
`local`, so the portal renders the matching credential form without receiving
server configuration.

Regression coverage lives in `apps/api/test/account-authority.test.ts`, alongside
the existing lifecycle/run-log stream and local auth/RBAC suites. Those tests use
a mocked authority and isolated SQLite fixtures; they do not prove a deployment
has applied migrations, configured PostgreSQL, connected both products or passed
a real administrative approval round trip.

## Local integration acceptance (2026-09-10)

The account integration was exercised against the actual Studio account routes
on port 3500 and an isolated PostgreSQL account database. Operator used a fresh,
migrated SQLite fixture and its actual Fastify auth, membership and lifecycle
stream routes on port 33540. The actual portal `AuthForm` ran in an isolated
browser preview on port 33599, with requests forwarded to that API.

- Studio browser approval granted `browser.member` Studio access and an explicit
  Agent OS viewer grant for local tenant ID `ten-account-acceptance`.
- The Operator browser sign-in succeeded with the shared username and password.
  `/v1/me` returned the central account ID and the expected tenant/viewer role.
  An authenticated request selecting an ungranted tenant returned 403.
- A lifecycle SSE connection was opened with the approved Operator session.
  Pausing the account through Studio's administrator UI closed that existing
  stream. The saved Operator session then returned 401, and a fresh login
  returned 403 with `account_paused`.
- Operator browser signup for `operator.pending` returned 201 with account status
  `pending`. The UI remained on signup, displayed the approval-pending message
  and received no `agentic_session` cookie.

The browser preview redirected successful login to an identity inspection page;
this verified the real form, cookies and account integration, not the full Next.js
dashboard or a production deployment. Separate component browser checks covered
English/Chinese and Light, Dark and System appearance. The affected automated
checks passed: 51 API tests, eight web tests, API/web typechecks, affected web
lint and `git diff --check`.

The temporary Operator services were stopped after acceptance. No normal
Operator service, live environment file or live runtime database was changed.
Only status reports and screenshots were retained; test session tokens were
kept in process/browser memory and were not written to those reports.

## Product-entry verification (2026-09-11)

An isolated Next.js fixture ran the actual root, sign-in and signup routes and
components, with a mocked API and an explicit portal destination marker. Browser
checks confirmed automatic dialog opening, initial input focus, keyboard password
reveal/hide, Escape dismissal with focus restoration, and switching to signup
without changing the product root URL. Pending signup displayed approval feedback
without a cookie. Login forwarded the checked/unchecked remember choice, and the
browser observed persistent/session cookie behavior respectively. Revisiting `/`
with the verified cookie returned a 307 redirect to `/portal`; standalone auth
routes and a bookmarked `return` destination also worked. Light, Dark, System,
Chinese and a 390-pixel mobile viewport were visually checked.

The affected checks passed: 21 account-authority API tests, 15 legacy auth/RBAC
tests, eight web session/i18n tests, API/web typechecks, affected web lint and
`git diff --check`. The API tests independently cover boolean validation,
remember-choice forwarding and respecting authority expiry. This browser fixture
does not establish production deployment, real password-manager save prompts or
the full portal's behavior. Temporary services were stopped; normal services and
live configuration/database files were left untouched.

## Default-branch delivery

The release branch ports only the account and product-entry changes onto the
current default branch. It does not include the twelve unrelated local hierarchy
and runtime commits used during the earlier acceptance run. This branch uses
`0084_account_authority_projection` and existing tenant/dashboard routing. A later
hierarchy integration must reconcile its migration numbers and add internal
execution-namespace filtering to the authority tenant catalogue. The earlier
acceptance results above identify the checkout and fixture they exercised;
release validation is reported separately on the pull request.
