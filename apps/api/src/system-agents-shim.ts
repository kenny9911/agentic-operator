/**
 * P3-RT-12 — load the system-agent roster from `data/system-agents/`.
 *
 * The directory is a tiny pnpm workspace (`@agentic/system-agents`) so node
 * module resolution finds workspace packages cleanly. Importing this shim
 * triggers each agent's self-registration as a side effect.
 */

import "@agentic/system-agents";
