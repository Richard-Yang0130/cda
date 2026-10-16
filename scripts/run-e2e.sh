#!/usr/bin/env bash
# 端到端测试包装：后端同时托管前端与 API，跑之前重置数据库。
#
# 为什么要重置：邀请码是一次性的、手机号不可重复 ——
# 测试直接跑第二遍必然失败，那不是代码问题而是测试没有隔离。
set -e
cd "$(dirname "$0")/.."
export PATH="/Users/harmony/Desktop/dsh2/.tools/bin:/Users/harmony/Desktop/dsh2/.tools/node/bin:$PATH"
PORT="${CDA_PORT:-8787}"

for pid in $(lsof -nP -iTCP:"$PORT" -sTCP:LISTEN -t 2>/dev/null || true); do kill -9 "$pid" 2>/dev/null || true; done
sleep 1

# 前端必须先构建，后端托管的就是它
(cd apps/client && ./node_modules/.bin/uni build > /tmp/cda-e2e-build.log 2>&1) || {
  echo "前端构建失败，见 /tmp/cda-e2e-build.log"; exit 1
}

rm -rf apps/server/data && mkdir -p apps/server/data
cd apps/server
CDA_PORT="$PORT" CDA_DB=./data/e2e.db CDA_WEB=../client/dist/build/h5 \
  CDA_INVITES="ZZTEST-C1,ZZTEST-C2,ZZTEST-C3,ZZTEST-C4,ZZTEST-C5" \
  node --experimental-strip-types src/index.ts > /tmp/cda-e2e.log 2>&1 &
SRV=$!
cd ../..

for i in $(seq 1 40); do
  curl -s --max-time 2 "http://127.0.0.1:$PORT/api/health" > /dev/null 2>&1 && break
  sleep 0.5
done

set +e
CDA_BASE="http://127.0.0.1:$PORT" node scripts/test-e2e-register.mjs
CODE=$?
set -e
kill "$SRV" 2>/dev/null || true
exit $CODE
