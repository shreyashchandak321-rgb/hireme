#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
# flock prevents overlap for this script; schedule index.sh separately too.
exec 9>refresh.lock
flock -n 9 || exit 0
docker compose --profile tools run --rm operator /app/ingest greenhouse
docker compose --profile tools run --rm operator /app/search-drain
