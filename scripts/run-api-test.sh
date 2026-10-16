#!/usr/bin/env bash
# 后端 API 测试的可重复运行包装。
#
# 为什么要它：API 测试会写库（邀请码被用掉、手机号被注册），
# 直接重复跑必然因为数据残留而失败 —— 这不是被测代码的问题，
# 而是测试没有隔离。这里每次都用全新的库。
set -e
cd "$(dirname "$0")/.."
export PATH="/Users/harmony/Desktop/dsh2/.tools/bin:/Users/harmony/Desktop/dsh2/.tools/node/bin:$PATH"

PORT="${CDA_PORT:-8787}"

# 按端口杀旧进程（pgrep 按命令行匹配不到，启动用的是相对路径）
for pid in $(lsof -nP -iTCP:"$PORT" -sTCP:LISTEN -t 2>/dev/null || true); do
  kill -9 "$pid" 2>/dev/null || true
done
sleep 1

rm -f apps/server/data/test.db*
cd apps/server
CDA_PORT="$PORT" CDA_DB=./data/test.db \
  CDA_INVITES="ZZTEST-B1,ZZTEST-B2,ZZTEST-B3,ZZTEST-B4" \
  node --experimental-strip-types src/index.ts > /tmp/cda-api-test.log 2>&1 &
SRV=$!
cd ../..

# 等健康检查
for i in $(seq 1 30); do
  if curl -s --max-time 2 "http://127.0.0.1:$PORT/api/health" > /dev/null 2>&1; then break; fi
  sleep 0.5
done

set +e
CDA_API="http://127.0.0.1:$PORT" node scripts/test-api.mjs
CODE=$?
set -e

kill "$SRV" 2>/dev/null || true
exit $CODE
