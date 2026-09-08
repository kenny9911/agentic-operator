#!/usr/bin/env bash
# Build from any working directory, using the repository's Node and pnpm pins.
set -eo pipefail

usage() {
  cat <<'EOF'
Usage: ./scripts/build.sh [--install] [turbo build options]

Select the Node version in .nvmrc and pnpm version in package.json, then run
the normal build (including its native-module guard).

  --install   Install dependencies with --frozen-lockfile before building.
              Also done automatically when node_modules is absent.
  --help, -h  Show this message.

Examples:
  ./scripts/build.sh
  ./scripts/build.sh --install
  ./scripts/build.sh --force
EOF
}

case "${1:-}" in
  --help|-h) usage; exit 0 ;;
esac

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
cd "$REPO_ROOT"

INSTALL_DEPS=0
if [ "${1:-}" = "--install" ]; then
  INSTALL_DEPS=1
  shift
fi

PINNED_NODE="$(tr -d '[:space:]' < .nvmrc)"
PINNED_NODE="${PINNED_NODE#v}"
if [[ ! "$PINNED_NODE" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "[build] .nvmrc must contain an exact Node version." >&2
  exit 1
fi

if [ "$(node --version 2>/dev/null || true)" != "v${PINNED_NODE}" ]; then
  echo "[build] selecting Node ${PINNED_NODE}…"
  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  # nvm is a shell function, so load it even in non-interactive shells.
  # shellcheck source=/dev/null
  if [ -s "$NVM_DIR/nvm.sh" ]; then
    . "$NVM_DIR/nvm.sh" --no-use
  fi
  if ! command -v nvm >/dev/null 2>&1 || ! nvm use "$PINNED_NODE" >/dev/null; then
    echo "[build] Node ${PINNED_NODE} is required. Run: nvm install ${PINNED_NODE} && nvm use ${PINNED_NODE}" >&2
    exit 1
  fi
fi
node scripts/ensure-node-version.mjs

# Corepack reads packageManager; a global pnpm exposed by nvm can be older.
if command -v corepack >/dev/null 2>&1; then
  PNPM_LAUNCH=("$(command -v corepack)" pnpm)
elif [ -n "${PNPM_HOME:-}" ] && [ -x "$PNPM_HOME/pnpm" ]; then
  PNPM_LAUNCH=("$PNPM_HOME/pnpm")
elif [ -x "$HOME/Library/pnpm/pnpm" ]; then
  PNPM_LAUNCH=("$HOME/Library/pnpm/pnpm")
elif command -v pnpm >/dev/null 2>&1; then
  PNPM_LAUNCH=("$(command -v pnpm)")
else
  echo "[build] pnpm was not found. Install Corepack or the pnpm version in package.json, then retry." >&2
  exit 127
fi

PINNED_PNPM="$(node -p 'require("./package.json").packageManager.replace(/^pnpm@/, "").split("+")[0]')"
ACTUAL_PNPM="$("${PNPM_LAUNCH[@]}" --version)"
if [ "$ACTUAL_PNPM" != "$PINNED_PNPM" ]; then
  echo "[build] pnpm ${PINNED_PNPM} is required; found ${ACTUAL_PNPM}. Install the pinned pnpm version or Corepack, then retry." >&2
  exit 1
fi

# Lifecycle scripts and the native rebuild invoke bare `pnpm`. Keep them on
# the same launcher without changing the user's global installation or shell.
BUILD_BIN="$(mktemp -d "${TMPDIR:-/tmp}/agentic-build.XXXXXX")"
trap 'rm -rf -- "$BUILD_BIN"' EXIT
{
  printf '#!/usr/bin/env bash\nexec '
  printf '%q ' "${PNPM_LAUNCH[@]}"
  printf '"$@"\n'
} > "$BUILD_BIN/pnpm"
chmod +x "$BUILD_BIN/pnpm"
export PATH="$BUILD_BIN:$PATH"

echo "[build] using Node $(node --version) and pnpm ${ACTUAL_PNPM}"
if [ "$INSTALL_DEPS" -eq 1 ] || [ ! -d node_modules ]; then
  pnpm install --frozen-lockfile
fi
pnpm run build "$@"
