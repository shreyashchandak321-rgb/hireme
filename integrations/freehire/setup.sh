#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
for program in docker git openssl; do command -v "$program" >/dev/null || { echo "Install $program first." >&2; exit 1; }; done
docker compose version >/dev/null
revision=606e90c353c5efedc8865a217a88fd66917d8124
if [ ! -d source/.git ]; then
  mkdir -p source
  git -C source init
  git -C source remote add origin https://github.com/strelov1/freehire.git
  git -C source fetch --depth 1 origin "$revision"
  git -C source checkout --detach FETCH_HEAD
fi
[ "$(git -C source rev-parse HEAD)" = "$revision" ] || { echo "Source revision differs. Inspect source before changing it." >&2; exit 1; }
if [ ! -f .env ]; then
  umask 077
  {
    echo "POSTGRES_PASSWORD=$(openssl rand -hex 32)"
    echo "MEILI_MASTER_KEY=$(openssl rand -hex 32)"
    echo "JWT_SECRET=$(openssl rand -hex 32)"
    echo 'FREEHIRE_HTTP_PORT=8086'
  } > .env
fi
chmod 600 .env
docker compose build migrate
docker compose up -d api
echo 'API starting on http://127.0.0.1:8086. Run seed-and-index.sh next.'
