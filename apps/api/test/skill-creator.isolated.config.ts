import { defineConfig } from "vitest/config";

// This service uses an injected gateway. No API bootstrap, fixtures, credentials, or database are needed.
export default defineConfig({ test: { include: ["test/skill-creator.unit.test.ts"], testTimeout: 10_000, pool: "forks" } });
