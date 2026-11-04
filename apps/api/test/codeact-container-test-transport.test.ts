import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { once } from "node:events";
import { describe, expect, it } from "vitest";
import { executeCodeActContainer } from "@agentic/runtime";
import {
  InProcessCodeActContainerTestTransport,
  TEST_CODEACT_CANDIDATE_IMAGE,
} from "./codeact-container-test-transport";

describe("CodeAct child-process test transport", () => {
  it("reports a closed child stdin as a failed execution and proves cleanup", async () => {
    class ClosedInputTransport extends InProcessCodeActContainerTestTransport {
      protected override spawnCandidate(): ChildProcessWithoutNullStreams {
        // Close the receiving pipe before accepting the executor command, but
        // remain alive so an ignored write error would hang until timeout.
        return spawn(process.execPath, ["-e", [
          'require("node:fs").closeSync(0);',
          'process.stdout.write("ready\\n");',
          'setInterval(() => {}, 1000);',
        ].join("\n")], { stdio: ["pipe", "pipe", "pipe"], env: {}, cwd: "/tmp" });
      }

      override async start(id: string): Promise<void> {
        const attachment = await this.attach(id);
        const ready = once(attachment.stdout, "data");
        await super.start(id);
        await ready;
      }
    }

    const previous = process.env.FACTORY_EXEC_GENERATED;
    process.env.FACTORY_EXEC_GENERATED = "1";
    try {
      const result = await executeCodeActContainer("export default {};", {}, {
        timeoutMs: 2_000,
        memoryMb: 128,
        image: TEST_CODEACT_CANDIDATE_IMAGE,
        identity: { agentName: "closed-input", tenantSlug: "closed-input-sb", correlationId: "closed-input" },
        transport: new ClosedInputTransport(),
        onRpc: async () => { throw new Error("closed input must not invoke RPC"); },
      });
      expect(result).toMatchObject({
        ok: false,
        executorStarted: true,
        failure: "rpc_failed",
        error: expect.stringMatching(/stdin failed:.*EPIPE/),
        evidence: { exitCode: 137, removed: true, absenceVerified: true },
      });
      expect(result.handlerStarted).not.toBe(true);
    } finally {
      if (previous === undefined) delete process.env.FACTORY_EXEC_GENERATED;
      else process.env.FACTORY_EXEC_GENERATED = previous;
    }
  });
});
