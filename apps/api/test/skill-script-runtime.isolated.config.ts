import { defineConfig } from "vitest/config";
export default defineConfig({ test: { include: ["test/skill-script-runtime.unit.test.ts"], pool: "forks", sequence: { concurrent: false }, testTimeout: 60000 } });
