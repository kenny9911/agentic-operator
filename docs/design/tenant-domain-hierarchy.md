# Tenant and Domain hierarchy

**Date:** 2026-09-10. **Decision:** [ADR-0013](../adr/0013-tenants-own-business-domains.md). **Status:** implemented in source and exercised in an isolated live stack. Applying the migration to another environment remains a separate deployment operation.

Agentic Operator adopts OntoPlanet's **Tenant → Domains** ownership model. Workflows, Agents, OntoCode and monitoring remain shared product capabilities. Selecting a Domain chooses its authorized business records and runtime, with independent names, live deployment state, events, runs and logs.

## Ownership and execution

[Migration 0084](../../packages/db/drizzle/0084_tenant_domain_hierarchy.sql) introduces an explicit Domain owned by one product Tenant. `(tenantId, slug)` is unique. Each Domain also has a globally unique `runtimeTenantId` referencing its exclusive execution namespace in the existing `tenants` table. Database constraints prevent duplicate namespaces and mutation of ownership, namespace, default status or slug.

| Identity                                      | Meaning                                                                                  |
| --------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `domains.tenantId`                            | Product Tenant that owns the Domain.                                                     |
| `domains.id` / `domains.slug`                 | Stable local Domain identity and tenant-relative route slug.                             |
| `domains.runtimeTenantId`                     | Exclusive storage and execution namespace; used by existing runtime tables.              |
| `auth.ownerTenantId` / `auth.ownerTenantSlug` | Authenticated product owner used by tenant administration.                               |
| `auth.domainId` / `auth.domainSlug`           | Authorized selected Domain.                                                              |
| `auth.tenantId` / `auth.tenantSlug`           | Technical execution coordinates consumed by existing domain-scoped APIs, jobs and tools. |

An existing Tenant receives a **Default Domain** with the same namespace and slug. New parent Tenants receive their empty Default Domain on first resolution. Its Global tools native profile is provisioned only when there are no workflows, Agents, Runtime Profiles, deployment history beyond the runtime selection marker, or published custom registry snapshot. Migration-created defaults retain their existing configuration. Creating another Domain atomically allocates a distinct internal tenant row with an opaque `dr-…` slug, marks it as an internal namespace, adds the Domain, creator grant, empty budget, stopped deployment marker and built-in native Runtime Profile. Internal namespaces do not appear as product Tenants and are never granted ordinary tenant memberships automatically.

Runtime resources retain their existing namespace ownership. This avoids rewriting every historical table or adding duplicate scope columns to descendants: one namespace maps to exactly one Domain, and that Domain maps to one owner. Workflow and event names may repeat in sibling Domains because their namespace keys differ. Logs, memory, business records, imports, deployments, usage and evidence retain this boundary. Do not substitute the parent id into these runtime queries or event names.

[Domain services](../../apps/api/src/services/domains.ts), [request scope resolution](../../apps/api/src/plugins/domain-context.ts) and [runtime lifecycle checks](../../packages/runtime/src/domain-scope.ts) enforce the mapping. Both manifest and code-defined agents check lifecycle; cron delivery and deferred runtime work cannot reactivate an archived Domain or owner merely by retaining an old payload.

## Access and lifecycle

For browser/dev access the server verifies membership in the owning Tenant, then the selected Domain's effective role:

- A platform superadmin or owning Tenant admin can administer and use its Domains.
- Default Domain authority follows the user's **current** parent membership. A stale migrated grant cannot reverse a downgrade.
- An ordinary parent member needs an explicit grant to a child Domain. A Domain admin does not become an owning Tenant admin.
- Creating Domains and granting/revoking child access require owning Tenant administration. The Domain members panel shows the parent roster and explicit Domain grants; default access is managed through Tenant membership.
- API tokens can select only the Domain whose runtime namespace already owns that credential. Legacy owner tokens address the Default Domain and gain no sibling access. Domain tokens cannot administer the parent Tenant.

The URL and `x-agentic-tenant` / `x-agentic-domain` headers are selectors, never grants. Invalid owner/domain combinations and archived or missing domains fail closed. Browser sessions must select an owner and Domain; direct internal-namespace selection is rejected. Legacy requests without a Domain retain the exact Default Domain for compatibility, rather than selecting a first child from a list.

