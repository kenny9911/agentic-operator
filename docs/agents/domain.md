# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Before exploring, read these

- **`CONTEXT.md`** at the repo root: the glossary of the platform's ubiquitous language (Tenant, Event, Run, Step, Task, Tool, Deployment, Promotion, …) with the synonyms to avoid.
- **`docs/adr/`**: read ADRs that touch the area you're about to work in.

If any of these files don't exist, **proceed silently**. Don't flag their absence; don't suggest creating them upfront. The `/domain-modeling` skill (reached via `/grill-with-docs`) creates them lazily when terms or decisions actually get resolved.

## Layout: single-context

This repo is a pnpm monorepo, but it is documented as **one context**: a root `CONTEXT.md` plus `docs/adr/`.

```
/
├── CONTEXT.md            ← platform glossary (runtime, authoring planes, tools, gateway, Factory, OntoCode)
├── docs/adr/
│   ├── 0001-….md
│   └── …
└── apps/ packages/ tenants/ models/
```

The root glossary covers the **platform**. It deliberately does not define the business vocabulary of individual tenants (RAAS hiring, HC procurement, power purchase, …); those live in each tenant's `models/<slug>-v<n>/` ontology and `docs/` write-ups. If per-tenant or per-plane glossaries become necessary, switch to multi-context: add a root `CONTEXT-MAP.md` pointing at `tenants/<slug>/CONTEXT.md` or `packages/<plane>/CONTEXT.md`, following the `/domain-modeling` skill's `CONTEXT-FORMAT.md`.

Other reference material the skills may consult, none of it a glossary:

- `docs/architecture.md`: the architecture reference (ten diagrams, verified against the tree).
- `docs/design/*.md`: design docs per feature area; `docs/prd/*.md`: product requirements.
- `CLAUDE.md` / `AGENTS.md`: operating instructions and conventions.

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in `CONTEXT.md`. Don't drift to synonyms the glossary explicitly avoids.

If the concept you need isn't in the glossary yet, that's a signal: either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/domain-modeling`).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR-0003 (allow-list is the trust boundary), but worth reopening because…_
