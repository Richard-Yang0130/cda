#!/usr/bin/env bash
#
# 一键把 CDA 项目推到 GitHub。
#
# 为什么需要它：建仓这一步被 token 权限卡住了。这个脚本把「建仓 + 推送」
# 收成一条命令，你可以在自己的终端里直接跑，不必依赖 AI 会话。
#
# 用法：
#   bash scripts/push-to-github.sh                    # 用默认仓库名 cda
#   REPO_NAME=myda bash scripts/push-to-github.sh     # 自定义仓库名
#   PUBLIC=1 bash scripts/push-to-github.sh           # 建成公开仓库
#
# 前置条件（二选一）：
#   A. fine-grained token 已具备：
#      Repository access = All repositories
#      Repository permissions → Administration = Read and write
#      Contents = Read and write
#   B. 或使用 classic token（勾选 repo）—— 建仓权限最直接
#
#   如果钥匙串里没有凭据，脚本会提示你粘贴一次 token（不会回显、不落盘）。

set -euo pipefail

REPO_NAME="${REPO_NAME:-cda}"
PUBLIC="${PUBLIC:-0}"
OWNER="${GITHUB_OWNER:-nationwildyounggay}"
BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo main)"

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
fail() { printf '\n\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

command -v git >/dev/null || fail "找不到 git"

say "目标仓库: ${OWNER}/${REPO_NAME}（$([ "$PUBLIC" = "1" ] && echo public || echo private)）"

# ── 1. 读取 token ──────────────────────────────────────────────
# 注意：必须走 `git credential-osxkeychain`（git 子命令）。
# 独立可执行文件 `git-credential-osxkeychain` 并不在 PATH 里，
# 用 `command -v` 去探测会**静默跳过钥匙串**，白白要求用户重新粘贴 token
# —— 这个坑实际踩到过：脚本报"未找到凭据"，但 security 一查明明在。
TOKEN="$(printf 'protocol=https\nhost=github.com\n\n' \
  | git credential-osxkeychain get 2>/dev/null \
  | sed -n 's/^password=//p' || true)"

if [ -z "$TOKEN" ]; then
  printf '未在钥匙串找到 GitHub 凭据。\n请粘贴一个具备建仓权限的 token（输入不会回显）: '
  if [ -r /dev/tty ]; then read -rs TOKEN </dev/tty; else read -rs TOKEN; fi
  printf '\n'
fi

[ -n "$TOKEN" ] || fail "没有 token，无法继续"

# ── 2. 需要的话创建仓库 ────────────────────────────────────────
if git ls-remote "git@github.com:${OWNER}/${REPO_NAME}.git" >/dev/null 2>&1; then
  say "仓库已存在，跳过创建"
else
  say "创建仓库…"
  BODY="{\"name\":\"${REPO_NAME}\",\"private\":$([ "$PUBLIC" = "1" ] && echo false || echo true),\"auto_init\":false}"
  CODE="$(curl -sS -o /tmp/push-repo.json -w '%{http_code}' -X POST \
    -H "Authorization: Bearer ${TOKEN}" \
    -H 'Accept: application/vnd.github+json' \
    https://api.github.com/user/repos -d "$BODY" || echo 000)"

  if [ "$CODE" != "201" ]; then
    MSG="$(sed -n 's/.*"message": *"\([^"]*\)".*/\1/p' /tmp/push-repo.json 2>/dev/null | head -1)"
    rm -f /tmp/push-repo.json
    cat <<EOF
✗ 建仓失败（HTTP $CODE${MSG:+：$MSG}）

最常见的原因是 token 权限不足，请检查：
  1. Repository access 必须是「All repositories」
     —— 新仓库还不存在，无法被预先勾选，选 Only select 一定失败
  2. Repository permissions → Administration 必须是「Read and write」
     —— POST /user/repos 需要的就是这个权限
  3. 或者直接改用 classic token（勾 repo），最省事
EOF
    exit 1
  fi
  rm -f /tmp/push-repo.json
  say "✓ 仓库已创建"
fi

# ── 3. 配置远端并推送 ──────────────────────────────────────────
say "配置远端…"
git remote remove origin 2>/dev/null || true
git remote add origin "git@github.com:${OWNER}/${REPO_NAME}.git"

say "推送 ${BRANCH}…"
git push -u origin "$BRANCH"

say "✓ 完成：https://github.com/${OWNER}/${REPO_NAME}"
