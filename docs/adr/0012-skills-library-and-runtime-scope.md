---
status: proposed
---

# Managed Skills publish immutable versions, and runs inherit a bounded captured scope

The implementation uses Tenant-owned Skill libraries plus a superadmin-managed shared library, editable drafts, immutable publications and optional version pins; missing bindings inherit the available catalog. These are implementation assumptions made on 2026-09-09 to carry out the requested feature, not user-approved answers to earlier product-policy questions. Run capture fixes exact authorized versions and bytes, while child Agents may only narrow that scope; Skill guidance never widens business Tool, credential or script authority.

The separate managed lifecycle keeps portable task guidance distinct from Factory learning records. Changing sharing or default-selection policy remains possible, but must preserve existing version identities, historical run references and Tenant isolation. Draft comparison records remain private to the evaluating Tenant, including when their source Skill is shared; completion records observations and only a separate human grade records a pass or fail.

Related: [design and assumptions](../design/skills-and-skill-builder.md), [user guide](../user-guides/skills.md), [Tool trust boundary](0003-global-tool-registry-and-allow-list-trust-boundary.md), [pinned Codex isolation](0007-codex-app-server-pinned-and-isolated.md).
