import type { FastifyInstance } from "fastify";
import {
  ParseRunInputBodySchema,
  RUN_INPUT_MAX_FILE_BYTES,
} from "@agentic/contracts";
import { isLLMError } from "@agentic/llm-gateway";
import { requirePermission } from "../../plugins/rbac";
import { getLLMGateway } from "../../services/llm";
import {
  parseRunInputFile,
  RunInputParseError,
} from "../../services/run-input-parser";

export async function runInputRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    "/run-inputs/parse",
    {
      bodyLimit: 4 * Math.ceil(RUN_INPUT_MAX_FILE_BYTES / 3) + 16_384,
    },
    async (req, reply) => {
      const auth = requirePermission(req, "agents.invoke");
      const body = ParseRunInputBodySchema.parse(req.body);
      try {
        return reply.ok(
          await parseRunInputFile(body, auth.tenantId, getLLMGateway()),
        );
      } catch (error) {
        if (error instanceof RunInputParseError)
          return reply.fail(error.code, error.message, error.statusCode);
        if (isLLMError(error)) {
          req.log.warn(
            { code: error.code },
            "run-input parsing provider failed",
          );
          return reply.fail(
            "file_parse_failed",
            "The configured model could not parse this file. Select a model that supports this file type and retry.",
            502,
          );
        }
        throw error;
      }
    },
  );
}
