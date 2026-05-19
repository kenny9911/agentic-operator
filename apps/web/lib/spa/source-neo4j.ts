/**
 * Source: Neo4j.
 *
 * Not yet implemented. The route returns 501 with a clear error so the UI can
 * surface the message and fall back to JSON.
 */

import type { SpaBootstrap } from "./types";

export class Neo4jNotConfigured extends Error {
  code = "neo4j_not_configured";
  constructor() {
    super(
      "Neo4j data source is not yet wired up. Set NEO4J_URI, NEO4J_USER, NEO4J_PASSWORD and implement queries in lib/spa/source-neo4j.ts.",
    );
  }
}

export async function loadFromNeo4j(): Promise<SpaBootstrap> {
  // Stub. Real implementation will:
  //   - connect via `neo4j-driver`
  //   - MATCH (w:Workflow {version: 'v1'})-[:HAS_NODE]->(n:WorkflowNode) RETURN n
  //   - MATCH (e:Event) RETURN e
  //   - map to SpaAgent / SpaEvent shapes (same as source-json)
  //   - reuse derive.ts helpers for stage/category/synthesis
  throw new Neo4jNotConfigured();
}
