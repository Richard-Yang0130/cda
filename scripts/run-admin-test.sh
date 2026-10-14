#!/usr/bin/env bash
set -e
cd "$(dirname "$0")/.."
export PATH="/Users/harmony/Desktop/dsh2/.tools/bin:/Users/harmony/Desktop/dsh2/.tools/node/bin:$PATH"
PORT="${CDA_PORT:-8787}"
for pid in $(lsof -nP -iTCP:"$PORT" -sTCP:LISTEN -t 2>/dev/null || true); do kill -9 "$pid" 2>/dev/null || true; done
sleep 1
rm -rf apps/server/data && mkdir -p apps/server/data
cd apps/server
CDA_PORT="$PORT" CDA_DB=./data/admin.db CDA_WEB=../client/dist/build/h5 \
  CDA_ADMIN_USER=admin CDA_ADMIN_PASS=AdminPass123456 \
  CDA_INVITES="CDA-BETA-01,CDA-BETA-02,CDA-BETA-03,CDA-BETA-04,CDA-BETA-05" \
  node --experimental-strip-types src/index.ts > /tmp/cda-admin-test.log 2>&1 &
SRV=$!
cd ../..
for i in $(seq 1 40); do curl -s --max-time 2 "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1 && break; sleep 0.5; done
set +e
CDA_API="http://127.0.0.1:$PORT" node scripts/test-admin.mjs
CODE=$?
set -e
kill "$SRV" 2>/dev/null || true
exit $CODE
