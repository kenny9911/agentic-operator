# Skills: create, maintain, publish and use

Skills give Agents reusable instructions and supporting resources. Open **Skills** in the portal sidebar for the current Tenant. The **Help & examples** link, and the help links in Workflow and Agent Skill controls, open the same guide inside the portal in English or Chinese.

Tenant administrators can create, edit, publish and compare Skills. Viewers and operators can browse available Skills and export them. Only platform superadmins maintain the shared library.

A Skill can explain how to perform a task, when its guidance applies, what information is needed and what a useful result contains. It does not supply credentials or grant business Tools. Publishing instructions that mention an action does not authorize that action.

## Create a Skill

1. Select **Describe a skill**. Describe the capability, when it should apply, expected inputs and outputs, and any limits. Add realistic examples, including a nearby task where the Skill should not apply.
2. Use the configured **Pro authoring model** or deliberately select an available **Model route**. The default creator and its bounded format-repair call use the same Pro route; a missing connection or unconfirmed Pro response produces an error. An explicit route choice remains authoritative. The platform Gateway still requires that route's gateway and credentials to be available to the Tenant.
3. Select **Create skill**. The Skill Creator produces a saved draft and opens it in the editor. Review its files, **Creator assumptions**, **Suggested checks** and model/usage details.
4. Edit the draft, select **Validate**, and correct blocking diagnostics. Select **Save changes**, then **Publish version** when the saved content is ready for new runs.

For example:

> Create an order-exception-review Skill. Use it when an operator provides purchase order details and asks for missing approvals or conflicting amounts. Return the known facts, missing information and next review steps. Do not invent approval thresholds, contact suppliers, or claim a check was performed without its result. A general order-status question should not trigger this Skill.

**Create blank** starts an editable `SKILL.md` without a model call. **Revise with AI** updates an existing saved draft from your instructions. Save local edits first. Revision proposals preserve unrelated files and binary resources they do not replace. Review changes before publishing; generated statements and assumed integrations are not verified facts.

Suggested checks record prompts, whether the Skill should apply, and expected criteria. They are marked **not run**. Saving, validating or publishing a Skill does not execute those checks. Creator notes identify the draft revision they describe and can become outdated after manual edits.

## Write instructions that load well

Every portable bundle has one root `SKILL.md`:

```markdown
---
name: order-exception-review
description: Review supplied purchase order details for missing approvals or conflicting amounts. Use when the user requests an exception review, not for general order-status questions.
---

# Order exception review

Use the supplied records as evidence. Identify missing information before drawing conclusions.
Return a brief summary, an evidence table, and questions for the operator.
Consult references/review-checklist.md when a detailed review is needed.
Never infer an approval threshold that the user or an authorized source has not provided.
```

Use a descriptive lowercase name with hyphens and a description that explains both the capability and when to use it. Keep the main instructions focused. Put detailed rules in `references/`, templates in `assets/`, and optional helpers in `scripts/`. Link to these resources with relative paths. Describe real dependencies and expected results without inventing tools, permissions or credentials.

An available Skill's name and description enter the runtime catalog first. Its full instructions load when selected or explicitly activated. Additional resources are read when needed. This progressive loading keeps unrelated material out of the model context; availability does not mean every Skill's full contents are always loaded.

## Edit and validate files

Use **Source** to edit text and **Preview** to inspect Markdown. Relative resource links open the corresponding file in the editor. Preview does not execute code, render raw HTML or fetch remote images.

Use **Add text file** or **Upload files** to add resources. Rename and remove files deliberately, then check any links pointing to them. Binary resources are kept as bytes; download one to inspect it or upload a replacement. The preview can be shorter than the stored file without truncating the saved resource.

A draft can be saved while its YAML or instructions are incomplete, so work is not lost. **Validate** checks the bundle structure, metadata and resource paths; validation does not demonstrate task quality. Publication and portable ZIP export require a valid bundle. **Export SKILL.md only** can recover the main document from an invalid draft.

If another editor saves first, the revision conflict preserves your local edits. Copy those edits or compare them before choosing **Reload saved draft**, which replaces the local editor content.

