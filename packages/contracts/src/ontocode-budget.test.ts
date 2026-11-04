import { describe, expect, it } from "vitest";
import { ONTOCODE_COMMAND_POLICY, resolveOntoCodeCommandBudget } from "./ontocode";

describe("OntoCode generation budget", () => {
  it("funds a single Action through review and save, with bounded refinement headroom", () => {
    // The observed first ten successful outer turns ended at code admission.
    // Review and save are still required; neither may disappear to fit a cap.
    const requiredOuterSteps = [
      "select_strategy", "read_ontology", "understand_ontology",
      "read_action_contract", "capability_resolve", "create_plan", "critique_plan",
      "design_agent", "read_spec", "codegen_agent", "review_agent", "save_draft",
    ];
    const refinementSteps = ["read_spec", "refine_agent", "codegen_agent", "review_agent"];
    const budget = resolveOntoCodeCommandBudget("generate_package", {}, { authoritativeActionCount: 1 });
    expect(budget.maxModelCalls).toBeGreaterThanOrEqual(requiredOuterSteps.length + refinementSteps.length);
    expect(budget.maxToolCalls).toBeGreaterThanOrEqual(requiredOuterSteps.length + refinementSteps.length);
    expect(budget.maxModelCalls).toBeLessThanOrEqual(20);
    expect(budget.maxToolCalls).toBeLessThanOrEqual(32);
    expect(budget.maxWallClockMs).toBe(600_000);
    // maxModelCalls maps to outer turns today. This policy test does not claim
    // that nested understanding/critique model calls share an aggregate fuse.
  });

  it("sizes from the authoritative scope and deduplicates client Action ids", () => {
    const one = resolveOntoCodeCommandBudget("generate_package", {}, { authoritativeActionCount: 1 });
    expect(resolveOntoCodeCommandBudget("generate_package", { actionIds: [" a ", "a", "", 4] })).toEqual(one);
    expect(resolveOntoCodeCommandBudget("generate_package", { scopeMode: "full_domain", actionIds: ["a", "b"] }, { authoritativeActionCount: 1 })).toEqual(one);
    const two = resolveOntoCodeCommandBudget("generate_package", {}, { authoritativeActionCount: 2 });
    expect(two).toEqual({ maxWallClockMs: one.maxWallClockMs + 60_000, maxModelCalls: one.maxModelCalls + 4, maxToolCalls: one.maxToolCalls + 10 });
  });

  it("keeps large and unspecified full-domain builds within unchanged hard ceilings", () => {
    const ceiling = { maxWallClockMs: 900_000, maxModelCalls: 40, maxToolCalls: 96 };
    expect(ONTOCODE_COMMAND_POLICY.generate_package.budgetCeiling).toEqual(ceiling);
    expect(resolveOntoCodeCommandBudget("generate_package", {}, { authoritativeActionCount: 500 })).toEqual(ceiling);
    expect(resolveOntoCodeCommandBudget("generate_package", { scopeMode: "full_domain" })).toEqual(ceiling);
  });

  it("sizes an existing Build continuation from server scope without widening other commands", () => {
    const scoped = resolveOntoCodeCommandBudget("generate_package", {}, { authoritativeActionCount: 6 });
    expect(resolveOntoCodeCommandBudget("patch_artifact", {}, { authoritativeActionCount: 6 })).toEqual(scoped);
    expect(resolveOntoCodeCommandBudget("patch_artifact", { actionIds: ["a", "b"], scopeMode: "full_domain" })).toEqual(ONTOCODE_COMMAND_POLICY.patch_artifact.budget);
    expect(resolveOntoCodeCommandBudget("run_tests", {}, { authoritativeActionCount: 6 })).toEqual(ONTOCODE_COMMAND_POLICY.run_tests.budget);
  });
});
