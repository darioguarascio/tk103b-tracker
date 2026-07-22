#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL is required" >&2
  exit 1
fi

npm run build -w web
node scripts/init-db.js

npm run start -w server &
pid=$!
cleanup() {
  kill "$pid" 2>/dev/null || true
}
trap cleanup EXIT

for _ in $(seq 1 60); do
  if curl -fsS http://127.0.0.1:3001/api/health >/dev/null; then
    break
  fi
  sleep 1
done

npm run test:e2e