## Import, export and share

**Import skill** accepts a ZIP bundle, a `SKILL.md` file, or a skill folder. Review the files and diagnostics, then select **Add to library**. Imports create drafts; they do not publish or execute content. A folder-rooted ZIP must use a root folder name matching its declared Skill name.

**Export bundle** produces a portable ZIP containing all admitted files, including binary assets. **Export SKILL.md only** omits supporting files. Exported bundles do not carry the destination system's business Tool grants, credentials, evaluation records or Workflow/Agent assignments. Check dependencies when importing into another harness; metadata supported by one harness may not have equivalent behavior in another.

The **This tenant** library is private to the current Tenant. The **Shared library** contains platform-managed publications available across Tenants; only platform superadmins maintain shared Skills. Other Tenants see published shared content, not the platform library's unpublished drafts. Use **Copy to my library** on an available shared Skill to create a Tenant-owned draft you can maintain separately. Copying does not keep it synchronized with later shared publications.

## Publish, history and archive

**Save changes** creates a new draft revision. **Publish version** creates an immutable, numbered version from the saved draft. These are different operations: a saved draft is not available to production runtime catalogs until published.

**Version history** lets you inspect publications and earlier draft revisions. **Restore as draft** creates a new editable draft from prior content; it does not rewrite an existing publication. Publish that restored content as a new version if it should become the latest.

**Archive skill** removes it from new runtime catalogs while retaining history and existing run snapshots. An explicit assignment to an unavailable Skill needs attention; the runtime does not substitute a different Skill. **Restore to library** makes the latest published version eligible for new runs again.

## Compare model responses

Open **Compare skill responses**, enter a realistic task prompt and explicit expectations, and select **Run comparison**. An editable Skill defaults to the saved draft; you can also choose a published version. Read-only shared Skills use a publication. A suggested check can prefill the prompt and expectations, but starting a comparison is still a separate action. The comparison records two real Gateway calls: one using the task alone and one also receiving the complete `SKILL.md` instructions. Model routing and usage follow Tenant policy; inspect the actual Provider and model recorded for each response because routing or fallbacks can differ.

Read both outputs and select **Save human review** with **Meets expectations** or **Does not meet expectations** and a comment against your expectations. Use **Refresh history** to revisit records and **Cancel comparison** to stop a pending request. A **completed** comparison means responses were recorded, not that the Skill passed. Failed or cancelled comparisons retain available evidence and cannot be graded as completed. A comparison remains attached to its exact saved revision/version and content digest after later edits. Comparison prompts and outputs remain private to the evaluating Tenant, even for shared Skills.

This comparison does **not** test automatic discovery or activation, bundled resource reads, business Tools, scripts, external services or a full Workflow. It executes no tools. Two responses cannot establish reliability. Use representative cases, including a case where the Skill should not apply; use a separately authorized runtime/Test Lab run to evaluate integration. Selecting a suggested check only prefills the comparison; it does not turn discovery or activation criteria into verified results.

## Assign Skills to Workflows and Agents

Open **Workflow Skills** in the Workflow editor or **Skills** in Agent Studio. Save the resulting definition and use the editor's normal validation/publication flow. Workflow Test Lab uses the definition under test, including its Skill assignments; it does not bypass Skill visibility or business Tool policy. Workflow envelope and Agent assignments are retained in complete definition exports and imports.

| Mode | Effective scope |
| --- | --- |
| **Inherit available Skills** | A Workflow inherits published Tenant and shared Skills. Its Agents inherit the Workflow scope. A standalone Agent starts from its Tenant and shared library. This is the default when no assignment is authored. |
| **Use selected Skills** | Restricts the inherited catalog to selected Skill identities. An empty selection exposes no Skills. |
| **Disable Skills** | Exposes no Skills in this scope. A child Agent cannot re-enable them. |

Selected rows identify the Tenant or shared source and offer version controls. **Follow latest published version** resolves once at the start of a new root run. A version pin chooses an exact publication. An Agent inheriting a Workflow's selection keeps that Workflow's version unless an allowed matching pin is supplied; it cannot choose a version outside the parent's captured scope.

