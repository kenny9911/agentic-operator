import { describe, expect, it } from "vitest";
import { validateAgentCode } from "./codegen";
import { validateGeneratedToolAllowlist } from "./code-lint";
import { systemPrompt } from "./system-prompt";

const code = (body: string) => `import { defineAgent } from "@agentic/runtime";
export default defineAgent({ async handler(input, ctx) { ${body} } });`;

describe("Factory CodeAct Skills authoring surface", () => {
  it("typechecks all four SDK operations, binary byte metadata, and narrowed spawn options", async () => {
    const source = code(`
      const page = await ctx.skills.list({limit: 2});
      const selected = {id: page.skills[0].id};
      const loaded = await ctx.skills.load(selected);
      const paths = await ctx.skills.listResources(selected, {limit: 2});
      const resource = await ctx.skills.readResource(selected, paths.resources[0].path);
      const child = await ctx.spawn("inspect", input, {skillIds:[loaded.id]});
      return {version: loaded.versionId, digest: loaded.contentDigest, bytes: resource.bytes, encoding: resource.encoding, child};
    `);
    expect(await validateAgentCode(source)).toMatchObject({ ok: true, errors: [] });
    expect(validateGeneratedToolAllowlist(source, [])).toMatchObject({ ok: true, calledTools: [] });
  });

  it.each([
    'return await ctx.skills.execute({id:"x"});',
    'const load = ctx.skills.load; return await load({id:"x"});',
    'const skills = ctx.skills; return await skills.load({id:"x"});',
    'return await ctx.skills["load"]({id:"x"});',
    'return await ctx["skills"].load({id:"x"});',
  ])("rejects nonexistent or indirect Skill capabilities: %s", (body) => {
    expect(validateGeneratedToolAllowlist(code(body), []).ok).toBe(false);
  });

  it("preserves business-tool allowlists after Skill activation", () => {
    expect(validateGeneratedToolAllowlist(code('await ctx.skills.load({id:"x"}); return await ctx.tool("records.write", input);'), []).ok).toBe(false);
  });

  it("does not typecheck model-selected activation origin or script execution", async () => {
    expect((await validateAgentCode(code('return await ctx.skills.load({id:"x", origin:"explicit"});'))).ok).toBe(false);
    expect((await validateAgentCode(code('return await ctx.skills.execute({id:"x"});'))).ok).toBe(false);
  });

  it.each(["en", "zh"] as const)("documents the actual bounded SDK for %s generation", (language) => {
    const prompt = systemPrompt("example", [], language);
    expect(prompt).toContain("ctx.skills.readResource");
    expect(prompt).toContain("production spawn remains disabled");
  });
});
