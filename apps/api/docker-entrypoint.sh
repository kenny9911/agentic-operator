#!/bin/sh
# apps/api/docker-entrypoint.sh — runs DB migrations against the mounted
# volume on every container start, then exec's the api server. Idempotent;
# `drizzle-kit` migrations record applied versions in
# `__drizzle_migrations` so a re-run after a deploy just confirms there's
# nothing to do.
#
# Tenant seeding (`pnpm db:seed`) is intentionally NOT run here. First-
# time deploys should `docker compose exec api node_modules/.bin/tsx
# /app/packages/db/src/seed.ts` once to mint the `__system` + initial
# tenant rows; this entrypoint stays migration-only so subsequent boots
# don't re-seed (which would fail on the slug unique index anyway).

set -e

echo "[entrypoint] applying database migrations..."
cd /app/packages/db
# pnpm's isolated module layout puts the tsx bin under each workspace
# that depends on it; @agentic/db has no devDep on tsx, so reuse the
# api workspace's. The path is stable across the install graph.
/app/apps/api/node_modules/.bin/tsx src/migrate.ts

cd /app/apps/api
echo "[entrypoint] starting server: $*"
exec "$@"