Domain archive uses owner and namespace mutation leases, rejects active runs (including paused runs), human tasks and active Factory/OntoCode work, records the Domain lifecycle change and disables that namespace's Inngest selection. Broker synchronization is part of the transition. Failure restores the previous Domain and deployment selection and resynchronizes the prior runtime. Restore preserves the pre-archive deployment preference. Archiving the Default Domain does not archive its parent or siblings.

Parent archive disables all child runtime namespaces and checks for their active work. Parent restore leaves independently archived child Domains archived. Migration therefore does not copy an owner's archived timestamp into a new default Domain; parent lifecycle is checked separately.

## Configuration and ontology boundaries

The first implementation shares ownership and administration. It does **not** automatically share existing namespace-scoped configuration:

| Resource                                     | Current behavior                                                                                                                                                                                                 |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Integrations and scoped provider credentials | Configure in the selected Domain; parent/default credentials are not copied into a child. Existing explicit platform configuration fallback remains available under its current policy.                          |
| Runtime Profiles                             | Stored in the selected Domain's namespace. A new child gets a `Global tools` native profile pinned to `global-tools-v1`. It adds no custom tools or prompts and requires no tenant TypeScript package.           |
| Tool authority                               | Existing global tools are available to declare; each Agent's allow-list still controls invocation. Creating a Domain grants no extra business-tool authority.                                                    |
| Skills                                       | Private libraries remain namespace-scoped; explicitly platform-shared Skills retain their sharing policy. Sibling private Skills are not inherited.                                                              |
| Budgets and usage                            | Namespace budgets and usage attribution remain independent. A new namespace has the existing empty/unlimited budget defaults; parent-wide budget aggregation and shared caps are not implemented by this change. |
| Ontology registrations                       | Existing source-qualified registrations stay in their namespace and therefore belong to its Domain. Their default registration is independent of sibling Domains.                                                |

The native profile describes the built-in empty adapter; global Tools retain their separate implementation and evidence identities. A live custom tenant-code deployment replaces this default and must load the exact reviewed version. The default cannot silently stand in for missing custom code. An existing owned Domain namespace also cannot be reassigned as another Domain's compatibility adapter. Compatibility adapters may reuse only an already explicit namespace marker assigned to the same owning runtime context. Selecting a profile cannot convert an ordinary Tenant into an internal namespace, including a new Tenant whose Default Domain has not yet been resolved; creating a compatibility namespace requires explicit provisioning or migration.

An Ontology Registration identifies authoritative input, not product ownership. Multiple source registrations can describe the same upstream ontology id without becoming separate product Domains. Existing source ambiguity and exact registration checks remain in force. The hierarchy does not establish shared database ids, shared sessions, or a verified service/Tenant/Domain mapping with OntoPlanet. Cross-product owner consolidation and stronger upstream identity constraints remain separate work requiring explicit identities.

## Navigation and operator workflow

The authenticated portal exposes:

```text
/portal/<tenant>/domains
/portal/<tenant>/domains/<domain>/workflows
/portal/<tenant>/domains/<domain>/agents
/portal/<tenant>/domains/<domain>/ontology
/portal/<tenant>/domains/<domain>/ontocode-workspace
/portal/<tenant>/domains/<domain>/runs
/portal/<tenant>/domains/<domain>/logs
/portal/<tenant>/domains/<domain>/settings
```

Tenant and Domain selectors are distinct. Shared feature components receive the selected scope through thin route files. Query-cache lifetimes, requests, mutations, streams and saved browser state carry the full scope, so sibling Domains and separate tabs do not reuse one another's records.

Legacy feature bookmarks redirect only through the API's recorded active Default Domain, preserving record identifiers and query parameters. If no authorized default is available, the portal opens the Domain picker; it does not silently select a sibling.

To create, build and operate a Domain:

