/**
 * @agentic/tools/metaerp — Meta ERP operation-catalog client used by
 * ontology-compiled agents (see docs/redesign-ontology-execution-2026-08-19.md §G1).
 *
 * One tool, three transports. `config/metaerp-routes.json` decides per
 * operation whether a call goes to the local mock, to APIGW with an IAM
 * application token, or to the portal gateway with a user session; anything
 * unlisted stays on the mock. See docs/metaerp-real-api-cutover.md.
 */
export {
  metaerpInvoke,
  loadMetaerpCatalog,
  _clearMetaerpCatalogCacheForTests,
  _clearMetaerpCallBudgetForTests,
  type MetaerpCatalogOperation,
  type MetaerpOperationKind,
} from "./invoke";
export {
  loadMetaerpRoutes,
  metaerpRealWritesEnabled,
  metaerpRoutesFilePath,
  metaerpTransportMode,
  resolveRoute,
  _clearMetaerpRoutesCacheForTests,
  type MetaerpRoute,
  type MetaerpTransport,
  type MetaerpTransportMode,
  type ResolvedRoute,
} from "./routes";
export {
  metaerpConfigFilePath,
  normalizeMetaerpPath,
  resolveMetaerpCredentials,
  resolveMetaerpEnv,
  resolveMetaerpPreset,
  _clearMetaerpConfigCacheForTests,
  type MetaerpCredentials,
  type MetaerpEnv,
  type MetaerpEnvPreset,
} from "./config";
export { normalizeMetaerpResponse } from "./envelope";
export {
  callMetaerpOpenapi,
  _clearMetaerpTokenCacheForTests,
} from "./openapi-transport";
export {
  callMetaerpUiapi,
  _clearMetaerpSessionCacheForTests,
} from "./uiapi-transport";
