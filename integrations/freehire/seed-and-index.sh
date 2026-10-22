#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
# Re-running skips already-present boards through the supported curator command.
for board in stripe rubrik coinbase alphasense databricks mongodb cloudflare; do
  docker compose --profile tools run --rm operator /app/add-board --provider greenhouse --board "$board" --company "$board" --apply
 done
docker compose --profile tools run --rm operator /app/ingest greenhouse
docker compose --profile tools run --rm operator /app/reindex
echo 'Initial crawl and index finished. Test /api/v1/jobs/search?countries=IN&limit=20'
