import {
  ModelRouteIdSchema,
  type SkillBundle,
  type SkillDetail,
  type SkillDiagnostic,
} from "@agentic/contracts";
import { skillApi } from "@/lib/hooks/useSkills";

export type SkillCreateMode = "describe" | "blank" | "import" | "revision";
interface SkillCreateRequest {
  readonly tenant: string;
  readonly mode: SkillCreateMode;
  readonly purpose: string;
  readonly examples: string;
  readonly name: string;
  readonly modelRoute: string;
  readonly visibility: "tenant" | "shared";
  readonly bundle?: SkillBundle;
  readonly existing?: { id: string; revision: number };
}

/** All phases keep the tenant captured when the dialog action began. Import and
 * blank creation are atomic commits: no cancellation signal is sent to those
 * endpoints. If the dialog closes, their result cannot trigger UI navigation. */
export async function submitSkillCreateRequest(
  input: SkillCreateRequest,
  signal: AbortSignal,
  onValidation: (value: {
    bundle: SkillBundle;
    diagnostics: SkillDiagnostic[];
  }) => void,
  api: Pick<
    typeof skillApi,
    "validate" | "import" | "create" | "generate" | "revise"
  > = skillApi,
): Promise<SkillDetail | null> {
  const {
    tenant,
    mode,
    purpose,
    examples,
    name,
    modelRoute,
    visibility,
    bundle,
    existing,
  } = input;
  if (signal.aborted) return null;
  let detail: SkillDetail;
  if (mode === "import") {
    if (!bundle) return null;
    const result = await api.validate(bundle, signal, tenant);
    if (signal.aborted) return null;
    onValidation({ bundle, diagnostics: result.diagnostics });
    if (!result.valid || signal.aborted) return null;
    detail = await api.import(bundle, visibility, tenant);
  } else if (mode === "blank") {
    detail = await api.create(
      {
        files: [
          {
            path: "SKILL.md",
            encoding: "utf8",
            content: `---\nname: ${name}\ndescription: ${JSON.stringify(purpose.trim())}\n---\n\n# ${name}\n\n${purpose.trim()}\n\n## Procedure\n\nDescribe the steps, required inputs and expected output.\n\n## Checks\n\nDescribe how to verify the result and when to ask for missing information.\n`,
          },
        ],
      },
      visibility,
      tenant,
    );
  } else {
    const request = {
      purpose,
      ...(examples.trim()
        ? {
            examples: examples
              .split(/\r?\n/)
              .map((line) => line.trim())
              .filter(Boolean),
          }
        : {}),
      ...(modelRoute
        ? { modelRoute: ModelRouteIdSchema.parse(modelRoute) }
        : {}),
    };
    const response = existing
      ? await api.revise(
          existing.id,
          { ...request, expectedRevision: existing.revision },
          signal,
          tenant,
        )
      : await api.generate({ ...request, visibility }, signal, tenant);
    detail = response.detail;
  }
  return signal.aborted ? null : detail;
}
