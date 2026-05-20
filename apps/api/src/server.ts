import Fastify from "fastify";
import cors from "@fastify/cors";
import { registerEnvelope } from "./plugins/error";
import { registerAuth } from "./plugins/auth";
import { healthRoute } from "./routes/health";
import { eventsRoutes } from "./routes/v1/events";
import { runsRoutes } from "./routes/v1/runs";
import { runsLogsRoute } from "./routes/v1/runs-logs";
import { tasksRoutes } from "./routes/v1/tasks";
import { agentsRoutes } from "./routes/v1/agents";
import { agentInvokeRoutes } from "./routes/v1/agent-invoke";
import { deploymentsRoutes } from "./routes/v1/deployments";
import { webhooksRoutes } from "./routes/v1/webhooks";
import { artifactsRoutes } from "./routes/v1/artifacts";
import { readsRoutes } from "./routes/v1/reads";
import { llmRoutes } from "./routes/v1/llm";
import { manifestImportRoutes } from "./routes/v1/manifest-import";
import { inngestRoute } from "./routes/inngest";
import { bootstrapRuntime } from "./bootstrap";

const PORT = Number(process.env.PORT ?? 3501);
const HOST = process.env.HOST ?? "0.0.0.0";
const WEB_ORIGIN = process.env.WEB_ORIGIN ?? "http://localhost:3500";

export async function build() {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? "info",
      transport:
        process.env.NODE_ENV !== "production" && process.env.NODE_ENV !== "test"
          ? { target: "pino-pretty", options: { translateTime: "HH:MM:ss.l", colorize: true } }
          : undefined,
    },
  });

  await app.register(cors, {
    origin: WEB_ORIGIN,
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  });

  await registerEnvelope(app);
  await registerAuth(app);

  // Health — unauthenticated
  await app.register(healthRoute);

  // Inngest webhook — needs bootstrap result
  const { inngest, functions } = await bootstrapRuntime();
  await inngestRoute(app, { client: inngest, functions });

  // /v1 REST surface
  await app.register(
    async (v1) => {
      await v1.register(eventsRoutes);
      await v1.register(runsRoutes);
      await v1.register(runsLogsRoute);
      await v1.register(tasksRoutes);
      await v1.register(agentsRoutes);
      await v1.register(agentInvokeRoutes);
      await v1.register(deploymentsRoutes);
      await v1.register(webhooksRoutes);
      await v1.register(artifactsRoutes);
      await v1.register(readsRoutes);
      await v1.register(llmRoutes);
      await v1.register(manifestImportRoutes);
    },
    { prefix: "/v1" },
  );

  return app;
}

// Auto-start only when this file is the main entrypoint, not when imported by tests.
const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const app = await build();
  try {
    await app.listen({ port: PORT, host: HOST });
    app.log.info(`api listening on http://${HOST}:${PORT}`);
  } catch (err) {
    app.log.error({ err }, "failed to start");
    process.exit(1);
  }
}
