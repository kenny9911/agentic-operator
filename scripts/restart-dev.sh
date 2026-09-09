#!/usr/bin/env bash
#
# restart-dev.sh — cleanly restart the full agentic dev stack.
#
# Why this exists: tsx-watch (api) and Next (web) usually hot-reload, but a
# half-applied reload can leave the api serving STALE code — e.g. a newly
# added route 404s even though it's on disk (this bit us after merging the
# dashboard + funnel work). A hard restart guarantees every process picks up
# the current tree. Also selects the exact Node pin in .nvmrc and re-runs the
# native-module guard via `pnpm dev`'s predev hook.
#
# Standard ports (must match scripts/dev-stack.mjs + next.config.mjs):
#   web :3599 · api :3540 · inngest :8488  (+ 8489 / 50152 / 50153 helpers)
#
# Usage:  pnpm restart            # or: pnpm dev:restart · ./scripts/restart-dev.sh
#
set -uo pipefail
cd "$(dirname "$0")/.."
ROOT="$(pwd -P)"

WEB_PORT=3599
API_PORT=3540
# inngest dev + its connect helpers — MUST match scripts/dev-stack.mjs (-p 8488
# --connect-gateway-port 8489 --connect-gateway-grpc-port 50152 --connect-executor-grpc-port 50153).
PORTS="${WEB_PORT},${API_PORT},8488,8489,50152,50153"

# pnpm enforces package.json's exact Node engine, even for another Node 26
# release with a compatible native ABI. Validate before stopping any process.
PINNED_NODE="$(tr -d '[:space:]' < .nvmrc)" || exit 1
PINNED_NODE="${PINNED_NODE#v}"
if [[ ! "$PINNED_NODE" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "[restart] .nvmrc must contain an exact Node version." >&2
  exit 1
fi

echo "[restart] selecting Node ${PINNED_NODE}…"
if [ "$(node --version 2>/dev/null)" != "v${PINNED_NODE}" ]; then
  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  # shellcheck source=/dev/null
  [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" --no-use
  if ! command -v nvm >/dev/null 2>&1 || ! nvm use "$PINNED_NODE" >/dev/null; then
    echo "[restart] Node ${PINNED_NODE} is required. Run: nvm install ${PINNED_NODE} && nvm use ${PINNED_NODE}" >&2
    exit 1
  fi
fi
if [ "$(node --version 2>/dev/null)" != "v${PINNED_NODE}" ]; then
  echo "[restart] Node ${PINNED_NODE} is still not active; check PATH before restarting." >&2
  exit 1
fi

# Codex's bundled Node runtime includes pnpm as a module, but does not always
# expose a `pnpm` executable on PATH. Resolve a stable launcher before killing
# the currently healthy stack so a restart cannot leave the workspace down.
if command -v pnpm >/dev/null 2>&1; then
  PNPM_LAUNCH=(pnpm)
elif [ -n "${PNPM_HOME:-}" ] && [ -x "${PNPM_HOME}/pnpm" ]; then
  PNPM_LAUNCH=("${PNPM_HOME}/pnpm")
elif [ -x "${HOME}/Library/pnpm/pnpm" ]; then
  PNPM_LAUNCH=("${HOME}/Library/pnpm/pnpm")
elif [ -f "${HOME}/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/pnpm/bin/pnpm.mjs" ]; then
  PNPM_LAUNCH=(node "${HOME}/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/pnpm/bin/pnpm.mjs")
else
  echo "[restart] pnpm was not found. Install pnpm or set PNPM_HOME, then retry." >&2
  exit 127
fi

# Exercise the selected launcher as well as the repository's pin validation;
# a pnpm engine rejection must leave the existing stack running.
"${PNPM_LAUNCH[@]}" run ensure:node || exit $?

echo "[restart] stopping the previous workspace stack…"
bash scripts/stop-dev.sh || exit $?

echo "[restart] starting dev stack (web :${WEB_PORT} · api :${API_PORT} · inngest :8488)…"
# `pnpm dev`'s predev re-runs ensure:native + frees the same ports, so this is
# idempotent. exec so Ctrl-C goes straight to the stack.
exec env AGENTIC_SKIP_PREDEV_STOP=1 "${PNPM_LAUNCH[@]}" dev
