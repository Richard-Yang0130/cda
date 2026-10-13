#!/usr/bin/env bash
#
# 搭 · CDA 部署脚本
#
#   bash scripts/deploy.sh --prepare                      只打包前端
#   bash scripts/deploy.sh --first <服务器IP> <域名>       首次部署（装环境+上传+配服务）
#   bash scripts/deploy.sh --update <服务器IP>             日常更新（重新构建+上传+重启）
#
# 设计取舍：
#   - 用 rsync 而不是 git pull —— 服务器上不需要配 Git 凭据与仓库权限，
#     也不必把 .assets 那 272MB 的资源包传上去
#   - systemd 托管 —— 开机自启、崩溃自动重启，比 nohup 可靠
#   - 数据库放在 /opt/cda/data 且**不随部署覆盖** —— 那是全部用户数据
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export PATH="/Users/harmony/Desktop/dsh2/.tools/bin:/Users/harmony/Desktop/dsh2/.tools/node/bin:$PATH"

# 腾讯云/阿里云的 Ubuntu 镜像默认用户是 ubuntu，不是 root。
# 网页终端登录的也是 ubuntu，所以公钥在 /home/ubuntu 下 —— 用 root 连必然被拒。
SSH_USER="${CDA_SSH_USER:-ubuntu}"
# 统一的 SSH 选项：首次连接不询问主机密钥（否则 BatchMode 下会直接失败）
SSH_OPTS=(-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=15)
REMOTE_DIR="/opt/cda"
SERVICE="cda"
PORT="8787"
INVITES="${CDA_INVITES:-CDA-BETA-01,CDA-BETA-02,CDA-BETA-03,CDA-BETA-04,CDA-BETA-05,CDA-BETA-06,CDA-BETA-07,CDA-BETA-08,CDA-BETA-09,CDA-BETA-10,CDA-BETA-11,CDA-BETA-12}"

say() { printf "\033[1;36m▶ %s\033[0m\n" "$*"; }
ok()  { printf "\033[1;32m✓ %s\033[0m\n" "$*"; }
die() { printf "\033[1;31m✗ %s\033[0m\n" "$*" >&2; exit 1; }

prepare() {
  say "构建前端"
  (cd "$ROOT/apps/client" && ./node_modules/.bin/uni build) || die "前端构建失败"
  ok "前端已构建到 apps/client/dist/build/h5"
}

need_ssh() {
  local ip="$1"
  ssh "${SSH_OPTS[@]}" -o BatchMode=yes "$SSH_USER@$ip" true 2>/dev/null \
    || die "无法免密登录 $SSH_USER@$ip —— 先执行：ssh-copy-id $SSH_USER@$ip"
}

