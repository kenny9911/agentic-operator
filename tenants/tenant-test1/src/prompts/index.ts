/**
 * tenant-test1 prompts.
 *
 * `callAgentTest1` corresponds to the manifest action
 * `{ type: "logic", name: "callAgentTest1" }` on agent-test1. The prompt body
 * lives in `prompt-test1.md` so it can be edited as plain markdown without
 * touching TypeScript — we just load it at module import time.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { definePrompt } from "@agentic/agent-kit";
import type { PromptDescriptor } from "@agentic/agent-kit";

const here = dirname(fileURLToPath(import.meta.url));
const PROMPT_BODY = readFileSync(join(here, "prompt-test1.md"), "utf8").trim();

const callAgentTest1: PromptDescriptor = definePrompt({
  name: "callAgentTest1",
  description:
    "Ask the LLM the canonical question saved in prompt-test1.md and return its prose answer.",
  system:
    "You are Agentic Operator, the platform itself. Answer briefly and concretely.",
  template: () => PROMPT_BODY,
});

export const tenantTest1Prompts: Record<string, PromptDescriptor> = {
  callAgentTest1,
};
