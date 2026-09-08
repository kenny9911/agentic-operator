#!/usr/bin/env bash
# Restart only the local mock Meta ERP; run AFTER starting the main dev stack.
# Runs in the foreground. Restarting reloads fixture tables; the journal stays.
set -eo pipefail

readonly REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
readonly ERP_ROOT="$REPO_ROOT/apps/mock-erp"
cd "$REPO_ROOT"

usage() {
  cat <<'EOF'
Usage: ./restart_mockerp.sh [--check | --help]

Restart local mock Meta ERP in this terminal (Ctrl-C stops it).
Start the main stack first: pnpm dev can stop an already running mock ERP.
--check validates configuration and process ownership without restarting.

Defaults:
  POWER_SCM_DIST          ../agentic-operator-harness/fixtures/power-scm
  MOCK_ERP_PORT          3620

Override POWER_SCM_DIST, or MOCK_ERP_DATA_DIR + MOCK_ERP_TRANSFORM_MAPS,
to use another dataset. Relative paths resolve from this repository root.
MOCK_ERP_HOST and MOCK_ERP_STATE_DIR are also supported.
EOF
}

fail() { printf '[mock-erp] %s\n' "$*" >&2; exit 1; }
case "${1:-}" in
  --help|-h) usage; exit 0 ;;
  --check|"") ;;
  *) usage >&2; exit 64 ;;
esac
[ "$#" -le 1 ] || { usage >&2; exit 64; }

