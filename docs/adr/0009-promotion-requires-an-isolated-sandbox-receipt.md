# Promotion requires a signed receipt from a genuinely isolated sandbox runner

A same-host container runner is permanently development-only: promotion refuses it and requires an execution-plane attestation from the external Docker sandbox, plus a human HMAC review receipt that only an interactive human can sign, a no-mock provider proof, whole-version promotion (never cherry-picked agents) and live production integration probes. A sandbox that could vouch for itself would vouch for nothing; the evidence gate is only meaningful when the thing producing the evidence cannot be the thing being promoted. Consequence: local development can run the whole Factory loop, but nothing it produces reaches a production tenant without the external sandbox.

_Backfilled 2026-09-07 from `docs/architecture.md` §7 and `apps/api/src/services/agent-factory/promote.ts`._
