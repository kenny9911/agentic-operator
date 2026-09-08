import { defineConfig } from "vitest/config";
export default defineConfig({ test: { include: ["test/wipe-runtime-skills.unit.test.ts"], pool: "forks", sequence: { concurrent: false } } });
