#!/usr/bin/env bash
# Foreground start (good for first test). Prefer systemd for always-on.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT/server"

export HOST="${HOST:-0.0.0.0}"
export PORT="${PORT:-8000}"
export PYTHON="${PYTHON:-python3}"

if [[ ! -d "$ROOT/client/dist" ]]; then
  echo "Client not built. Run: $ROOT/deploy/oracle/setup.sh"
  exit 1
fi

echo "Starting Trove on ${HOST}:${PORT} …"
exec node server.js
