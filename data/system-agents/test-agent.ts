/**
 * TestAgent — the first concrete code-defined agent.
 *
 * Single LLM call with the prompt "Introduce what is Agentic Operator." The
 * response is persisted through the standard run/step + file log pipeline.
 *
 * P3-RT-12 — lives under `data/system-agents/` so operators can edit the
 * roster without rebuilding the runtime package. The directory is a tiny
 * pnpm workspace (`@agentic/system-agents`) so node module resolution finds
 * `@agentic/agent-runtime` cleanly.
 */

import {
  BaseAgent,
  agentRegistry,
} from "@agentic/agent-runtime";
import type { ChatMessage } from "@agentic/llm-gateway";

export class TestAgent extends BaseAgent<void, string> {
  readonly name = "testAgent";
  readonly description =
    "Sanity-check agent. Asks the configured LLM to introduce the Agentic Operator.";

  protected buildMessages(): ChatMessage[] {
    return [
      {
        role: "system",
        content: "You are a concise technical writer. Reply in one paragraph.",
      },
      {
        role: "user",
        content: "Introduce what is Agentic Operator.",
      },
    ];
  }
}

agentRegistry.register(new TestAgent());
