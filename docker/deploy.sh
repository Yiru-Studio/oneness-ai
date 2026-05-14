#!/usr/bin/env bash
# Pull latest code and redeploy the yirustudio.com stack.
#
# Usage (from anywhere):   bash ~/oneness-ai/docker/deploy.sh [api|worker|web|all]
# Default target: all (rebuilds api + worker + web).
# Infra services (postgres/redis/minio/caddy) keep running; only the app
# containers are rebuilt and restarted. Named volumes (pg_data, minio_data,
# caddy_data) are preserved — no data loss.

set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$(pwd)"
COMPOSE="docker compose --env-file $ROOT/.env.production -f $ROOT/docker/docker-compose.prod.yml"

TARGET="${1:-all}"
case "$TARGET" in
  api|worker|web) SERVICES="$TARGET" ;;
  all)            SERVICES="api worker web" ;;
  *) echo "unknown target: $TARGET (use api|worker|web|all)"; exit 1 ;;
esac

echo "==> git pull"
git pull --ff-only

echo "==> docker build: $SERVICES"
$COMPOSE build $SERVICES

echo "==> rolling restart: $SERVICES"
$COMPOSE up -d --no-deps $SERVICES

echo "==> waiting for api health"
for _ in $(seq 1 30); do
  if curl -fsS https://api.yirustudio.com/api/_health >/dev/null 2>&1; then
    echo "API healthy"
    break
  fi
  sleep 2
done

echo "==> done. Container status:"
$COMPOSE ps
