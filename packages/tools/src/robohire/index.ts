/**
 * @agentic/tools/robohire — first-party RoboHire.io REST wrappers.
 *
 * Every tool in this module is a thin wrapper around an
 * `api.robohire.io/api/v1/*` endpoint. Auth + base URL resolve via
 * `rhFetch` in `rest-helper.ts`, which honours per-tenant config
 * (`tool_use[].config.api_key_env` etc.) before falling back to
 * ROBOHIRE_API_KEY / ROBOHIRE_BASE_URL env vars.
 *
 * These tools are registered into `globalToolRegistry` (see
 * `../registry.ts`) so any tenant's manifest can call them by name with
 * no TypeScript code change — drop the tool name into `tool_use[]` and
 * optionally bind a per-tenant API key via `config`.
 */

export { matchResumeApi } from "./match-resume";
export { parseResumeApi } from "./parse-resume";
export { parseJdApi } from "./parse-jd";
export { inviteCandidateApi } from "./invite-candidate";
export { robohireHealthApi } from "./health";
export { rhFetch } from "./rest-helper";
export type {
  RoboHireResponse,
  RoboHireError,
  RoboHireToolConfig,
} from "./rest-helper";
