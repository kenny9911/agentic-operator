/**
 * System agents roster — importing this module registers every system agent
 * with the singleton `agentRegistry` as a side effect (P3-RT-12).
 *
 * apps/api/src/bootstrap.ts imports this once at boot. To add a new system
 * agent, drop a `.ts` file in this directory and add a side-effect import
 * line below.
 */

import "./test-agent";
