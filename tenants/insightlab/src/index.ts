/**
 * @tenants/insightlab — research-brief workflow.
 *
 * Three-agent chain (pure LLM, no external APIs):
 *
 *   ARTICLE_SUBMITTED
 *      ↓ topicTagAgent (tagArticle prompt + topic-taxonomy skill)
 *   ARTICLE_TAGGED
 *      ↓ claimExtractAgent (extractClaims prompt + claim-extraction skill)
 *   CLAIMS_EXTRACTED
 *      ↓ briefAgent (buildBrief prompt + brief-template skill + writeBriefToDisk)
 *   BRIEF_GENERATED
 *
 * Tools surface:
 *   - writeBriefToDisk (custom; persists HTML brief under data/briefs/<tenant>/)
 *
 * Skills (under ./skills): topic-taxonomy, claim-extraction, brief-template.
 *
 * Demonstrates a tool-use-light, LLM-driven pipeline — counterpart to the
 * RoboHire-API-heavy northwind tenant. Useful for proving the platform is
 * generic across use cases that don't need external service calls.
 */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { TenantRegistry } from "@agentic/agent-kit";
import { loadSkillsFromDirectory } from "@agentic/skills";

import { writeBriefToDisk } from "./tools/write-brief-to-disk";

import { tagArticle } from "./prompts/topic-tag";
import { extractClaims } from "./prompts/claim-extract";
import { buildBrief } from "./prompts/build-brief";

const here = dirname(fileURLToPath(import.meta.url));

const tools: TenantRegistry["tools"] = {
  writeBriefToDisk,
};

const prompts: TenantRegistry["prompts"] = {
  tagArticle,
  extractClaims,
  buildBrief,
};

// No MCP servers — this tenant is intentionally tool-light.
const mcpServers: TenantRegistry["mcpServers"] = [];

const skills = loadSkillsFromDirectory(join(here, "skills"));

const registry: TenantRegistry = { tools, prompts, mcpServers, skills };
export default registry;
