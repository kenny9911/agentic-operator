#!/usr/bin/env node
// stdio MCP server launcher — invoked by @agentic/mcp's StdioClientTransport.
// We pass through to tsx so the .ts source runs without a build step in dev.
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const tsxBin = process.env.AGENTIC_TSX_BIN || "tsx";
const entry = join(here, "src", "index.ts");

const child = spawn(tsxBin, [entry], {
  stdio: ["inherit", "inherit", "inherit"],
  env: process.env,
});
child.on("exit", (code) => process.exit(code ?? 0));