# Select the exact runtime before touching an existing service.
PINNED_NODE="$(tr -d '[:space:]' < .nvmrc)"
PINNED_NODE="${PINNED_NODE#v}"
[[ "$PINNED_NODE" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail "Invalid Node pin in .nvmrc."
if [ "$(node --version 2>/dev/null)" != "v$PINNED_NODE" ]; then
  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  # nvm is sourced without nounset, matching its shell requirements.
  [ ! -s "$NVM_DIR/nvm.sh" ] || . "$NVM_DIR/nvm.sh" --no-use
  command -v nvm >/dev/null 2>&1 && nvm use "$PINNED_NODE" >/dev/null \
    || fail "Run: nvm install $PINNED_NODE && nvm use $PINNED_NODE"
fi
set -u
node scripts/ensure-node-version.mjs

if command -v pnpm >/dev/null 2>&1; then
  PNPM_LAUNCH=(pnpm)
elif [ -x "${PNPM_HOME:-$HOME/Library/pnpm}/pnpm" ]; then
  PNPM_LAUNCH=("${PNPM_HOME:-$HOME/Library/pnpm}/pnpm")
elif [ -f "$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/pnpm/bin/pnpm.mjs" ]; then
  PNPM_LAUNCH=(node "$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/pnpm/bin/pnpm.mjs")
else
  fail "pnpm was not found. Install pnpm, then retry."
fi
command -v lsof >/dev/null 2>&1 || fail "lsof is required to identify the running ERP."

export POWER_SCM_DIST="${POWER_SCM_DIST:-$REPO_ROOT/../agentic-operator-harness/fixtures/power-scm}"
export MOCK_ERP_DATA_DIR="${MOCK_ERP_DATA_DIR:-$POWER_SCM_DIST/mock-erp}"
export MOCK_ERP_TRANSFORM_MAPS="${MOCK_ERP_TRANSFORM_MAPS:-$POWER_SCM_DIST/transform-maps/transform-maps.json}"
export MOCK_ERP_STATE_DIR="${MOCK_ERP_STATE_DIR:-$ERP_ROOT/data}"
export MOCK_ERP_PORT="${MOCK_ERP_PORT:-3620}"
# pnpm starts in apps/mock-erp; resolve relative paths before changing cwd.
for name in POWER_SCM_DIST MOCK_ERP_DATA_DIR MOCK_ERP_TRANSFORM_MAPS MOCK_ERP_STATE_DIR; do
  value="${!name}"
  [[ "$value" = /* ]] || export "$name=$REPO_ROOT/$value"
done

node --input-type=module <<'NODE'
import fs from "node:fs";
import path from "node:path";
const env = process.env;
try {
  if (!/^[1-9]\d{0,4}$/.test(env.MOCK_ERP_PORT) || Number(env.MOCK_ERP_PORT) > 65535) {
    throw new Error("MOCK_ERP_PORT must be an integer from 1 to 65535");
  }
  const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
  const index = readJson(path.join(env.MOCK_ERP_DATA_DIR, "_index.json"));
  if (!Array.isArray(index?.endpoints)) throw new Error("ERP index must contain endpoints");
  for (const entry of index.endpoints) {
    const file = path.join(env.MOCK_ERP_DATA_DIR, entry.file);
    const stub = readJson(file);
    if (!stub || typeof stub !== "object" || (!Array.isArray(stub) && !Array.isArray(stub.rows ?? []))) {
      throw new Error(`Invalid ERP rows in ${file}`);
    }
  }
  const maps = readJson(env.MOCK_ERP_TRANSFORM_MAPS);
  if (!Array.isArray(maps?.action_maps)) throw new Error("transform maps must contain action_maps");
  let parent = path.resolve(env.MOCK_ERP_STATE_DIR);
  while (!fs.existsSync(parent)) parent = path.dirname(parent);
  if (!fs.statSync(parent).isDirectory()) throw new Error(`ERP state path is not a directory: ${parent}`);
  fs.accessSync(parent, fs.constants.W_OK | fs.constants.X_OK);
  const journal = path.join(env.MOCK_ERP_STATE_DIR, "mock-erp-journal.ndjson");
  if (fs.existsSync(journal)) {
    if (!fs.statSync(journal).isFile()) throw new Error(`ERP journal is not a file: ${journal}`);
    fs.accessSync(journal, fs.constants.W_OK);
  }
  console.log(`[mock-erp] Data: ${env.MOCK_ERP_DATA_DIR} (${index.endpoints.length} query operations)`);
} catch (error) {
  console.error(`[mock-erp] ${error.message}\nCheck dataset paths, MOCK_ERP_PORT and MOCK_ERP_STATE_DIR before retrying.`);
  process.exit(1);
}
NODE
"${PNPM_LAUNCH[@]}" --filter @agentic/mock-erp exec node -e 'require.resolve("tsx/cli"); require.resolve("fastify")'

is_mock_server() {
  local pid="$1" cwd args
  cwd="$(lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' || true)"
  [ "$cwd" = "$ERP_ROOT" ] || return 1
  args="$(ps -p "$pid" -o command= 2>/dev/null || true)"
  [[ "$args" == *tsx*src/server.ts* ]]
}

listeners="$(lsof -nP -tiTCP:"$MOCK_ERP_PORT" -sTCP:LISTEN 2>/dev/null | sort -un || true)"
stop_pids=()
for pid in $listeners; do
  is_mock_server "$pid" || fail "Port $MOCK_ERP_PORT belongs to another process (PID $pid); leaving it running."
  # Include tsx watch ancestors so they cannot respawn a terminated listener.
  owner="$pid"
  while :; do
    parent="$(ps -p "$owner" -o ppid= 2>/dev/null | tr -d '[:space:]' || true)"
    [ -n "$parent" ] && is_mock_server "$parent" || break
    owner="$parent"
  done
  stop_pids+=("$owner")
  [ "$owner" = "$pid" ] || stop_pids+=("$pid")
done

if [ "${1:-}" = "--check" ]; then
  printf '[mock-erp] Check passed; port %s, existing listener: %s\n' "$MOCK_ERP_PORT" "${listeners:-none}"
  exit 0
fi

if [ "${#stop_pids[@]}" -gt 0 ]; then
  printf '[mock-erp] Stopping ERP process(es): %s\n' "${stop_pids[*]}"
  for pid in "${stop_pids[@]}"; do
    is_mock_server "$pid" && kill -TERM "$pid" 2>/dev/null || true
  done
  for ((attempt = 0; attempt < 50; attempt++)); do
    alive=0
    for pid in "${stop_pids[@]}"; do
      kill -0 "$pid" 2>/dev/null && alive=1
    done
    [ "$alive" -eq 0 ] && break
    sleep 0.1
  done
  [ "$alive" -eq 0 ] || fail "ERP did not stop within 5 seconds; inspect PID(s) ${stop_pids[*]}."
fi

printf '[mock-erp] Starting on port %s; health: http://localhost:%s/health\n' "$MOCK_ERP_PORT" "$MOCK_ERP_PORT"
printf '[mock-erp] Fixture tables reload on restart; existing journal is retained. Ctrl-C stops ERP.\n'
exec "${PNPM_LAUNCH[@]}" --filter @agentic/mock-erp run start