1. **Create.** Select the owning Tenant, open Domains and create a Domain with a unique local slug and name. Add existing Tenant members through its access panel when they need to work there. The new Domain contains no synthetic workflow or run history.
2. **Configure.** Open the Domain's Settings and configure the model route, provider access and integrations required by the intended Agent. Review its budget. Parent membership alone does not supply another Domain's credentials.
3. **Build.** Create a blank Workflow and Agents in the Workflows/Agent Studio surfaces and validate the draft, or open Ontology to register/upload authoritative input and bind the available Global tools profile before creating an OntoCode Project. OntoCode still requires its normal model, sandbox, evidence and promotion prerequisites. An executable adapter is not evidence that those external prerequisites have passed.
4. **Start and publish.** Start that Domain's Inngest runtime using its deployment control, then publish the validated Workflow as a live version. New Domains start stopped. Wait for the control plane to confirm the function registration; a saved definition alone is not a running workflow.
5. **Run.** Invoke the selected Agent or submit its declared triggering Event with a real input and subject. Keep the selected Domain throughout the operation. API clients supply the owner and Domain headers, using a credential authorized for that exact namespace.
6. **Monitor.** Open the Domain's Runs, Events, Tasks and Logs. Read the resulting Run and Step output; resolve human tasks within the same Domain. Switching to a sibling should show that sibling's independent history. A successful request, a completed Run and a verified business effect are different results.

## Upgrade and recovery

The migration is additive and journaled. It backfills existing product owners and their default grants, excludes internal namespace markers, and does not rewrite resource ids, immutable versions, token digests, signed evidence, workflow hashes, audit history, storage paths or event/function names. Re-running the governed migration is idempotent. On-demand default creation is also idempotent and preserves existing names and grants.

Use the [hand-authored migration convention](../adr/0010-migrations-are-hand-authored.md) and normal `pnpm db:migrate` writer-supervision path. Back up the intended database before applying it. The implementation does not infer that `power-purchase`, `power-scm` and other existing owners belong to one real customer; each initially keeps its owner and adopts its current resources into a Default Domain.

Moving existing scopes under a different owner requires a separate reviewed mapping of source tenant/namespace, target owner, local Domain, authoritative upstream identities, included records, grants, credentials, transport/storage aliases and evidence revalidation. Do not update the immutable Domain ownership fields or union former memberships to bypass that migration. Historical signed evidence must not be re-signed to claim it originated under a different owner.

Before reverting application code, stop newly created child runtime namespaces. Old code does not enforce child grants or understand the product ownership distinction, and a new internal namespace must never become an ordinary selectable Tenant. Preserve the database backup, namespace mapping and runtime selection records together; automatic down-migration is not provided.

## Verification

[Focused Domain tests](../../apps/api/test/domain-hierarchy.test.ts) run against an isolated in-memory database and cover migration preservation/idempotence, unique sibling namespaces, grants, foreign-owner rejection, token confinement, lifecycle compensation, paused-work protection and the ready built-in native profile. Run them without accessing the live database:

```bash
pnpm --filter @agentic/api exec vitest run --config test/domain-hierarchy.isolated.config.ts
pnpm --filter @agentic/contracts typecheck
pnpm --filter @agentic/db typecheck
pnpm --filter @agentic/api typecheck
pnpm --filter @agentic/web typecheck
pnpm --filter @agentic/web lint
```

On 2026-09-10, isolated live acceptance used web `3598`, API `3541`, real Inngest `8490` and the configured `custom/openai-gpt-5.6-luna` model route. An authenticated browser created a Purchasing Domain and blank Workflow, validated one prompt, received a real draft reply, started the Domain runtime and published a version registered as one broker function. Event `evt-ebcd7aebe14a` produced durable Run `run-7b0a30772b1d`: one successful Step, 1.78 seconds, 1,097 input tokens and 16 output tokens. Browser read-back displayed seven real log lines and the saved output `Published Purchasing workflow succeeded.` The Domain's recorded namespace was `dr-13df00f634b64aeda59e68ab`. This verifies the blank-workflow path in the isolated stack; it does not claim a complete OntoCode generation/sandbox/promotion cycle or a deployment to the existing `3599` application, which was left untouched.

The same browser acceptance archived Purchasing and verified its broker function count changed from one to zero and its deep link was blocked. Restore returned one registered function and retained the same Run and saved output. A Sales sibling accepted matching Workflow/Agent slugs and names while its Runs view remained empty. These are observed lifecycle and sibling-history checks in the isolated stack.

Release acceptance additionally exercises two sibling Domains with matching workflow/agent/event names and subjects; foreign-owner and unauthorized-sibling detail reads, writes, files and streams; cookie, bearer and dev-auth paths; in-flight navigation and independent tabs; manifest/code execution; restart, cancellation and human-task resolution; and parent/domain archive and restore. Read back stored state and business results. Record local tests, browser evidence, remote checks and deployed state separately.
