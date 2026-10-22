#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
exec 9>index.lock
flock -n 9 || exit 0
docker compose --profile tools run --rm operator /app/search-drain