**Load when the run starts** explicitly activates the selected instructions. Otherwise the model chooses when applicable guidance should load. Explicit activation still does not grant any business action. Switching modes preserves stored selections so you can return to them; they affect execution only in selected mode.

Missing, archived, unpublished, outside-scope and unavailable pinned entries remain visible with recovery actions. Restore or publish the Skill, fix the pin or parent scope, or remove the assignment. A library loading failure does not clear your saved selections. Use **Load more** to search additional catalog pages.

## What a run keeps

Each managed run captures an authorized catalog with exact Skill identities, versions and content digests. A later publication does not retarget an in-progress run, replay or retry. Activated instructions are reconstructed for later model turns, including after chat history is shortened, without relying on the model to remember them.

Subagents and related Workflow execution inherit the captured scope and may narrow it. They cannot add Skills, switch pinned bytes, or acquire business Tool authority by requesting a different catalog. Runtime access evidence identifies the Skill/version/digest and resource path and byte count. In Workflow Test Lab, expand a step’s **Skills** section to inspect activation and read receipts, including failed attempts; a valid model answer alone does not prove a required reference was read. It is separate from the Skill text and from opaque Provider reasoning state.

## Scripts and harness deployment

Bundled scripts are resources until a separately authorized execution path runs them. Script execution requires an installed, approved isolated runner image, Tenant configuration and an independent business Tool grant. A manifest declaration or Skill instruction alone is insufficient. The runner uses bounded inputs/outputs, isolated storage, no network and no inherited credentials; it has no host-shell fallback. Ask the platform administrator to configure the supported runner, then test the actual authorized workflow. See the [runner deployment guide](../../deploy/skill-runner/README.md) for the current configuration and smoke-test requirements. On 2026-09-09, the local pinned image passed all seven real-container checks, covering Node/Python execution, isolation, networking, limits and cleanup; this does not enable a Tenant in production. The [runner probe](../research/2026-09-09-skill-runner-probe.md) records exact image identities and evidence.

To authorize this path, the administrator configures `AGENTIC_SKILL_SCRIPT_POLICY` on the API with an exact reviewed image identity, an independent `approvedImages` list, permitted `tenantSlugs` and supported `interpreters` (`node` and/or `python`). The default is disabled. `AGENTIC_SKILL_SCRIPT_DOCKER_SOCKET` selects the host's execution daemon. These settings belong to the administrator, not to Skill content or a Tool's configuration. Apply migration 0082 before enabling the policy.

Declare the business Tool separately on the Agent:

```json
"tool_use": [{ "name": "skills.run_script" }]
```

If the action has its own `allowed_tools` list, include `skills.run_script` there as well. Activate the admitted published Skill, then call the Tool with its exact catalog `id`, a bundled `scriptPath` under `scripts/`, an approved `interpreter`, and optional literal `args` and text `stdin`. Scripts receive no credentials and have no network, shell-command parameter, Tool bridge or dependency installer. Include only the task data they should process.

Generated CodeAct code needs a rebuilt candidate image containing the current Skills RPC bootstrap. It can use the same business permission through the convenience API:

```ts
const result = await ctx.skills.runScript({
  id: selectedSkillId,
  scriptPath: "scripts/build-report.py",
  interpreter: "python",
  args: ["--format", "summary"],
  stdin: JSON.stringify(suppliedRecords),
});
```

An attempt has 30 seconds of script time, 64 KiB combined stdout/stderr, and up to 32 artifacts totaling 1 MiB. Arguments are limited to 32 and 16 KiB total; stdin is limited to 256 KiB. The container has one CPU, 256 MiB memory, 64 processes and 64 MiB writable scratch. It reads the Skill at `/skill` and writes deliverables beneath `OUTPUT_DIR=/scratch/artifacts`. Runtime returns artifact IDs and digests and saves the binary files plus execution evidence with the run.

