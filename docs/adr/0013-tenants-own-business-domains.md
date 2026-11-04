---
status: accepted
---

# Tenants own Domains, consistently with OntoPlanet

On 2026-09-10, the product owner decided that Agentic Operator adopts OntoPlanet's **Tenant → Domains** hierarchy. A Tenant is the top-level ownership and isolation boundary; each Domain is a tenant-owned business problem and governed ontology boundary whose Workflows, Agents, Events, Runs, Deployments and OntoCode work retain that Domain's scope. This replaces the earlier product-language equivalence between Tenant and Business Domain so one customer's distinct business domains can share tenant administration without sharing operational state implicitly.

Workflows, Agents and OntoCode are shared product capabilities that operate on a selected Domain. An ontology source registration and a Runtime Profile select authoritative input and reviewed execution code; neither substitutes for Domain ownership or authorization.

The implementation adds explicit `domains` and `domain_memberships` records. Each Domain owns one exclusive execution namespace, represented by a stable legacy `tenants` row. Existing owners receive a Default Domain pointing to their existing namespace; additional Domains allocate distinct internal namespaces. This preserves every historical runtime id, storage path, token scope and signed artifact while reusing the existing isolation predicates and dispatch boundaries. The portal and API select the owning Tenant and Domain separately.

Parent membership is required for browser access. Tenant administrators manage child Domains, ordinary members need a child Domain grant, and legacy credentials remain restricted to their original namespace. Domain archive and owner archive both disable execution; they remain separate lifecycle states. A new child Domain or a new empty Tenant's Default Domain receives a built-in native Global tools Runtime Profile and can build without a custom tenant package. It starts with no workflows and a stopped Inngest deployment. Existing configured Domains retain their profile and registry identities.

This approach deliberately retains namespace-scoped credentials, integrations, Runtime Profiles, private Skill libraries and budgets. Creating a Domain does not copy or share its parent's configuration. Existing platform-wide configuration and explicit shared catalogs keep their current policies. Consolidating old owners under another Tenant, introducing shared parent budgets, or establishing an authoritative OntoPlanet service/Tenant/Domain mapping requires a separate explicit migration; none is inferred from a slug.

The [implementation and operator guide](../design/tenant-domain-hierarchy.md) records source behavior and verification. Applying migration 0084 is environment-specific and must use the governed migration path. The dependency boundary in [ADR-0004](0004-tenant-wiring-lives-in-the-api.md) and authentication boundary in [ADR-0008](0008-dev-auth-resolves-a-real-user.md) continue to apply. [ADR-0002](0002-manifest-agents-run-as-inngest-functions.md) retains its durable execution rules; its technical tenant namespace now resolves to an owned Domain.
