import { defineConfig } from "vitest/config";
export default defineConfig({ test: { include: ["test/skill-runtime.unit.test.ts"], pool: "forks", sequence: { concurrent: false }, testTimeout: 15000 } });