The root execution and its related children share a durable ceiling of four attempts, 120 seconds reserved script time, 1 MiB cumulative invocation JSON bytes and an 8 MiB reserved output ceiling. Reservations happen before execution, so failed or interrupted attempts still count after retries or process reconstruction. Each attempt reserves 30 seconds and 1,088 KiB output. Exhaustion requires a new approved root run; changing a child scope does not reset the budget. A reservation without completed execution evidence means the outcome is unknown. Changes to the configured host policy can prevent an older checkpoint from resuming.

Inspect `ok`, `failure`, process exit status and cleanup evidence before using a result. Output remains untrusted, and a successful process exit does not prove task quality. Workflow Test Lab's synthetic runs do not receive script execution capability; use a real authorized workflow to verify scripts. Its comparison feature executes no tools or scripts. Custom CodeAct reasoning adapters must accept prepared Skill messages or fail explicitly. See the [CodeAct evidence note](../research/2026-09-09-codeact-skills-probe.md).

Selectable production Codex execution remains disabled pending the platform’s separate Gateway and process-supervision integration; configuring a sandbox or Skill library does not enable it. The Skill adapter and frozen-run bridge are implemented and verified for that integration.

The native Codex adapter targets the repository's pinned runtime and verifies discovery against supplied bundles. A private Codex home alone does not prevent repository or system discovery; ambient Skills cause admission to fail. Deploy it with a reviewed process sandbox. Native invocation restrictions that the pinned protocol cannot enforce are rejected explicitly; host SkillSession activation handles explicit-only policies. No model-call discovery probe is evidence of a deployed production Workflow. See the [Codex probe and deployment caveats](../research/2026-09-09-codex-skills-probe.md).

## Troubleshooting

| Symptom | Check |
| --- | --- |
| A Skill is absent from the selector | Publish it, restore it if archived, verify the current Tenant and inherited scope, and load more catalog pages. |
| An Agent ignores useful guidance | Improve the description and relevant example; inspect the run's exact version and activation. Use explicit start activation when appropriate. |
| A Tool is unavailable despite Skill instructions | Grant the actual business Tool through the existing policy and configure its integration. Changing Skill text cannot grant access. |
| A resource cannot be read | Verify its relative path, bundle inclusion, access policy and read limits. Exporting Markdown alone excludes resources. |
| AI generation or comparison fails | Inspect the recorded error and Tenant model settings. No synthetic success or mock result replaces a failed real call. |
| A saved change did not affect a run | Publish the Skill, check pins, and start a new run. Existing snapshots keep the captured publication. |
| An import fails | Resolve path/name collisions, unsafe paths, invalid metadata or size diagnostics. Do not remove needed binary assets merely to hide an error. |

For implementation details and verification limits, see the [design](../design/skills-and-skill-builder.md), [current evidence ledger](../design/skills-implementation-status.md), [primary-source research](../research/2026-09-09-skills-and-agent-harnesses.md), [Agent Studio guide](agent-studio.md) and [Workflow authoring guide](workflow-authoring.md).

## Where skills are stored

Published shared skills are available from every tenant's Skills page. The tenant
in `/portal/<tenant>/skills` is the active workspace, not the owner of shared
skills. Use **Shared library** for the shared catalog and **This tenant** for
tenant-owned skills.

- Reviewed upstream downloads: `skills-library/` in the repository, shared and
  retained in Git with source pins and licenses.
- Managed shared skills: `data/shared/skills/<skill-id>/`.
- Managed tenant skills: `data/tenants/<tenant-slug>/skills/<skill-id>/`.

The last two paths follow the deployment's configured data and tenant roots.
Open `current.json` to find the current draft or a published version; its relative
bundle path contains `SKILL.md` and every bundled resource. Creation and edits
update these directories automatically. Names can change without moving the
stable skill ID. Archived skills keep their history.

Use the portal to edit skills; the database retains the authorized content and
run snapshots. The filesystem copies are not automatically imported back. A
superadmin can run `pnpm skills:reconcile` against the running API to rebuild
missing directory copies. Do not commit these runtime directories; the reviewed
shared source collection is already retained in the repository.