do_first() {
  local ip="$1" domain="$2"
  [ -n "$ip" ] && [ -n "$domain" ] || die "用法：deploy.sh --first <服务器IP> <域名>"
  need_ssh "$ip"
  prepare

  say "在服务器上安装 Node 22 与 Nginx（首次会慢几分钟）"
  ssh "${SSH_OPTS[@]}" "$SSH_USER@$ip" bash -s <<'REMOTE'
set -e
export DEBIAN_FRONTEND=noninteractive
sudo apt-get update -qq
sudo apt-get install -y -qq curl ca-certificates rsync nginx
# ⚠️ 必须 Node 22+ —— 后端是 TypeScript，靠 --experimental-strip-types 直接运行，
# 该选项 Node 20 不支持（实测报 "bad option"），会表现为服务反复重启。
if ! command -v node >/dev/null || [ "$(node -v | cut -c2-3)" -lt 22 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y -qq nodejs
fi
sudo mkdir -p /opt/cda/data /opt/cda/app
sudo chown -R "$(id -un)":"$(id -gn)" /opt/cda
node -v
nginx -v
REMOTE
  ok "服务器环境就绪"

  say "上传后端与前端产物"
  # 后端源码：只传需要的文件
  rsync -az --delete -e "ssh ${SSH_OPTS[*]}" \
    "$ROOT/apps/server/src/" "$SSH_USER@$ip:$REMOTE_DIR/app/src/"
  rsync -az -e "ssh ${SSH_OPTS[*]}" \
    "$ROOT/apps/server/package.json" "$SSH_USER@$ip:$REMOTE_DIR/app/package.json"
  # 前端产物
  rsync -az --delete -e "ssh ${SSH_OPTS[*]}" \
    "$ROOT/apps/client/dist/build/h5/" "$SSH_USER@$ip:$REMOTE_DIR/web/"
  ok "文件已上传"

  say "写入 systemd 服务与 Nginx 配置"
  ssh "${SSH_OPTS[@]}" "$SSH_USER@$ip" bash -s <<REMOTE
set -e
sudo tee /etc/systemd/system/$SERVICE.service > /dev/null <<'UNIT'
[Unit]
Description=CDA backend
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/cda/app
Environment=CDA_PORT=$PORT
Environment=CDA_DB=/opt/cda/data/cda.db
Environment=CDA_WEB=/opt/cda/web
Environment=CDA_INVITES=$INVITES
ExecStart=/usr/bin/node --experimental-strip-types src/index.ts
Restart=always
RestartSec=3
StandardOutput=append:/opt/cda/cda.log
StandardError=append:/opt/cda/cda.log

[Install]
WantedBy=multi-user.target
UNIT

sudo tee /etc/nginx/sites-available/cda > /dev/null <<'CONF'
server {
    listen 80;
    server_name $domain www.$domain;
    client_max_body_size 8m;

    # ── gzip ──
    # 3D 网格是 .obj（文本格式），877KB 压到 286KB（实测 3.07 倍）。
    # 跨境线路慢，不压缩的话首屏要等 30 秒以上。
    gzip on;
    gzip_comp_level 5;
    gzip_min_length 1024;
    gzip_proxied any;
    gzip_vary on;
    gzip_types
        text/plain text/css text/xml
        application/javascript application/json application/xml
        application/octet-stream
        image/svg+xml;
    # .obj 走的是 application/octet-stream，必须显式包含在上面

    location / {
        proxy_pass http://127.0.0.1:$PORT;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 60s;
    }
}
CONF
sudo ln -sf /etc/nginx/sites-available/cda /etc/nginx/sites-enabled/cda
sudo rm -f /etc/nginx/sites-enabled/default

sudo systemctl daemon-reload
sudo systemctl enable $SERVICE
sudo systemctl restart $SERVICE
sudo nginx -t && sudo systemctl reload nginx
sleep 2
systemctl is-active $SERVICE
REMOTE
  ok "服务已启动"

  say "安装备份与日志轮转"
  rsync -az -e "ssh ${SSH_OPTS[*]}" "$ROOT/deploy/" "$SSH_USER@$ip:$REMOTE_DIR/deploy/"
  ssh "${SSH_OPTS[@]}" "$SSH_USER@$ip" bash -s <<'BACKUP'
set -e
sudo cp /opt/cda/deploy/backup.mjs /opt/cda/backup.mjs
sudo chmod +x /opt/cda/backup.mjs
sudo cp /opt/cda/deploy/cda-backup.service /etc/systemd/system/
sudo cp /opt/cda/deploy/cda-backup.timer /etc/systemd/system/
sudo cp /opt/cda/deploy/logrotate-cda /etc/logrotate.d/cda
sudo systemctl daemon-reload
sudo systemctl enable --now cda-backup.timer
sudo systemctl start cda-backup.service || true
systemctl list-timers cda-backup.timer --no-pager | head -2
BACKUP
  ok "备份定时器已安装"

  say "自检"
  ssh "${SSH_OPTS[@]}" "$SSH_USER@$ip" "curl -s --max-time 5 http://127.0.0.1:$PORT/api/health" || die "后端健康检查失败，看 /opt/cda/cda.log"
  echo
  ok "部署完成"
  echo
  echo "  访问：http://$domain"
  echo "  下一步（配 HTTPS，必须）："
  echo "    ssh $SSH_USER@$ip"
  echo "    apt install -y certbot python3-certbot-nginx"
  echo "    certbot --nginx -d $domain -d www.$domain"
  echo
  echo "  查看日志：ssh $SSH_USER@$ip 'tail -f /opt/cda/cda.log'"
}

do_update() {
  local ip="$1"
  [ -n "$ip" ] || die "用法：deploy.sh --update <服务器IP>"
  need_ssh "$ip"
  prepare
  say "上传更新"
  rsync -az --delete -e "ssh ${SSH_OPTS[*]}" \
    "$ROOT/apps/server/src/" "$SSH_USER@$ip:$REMOTE_DIR/app/src/"
  rsync -az --delete -e "ssh ${SSH_OPTS[*]}" \
    "$ROOT/apps/client/dist/build/h5/" "$SSH_USER@$ip:$REMOTE_DIR/web/"
  ssh "${SSH_OPTS[@]}" "$SSH_USER@$ip" "sudo systemctl restart $SERVICE && sleep 2 && systemctl is-active $SERVICE"
  ok "已更新并重启（数据库未动）"
}

case "${1:-}" in
  --prepare) prepare ;;
  --first)   do_first "${2:-}" "${3:-}" ;;
  --update)  do_update "${2:-}" ;;
  *) sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//' ;;
esac
