/** Policy and proposal handling shared by the eventual Builder API and tests.
 * No model calls, publication or user data writes occur in this module. */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  SkillBundleSchema,
  SkillCreatorOutputSchema,
  type SkillBundle,
  type SkillCreatorOutput,
} from "@agentic/contracts";
import {
  assertValidSkillBundle,
  decodeSkillFile,
  SkillPathIndex,
  type ValidSkillBundle,
} from "./bundle";
import { readSkillBundleFromDirectory } from "./loader";

export interface SkillCreatorProposal {
  readonly bundle: SkillBundle;
  readonly validation: ValidSkillBundle;
  readonly assumptions: SkillCreatorOutput["assumptions"];
  readonly suggestedTests: SkillCreatorOutput["suggestedTests"];
  readonly changeSummary: SkillCreatorOutput["changeSummary"];
}

/** Generated files are replacements/additions. Omitted resources are preserved
 * byte-for-byte, including binary assets the model is forbidden to generate.
 * A caller still needs its draft revision/CAS check before storing the result. */
export function applySkillCreatorProposal(
  output: unknown,
  base?: SkillBundle,
): SkillCreatorProposal {
  const proposal = SkillCreatorOutputSchema.parse(output);
  const prior = base ? SkillBundleSchema.parse(base) : { files: [] };
  const originalPaths = new SkillPathIndex();
  for (const file of prior.files) {
    originalPaths.add(file.path);
    decodeSkillFile(file);
  }
  const changedPaths = new SkillPathIndex();
  for (const file of proposal.files) changedPaths.add(file.path);
  const files = new Map(prior.files.map((file) => [file.path, { ...file }]));
  for (const file of proposal.files) files.set(file.path, { ...file });
  const bundle = {
    files: [...files.values()].sort((a, b) =>
      a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
    ),
  };
  const validation = assertValidSkillBundle(bundle);
  return {
    bundle,
    validation,
    assumptions: [...proposal.assumptions],
    suggestedTests: structuredClone(proposal.suggestedTests),
    changeSummary: [...proposal.changeSummary],
  };
}

/** Load the actual checked-in portable policy and its required output contract.
 * The digest identifies precisely which Creator guidance produced a proposal. */
export function loadSkillCreatorPolicy(): {
  bundle: SkillBundle;
  contentDigest: string;
  instructions: string;
} {
  const root = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../builtin/skill-creator",
  );
  const bundle = readSkillBundleFromDirectory(root);
  const validated = assertValidSkillBundle(bundle);
  const contract = bundle.files.find(
    (file) => file.path === "references/output-contract.md",
  );
  if (!contract || contract.encoding !== "utf8")
    throw new Error("Skill Creator output contract is unavailable");
  return {
    bundle,
    contentDigest: validated.digest,
    instructions: `${validated.body}\n\n<output-contract>\n${contract.content}\n</output-contract>`,
  };
}
