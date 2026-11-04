import type { GeneratedAgentSpec } from "./spec-types";

/** A compile/load-tested wrapper example, not an ontology or business default. */
export const CODEGEN_AGENT_MODULE_EXAMPLE = `import { defineAgent } from "@agentic/runtime";

export const agent = defineAgent({
  id: "EXAMPLE_ACTION_SLUG",
  name: "EXAMPLE_ACTION_NAME",
  actor: ["Agent"],
  trigger: ["EXAMPLE_REQUESTED"],
  emit: ["EXAMPLE_COMPLETED"],
  tools: [],
  async handler(input: Record<string, unknown>, ctx) {
    const output = { message: input.message };
    await ctx.emit("EXAMPLE_COMPLETED", output);
    return output;
  },
});`;

export const CODEGEN_AGENT_MODULE_CONTRACT = [
  "CodeAct module contract: import { defineAgent } from \"@agentic/runtime\" and export the OBJECT returned by defineAgent({ metadata, async handler(input, ctx) { ... } }). A default export of that descriptor object is also supported.",
  "The entrypoint is the descriptor's callable .handler, not a standalone exported function. Do not export default handler or alias a function as export const defineAgent = handler. defineAgent is the imported factory that you CALL with an object; it is not the name of an export you need to invent.",
  "Use async handler(input: Record<string, unknown>, ctx), with ctx contextually typed by defineAgent. Input is the business payload directly, not { event: { data } }. The supported wrapper import is @agentic/runtime's defineAgent; do not import an AgentRuntimeCtx type or other undeclared modules. Await ctx.emit(eventName, businessPayload) for source-declared outcomes, then return the source-declared result. Do not call the handler at module load time.",
  "Read the selected AgentSpec with read_spec and copy its returned moduleMetadata exactly (id, name, actor, trigger, emit, tools). These values come from the selected spec, including its HITL actor and reviewed capability lists. The EXAMPLE_* symbols and message echo below demonstrate module shape ONLY. Replace every example symbol and the handler body with the current spec and authoritative action I/O/error contract; never add an example event, field or tool to the artifact.",
  "```ts",
  CODEGEN_AGENT_MODULE_EXAMPLE,
  "```",
].join("\n\n");

export function codegenAgentExpectedMetadata(spec: GeneratedAgentSpec) {
  return {
    id: spec.slug,
    name: spec.short || spec.nameZh,
    actor: spec.hitl ? ["Human"] : ["Agent"],
    trigger: spec.trigger,
    emit: spec.emit,
    tools: spec.tools,
  };
}
