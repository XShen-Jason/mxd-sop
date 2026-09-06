# mxd-player 独立部署（复用主项目工作区）

本文针对已确认的服务器：Debian 12、Nginx 1.22.1、域名
`mxd-teams.5202345.xyz`。

你的 Git 工作区已经是 `/opt/mxd-sop`，主项目更新命令会拉取整个仓库，
因此 `mxd-player` 不再单独 clone，也不使用 sparse-checkout 或第二套 SSH
认证。所有 player 源码直接使用：

```text
/opt/mxd-sop/mxd-player
```

这套部署只新增 `mxd-player` systemd 服务、player 数据库目录和一个独立的
Nginx 站点，不修改已有 `mxd-sop`、`akxsguild.vip` 或默认站点。

## 0. 先更新主项目代码

本文要求 `/opt/mxd-sop` 已经更新到包含 `mxd-player` 的提交。先执行主项目原有的
更新命令，再开始下面的检查；否则第 1 节的 `git ls-files` 会在旧提交上失败。
`--ff-only` 不会创建合并提交；如果本地修改与远端更新冲突，命令会停止，不会覆盖
本地文件。不要使用 `reset --hard` 丢弃现有修改。

```bash
(
set -eu
sudo -u mxd-sop git -C /opt/mxd-sop fetch origin main
sudo -u mxd-sop git -C /opt/mxd-sop pull --ff-only origin main
sudo -u mxd-sop git -C /opt/mxd-sop log -1 --oneline
)
```

如果 `pull` 因本地修改停止，先保存或提交这些修改，再重新执行本节；确认输出的提交
不早于包含 `mxd-player` 的版本后，再继续第 1 节。

## 1. 检查主项目工作区

整段复制执行。任一检查失败都会停止，不会修改现有服务。

```bash
(
set -eu
sudo -v
sudo test -d /opt/mxd-sop/.git
sudo -u mxd-sop git -C /opt/mxd-sop rev-parse --show-toplevel
sudo -u mxd-sop git -C /opt/mxd-sop remote get-url origin
sudo -u mxd-sop git -C /opt/mxd-sop status --short
sudo -u mxd-sop git -C /opt/mxd-sop ls-files --error-unmatch mxd-player/backend-player/go.mod
sudo -u mxd-sop git -C /opt/mxd-sop ls-files --error-unmatch mxd-player/frontend-player/package.json
sudo test -x "$(command -v node)"
node_major=$(node -p 'process.versions.node.split(".")[0]')
test "$node_major" -ge 20
node --version
)
```

## 2. 创建 player 目录

整段复制执行。复用主项目已有的 `mxd-sop` 用户，不创建新的 Linux 用户，
避免 Git 权限和 SSH 认证问题。如果系统没有 Go 1.23+，只在 player 专用目录
安装 Go，不替换主项目或其他服务使用的系统版本。

```bash
(
set -eu
sudo install -d -o mxd-sop -g mxd-sop /opt/mxd-player/bin
sudo install -d -o mxd-sop -g mxd-sop /var/lib/mxd-player
sudo install -d -o mxd-sop -g mxd-sop /var/backups/mxd-player
sudo install -d -o root -g root -m 755 /etc/mxd-player
sudo install -d -o root -g root -m 755 /opt/mxd-player/toolchain
sudo test -f /opt/mxd-sop/mxd-player/backend-player/go.mod
sudo test -f /opt/mxd-sop/mxd-player/frontend-player/package.json

go_ok=0
if command -v go >/dev/null 2>&1; then
  go_version=$(go version | awk '{print $3}' | sed 's/^go//')
  go_major=${go_version%%.*}
  go_rest=${go_version#*.}
  go_minor=${go_rest%%.*}
  if [ "$go_major" -gt 1 ] || { [ "$go_major" -eq 1 ] && [ "$go_minor" -ge 23 ]; }; then
    go_ok=1
  fi
fi
if [ "$go_ok" -eq 1 ]; then
  GO_BIN=$(command -v go)
else
  GO_VERSION=1.23.12
  case "$(dpkg --print-architecture)" in amd64) GO_ARCH=amd64;; arm64) GO_ARCH=arm64;; *) echo '不支持的 CPU 架构' >&2; exit 1;; esac
  GO_ROOT=/opt/mxd-player/toolchain/go-$GO_VERSION
  if [ ! -x "$GO_ROOT/bin/go" ]; then
    sudo install -d -m 755 "$GO_ROOT"
    curl -fsSL "https://go.dev/dl/go$GO_VERSION.linux-$GO_ARCH.tar.gz" |
      sudo tar -xzf - --strip-components=1 -C "$GO_ROOT"
  fi
  GO_BIN="$GO_ROOT/bin/go"
fi
printf 'GO_BIN=%s\n' "$GO_BIN" | sudo tee /opt/mxd-player/toolchain.env >/dev/null
sudo chmod 644 /opt/mxd-player/toolchain.env
"$GO_BIN" version
)
```

## 3. 首次构建 player

整段复制执行。前端和后端都从 `/opt/mxd-sop/mxd-player` 构建；构建失败时
命令会停止，不会启动不完整的服务。

```bash
(
set -eu
sudo -u mxd-sop bash -lc '
  set -eu
  cd /opt/mxd-sop/mxd-player/frontend-player
  if [ -f package-lock.json ]; then npm ci; else npm install --no-package-lock; fi
  npm run lint
  npm run build
'

sudo -u mxd-sop bash -lc '
  set -eu
  . /opt/mxd-player/toolchain.env
  cd /opt/mxd-sop/mxd-player/backend-player
  "$GO_BIN" mod download
  "$GO_BIN" test ./...
  "$GO_BIN" vet ./...
  "$GO_BIN" build -trimpath -ldflags="-s -w" -o /opt/mxd-player/bin/mxd-player.new ./cmd/mxd-player
'
sudo -u mxd-sop mv /opt/mxd-player/bin/mxd-player.new /opt/mxd-player/bin/mxd-player
sudo chmod 755 /opt/mxd-player/bin/mxd-player
sudo test -f /opt/mxd-sop/mxd-player/frontend-player/dist/index.html
sudo test -x /opt/mxd-player/bin/mxd-player
)
```

## 4. 创建 player systemd 服务

整段复制执行。数据库位于主项目仓库之外，服务只写入自己的数据目录。
先生成一个长随机 `PLAYER_SERVICE_TOKEN`，并把它同时写入 player 的环境文件
和客服工单系统的 `MXD_PLAYER_SERVICE_TOKEN`；不要保留下面的占位值。
推荐使用下面的命令生成令牌：

```bash
openssl rand -hex 32
```

该命令输出 64 个十六进制字符（32 字节随机值），只包含 `0-9` 和 `a-f`，
不包含空格或标点。两个环境文件必须使用完全相同的值。

```bash
(
set -eu
if sudo test -e /etc/mxd-player/mxd-player.env \
  || sudo test -e /etc/systemd/system/mxd-player.service; then
  echo 'player 配置已存在，已停止以避免覆盖' >&2
  exit 1
fi

sudo tee /etc/mxd-player/mxd-player.env >/dev/null <<'ENV'
HOST=127.0.0.1
PORT=26906
PLAYER_DATABASE_PATH=/var/lib/mxd-player/player.sqlite
# Optional one-time bootstrap source. HTTP uploads are written directly to
# SQLite and do not create or refresh CSV files.
# PLAYER_CHAR_DATA_DIR=/opt/mxd-sop/mxd-player/backend-player/data/char-user-qq
PLAYER_CORS_ORIGIN=https://mxd-teams.5202345.xyz
PLAYER_SERVICE_TOKEN=replace-with-the-same-long-random-token-used-by-ops-desk
ENV
sudo chown root:root /etc/mxd-player/mxd-player.env
sudo chmod 600 /etc/mxd-player/mxd-player.env

sudo tee /etc/systemd/system/mxd-player.service >/dev/null <<'SERVICE'
[Unit]
Description=MXD Player backend
After=network.target

[Service]
Type=simple
User=mxd-sop
Group=mxd-sop
WorkingDirectory=/opt/mxd-sop/mxd-player/backend-player
EnvironmentFile=/etc/mxd-player/mxd-player.env
ExecStart=/opt/mxd-player/bin/mxd-player
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/mxd-player
LimitNOFILE=4096
UMask=027

[Install]
WantedBy=multi-user.target
SERVICE

sudo systemctl daemon-reload
sudo systemctl enable --now mxd-player
sudo systemctl is-active --quiet mxd-player
sudo curl -fsS http://127.0.0.1:26906/health
)
```

## 5. 创建临时 HTTP Nginx 站点并申请证书

本段只新增 `mxd-teams.5202345.xyz.conf`。已有同名文件或 Nginx 配置时会
停止，不会覆盖。`nginx -t` 失败时不会 reload。

```bash
(
set -eu
sudo test -f /opt/mxd-sop/mxd-player/frontend-player/dist/index.html
sudo systemctl is-active --quiet mxd-player
sudo nginx -t

if sudo nginx -T 2>/dev/null | grep -Eq 'server_name[[:space:]]+mxd-teams\.5202345\.xyz([[:space:];]|$)'; then
  echo 'mxd-teams 域名已经存在于 Nginx 配置，已停止以避免冲突' >&2
  exit 1
fi
if sudo test -e /etc/nginx/sites-available/mxd-teams.5202345.xyz.conf \
  || sudo test -L /etc/nginx/sites-available/mxd-teams.5202345.xyz.conf \
  || sudo test -e /etc/nginx/sites-enabled/mxd-teams.5202345.xyz.conf \
  || sudo test -L /etc/nginx/sites-enabled/mxd-teams.5202345.xyz.conf; then
  echo 'mxd-teams Nginx 配置文件已经存在，已停止以避免覆盖' >&2
  exit 1
fi

sudo tee /etc/nginx/sites-available/mxd-teams.5202345.xyz.conf >/dev/null <<'NGINX'
# Managed by mxd-player deployment
server {
    listen 80;
    listen [::]:80;
    server_name mxd-teams.5202345.xyz;
    root /opt/mxd-sop/mxd-player/frontend-player/dist;

    location /.well-known/acme-challenge/ { try_files $uri =404; }
    location / { try_files $uri $uri/ /index.html; }
}
NGINX
sudo ln -s /etc/nginx/sites-available/mxd-teams.5202345.xyz.conf \
  /etc/nginx/sites-enabled/mxd-teams.5202345.xyz.conf
sudo nginx -t && sudo systemctl reload nginx

sudo certbot certonly --webroot --non-interactive --agree-tos \
  --register-unsafely-without-email --keep-until-expiring \
  -w /opt/mxd-sop/mxd-player/frontend-player/dist \
  -d mxd-teams.5202345.xyz
)
```

## 6. 切换到最终 HTTPS 配置

整段复制执行。只覆盖第 5 步创建且带有管理标记的 player 配置；检查失败
会自动恢复临时配置，已有站点不会 reload。

```bash
(
set -eu
sudo grep -q '^# Managed by mxd-player deployment$' \
  /etc/nginx/sites-available/mxd-teams.5202345.xyz.conf
sudo test -f /etc/letsencrypt/live/mxd-teams.5202345.xyz/fullchain.pem
sudo test -f /etc/letsencrypt/live/mxd-teams.5202345.xyz/privkey.pem
sudo cp -a /etc/nginx/sites-available/mxd-teams.5202345.xyz.conf \
  /etc/nginx/sites-available/mxd-teams.5202345.xyz.conf.before-https

sudo tee /etc/nginx/sites-available/mxd-teams.5202345.xyz.conf >/dev/null <<'NGINX'
# Managed by mxd-player deployment
server {
    listen 80;
    listen [::]:80;
    server_name mxd-teams.5202345.xyz;

    location /.well-known/acme-challenge/ {
        root /opt/mxd-sop/mxd-player/frontend-player/dist;
        try_files $uri =404;
    }
    location / { return 301 https://$host$request_uri; }
}

server {
    listen 443 ssl;
    listen [::]:443 ssl;
    server_name mxd-teams.5202345.xyz;

    ssl_certificate /etc/letsencrypt/live/mxd-teams.5202345.xyz/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/mxd-teams.5202345.xyz/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    root /opt/mxd-sop/mxd-player/frontend-player/dist;
    index index.html;
    client_max_body_size 32k;

    location /api/ {
        proxy_pass http://127.0.0.1:26906;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Authorization $http_authorization;
        proxy_read_timeout 30s;
    }
    location = /health {
        proxy_pass http://127.0.0.1:26906;
        proxy_set_header Host $host;
    }
    location / { try_files $uri $uri/ /index.html; }
}
NGINX

if sudo nginx -t; then
  sudo systemctl reload nginx
else
  sudo mv /etc/nginx/sites-available/mxd-teams.5202345.xyz.conf.before-https \
    /etc/nginx/sites-available/mxd-teams.5202345.xyz.conf
  echo 'Nginx 检查失败，已恢复临时配置；没有 reload' >&2
  exit 1
fi
sudo curl -fsS https://mxd-teams.5202345.xyz/health
sudo curl -fsSI https://mxd-teams.5202345.xyz/
)
```

## 7. 配置证书自动续期

```bash
(
sudo tee /etc/letsencrypt/renewal-hooks/deploy/mxd-teams-nginx.sh >/dev/null <<'HOOK'
#!/bin/sh
systemctl reload nginx
HOOK
sudo chmod 750 /etc/letsencrypt/renewal-hooks/deploy/mxd-teams-nginx.sh
sudo systemctl enable --now certbot.timer
sudo certbot renew --dry-run
)
```

## 8. 配置 player 数据库备份

```bash
(
sudo tee /usr/local/sbin/mxd-player-backup >/dev/null <<'SCRIPT'
#!/bin/sh
set -eu
backup_dir=/var/backups/mxd-player
database=/var/lib/mxd-player/player.sqlite
timestamp=$(date -u +%Y%m%dT%H%M%SZ)
target="$backup_dir/player-$timestamp.sqlite"
install -d -o mxd-sop -g mxd-sop -m 700 "$backup_dir"
sqlite3 "$database" ".backup '$target'"
chown mxd-sop:mxd-sop "$target"
chmod 600 "$target"
find "$backup_dir" -type f -name 'player-*.sqlite' -mtime +30 -delete
echo "Created $target"
SCRIPT
sudo chmod 750 /usr/local/sbin/mxd-player-backup
sudo tee /etc/cron.d/mxd-player-backup >/dev/null <<'CRON'
0 3 * * * root /usr/local/sbin/mxd-player-backup
CRON
sudo chmod 644 /etc/cron.d/mxd-player-backup
sudo /usr/local/sbin/mxd-player-backup
)
```

## 9. 每次发布（仅 player 单独升级，接在主项目更新后）

你原来的主项目更新命令保持不变。主项目 `git pull` 完成后，直接执行下面
这一段即可。它不会再次执行 Git 拉取，也不会停止或重启 `mxd-sop` 服务。
本次两个项目同机升级请优先执行文档末尾的第 11 节统一命令，不要把第 9 节
和运营台文档的升级段落重复执行两遍。

```bash
(
set -eu
sudo /usr/local/sbin/mxd-player-backup

sudo -u mxd-sop bash -lc '
  set -eu
  . /opt/mxd-player/toolchain.env
  cd /opt/mxd-sop/mxd-player/frontend-player
  if [ -f package-lock.json ]; then npm ci; else npm install --no-package-lock; fi
  npm run lint
  npm run build
  cd ../backend-player
  "$GO_BIN" test ./...
  "$GO_BIN" vet ./...
  "$GO_BIN" build -trimpath -ldflags="-s -w" -o /opt/mxd-player/bin/mxd-player.new ./cmd/mxd-player
'
sudo -u mxd-sop mv /opt/mxd-player/bin/mxd-player.new /opt/mxd-player/bin/mxd-player
sudo chmod 755 /opt/mxd-player/bin/mxd-player
sudo systemctl restart mxd-player
sudo systemctl is-active --quiet mxd-player
sudo curl -fsS http://127.0.0.1:26906/health
sudo curl -fsS https://mxd-teams.5202345.xyz/health
)
```

## 10. 故障检查

如果第 1 节出现 `pathspec 'mxd-player/backend-player/go.mod' did not match`
或类似错误，说明当前 `HEAD` 还没有 player 文件（通常是主项目尚未拉到最新提交）。
先回到第 0 节更新 `/opt/mxd-sop`，再重新执行第 1 节；不要手工复制目录，也不要
对这些文件执行 `git add`。

```bash
sudo systemctl status mxd-player --no-pager -l
sudo journalctl -u mxd-player -n 100 --no-pager
sudo ss -ltnp | grep -E ':26906\\b' || true
sudo curl -v http://127.0.0.1:26906/health
sudo nginx -t
sudo nginx -T 2>&1 | grep -A45 -B3 'mxd-teams.5202345.xyz'
sudo tail -n 100 /var/log/nginx/error.log
```

公网只需要放行 TCP `80` 和 `443`，不要开放 `26906`。Nginx 使用平滑
`reload`，不会停止已有站点的后端进程。

## 11. 本次修改的同机升级命令（运营台 + mxd-player）

`mxd-player` 与运营台部署在同一台服务器时，从 `/opt/mxd-sop` 执行下面整段
命令即可。它会备份两个独立 SQLite 数据库，分别完成 Node/React/Go 校验，
构建成功后才替换 player 二进制；任何一步失败都会停止，不会启动不完整版本。

### 11.1 单独编辑并加载 env 配置

如果只需要修改令牌，先单独执行下面这段。它会编辑两个配置文件，检查令牌
一致且不是占位值，确认两个 systemd 服务确实引用对应的 `EnvironmentFile`，
然后重载并重启服务使配置生效。只替换等号后的值，不要加引号；令牌内容不会被打印。

```bash
(
set -eu
sudoedit /etc/mxd-sop/mxd-sop.env
sudoedit /etc/mxd-player/mxd-player.env

sudo sh -c '
  set -eu
  ops=$(sed -n "s/^MXD_PLAYER_SERVICE_TOKEN=//p" /etc/mxd-sop/mxd-sop.env | head -n1)
  player=$(sed -n "s/^PLAYER_SERVICE_TOKEN=//p" /etc/mxd-player/mxd-player.env | head -n1)
  test -n "$ops" && test "$ops" = "$player"
  case "$ops" in replace-with-*|*" "*) echo "令牌仍是占位值或包含空格" >&2; exit 1;; esac
'
sudo chmod 600 /etc/mxd-sop/mxd-sop.env /etc/mxd-player/mxd-player.env
sudo systemctl cat mxd-sop | grep -F 'EnvironmentFile=/etc/mxd-sop/mxd-sop.env'
sudo systemctl cat mxd-player | grep -F 'EnvironmentFile=/etc/mxd-player/mxd-player.env'
sudo systemctl daemon-reload
sudo systemctl restart mxd-player mxd-sop
sudo systemctl is-active --quiet mxd-player
sudo systemctl is-active --quiet mxd-sop
curl -fsS http://127.0.0.1:26906/health
curl -fsS http://127.0.0.1:26902/health
)
```

### 11.2 同机升级

```bash
(
set -eu
sudo -v
cd /opt/mxd-sop

if [ -n "$(sudo -u mxd-sop git status --porcelain)" ]; then
  echo '工作区有未提交修改，已停止；请先保存或提交后再升级' >&2
  exit 1
fi

sudo env DATABASE_PATH=/var/lib/mxd-sop/ops.sqlite \
  sh /opt/mxd-sop/deploy/backup-sqlite.sh /var/backups/mxd-sop
sudo /usr/local/sbin/mxd-player-backup
sudo -u mxd-sop git pull --ff-only origin main

sudo -u mxd-sop bash -lc '
  set -eu
  cd /opt/mxd-sop
  npm ci
  npm test
  npm run lint
  npm run build
  npm prune --omit=dev
'

sudo -u mxd-sop bash -lc '
  set -eu
  cd /opt/mxd-sop/mxd-player/frontend-player
  if [ -f package-lock.json ]; then npm ci; else npm install --no-package-lock; fi
  npm run lint
  npm run build
  . /opt/mxd-player/toolchain.env
  cd /opt/mxd-sop/mxd-player/backend-player
  "$GO_BIN" mod download
  "$GO_BIN" test ./...
  "$GO_BIN" vet ./...
  "$GO_BIN" build -trimpath -ldflags="-s -w" -o /opt/mxd-player/bin/mxd-player.new ./cmd/mxd-player
'
sudo -u mxd-sop mv /opt/mxd-player/bin/mxd-player.new /opt/mxd-player/bin/mxd-player
sudo chmod 755 /opt/mxd-player/bin/mxd-player

# 第 11.1 节已经编辑并加载 env；这里再次无输出校验两边令牌一致。
sudo sh -c '
  set -eu
  ops=$(sed -n "s/^MXD_PLAYER_SERVICE_TOKEN=//p" /etc/mxd-sop/mxd-sop.env | head -n1)
  player=$(sed -n "s/^PLAYER_SERVICE_TOKEN=//p" /etc/mxd-player/mxd-player.env | head -n1)
  test -n "$ops" && test "$ops" = "$player"
  case "$ops" in replace-with-*|*" "*) echo "令牌仍是占位值或包含空格" >&2; exit 1;; esac
'
sudo chmod 600 /etc/mxd-sop/mxd-sop.env /etc/mxd-player/mxd-player.env

sudo systemctl daemon-reload
sudo systemctl restart mxd-player
sudo systemctl restart mxd-sop
sudo systemctl is-active --quiet mxd-player
sudo systemctl is-active --quiet mxd-sop
curl -fsS http://127.0.0.1:26906/health
curl -fsS http://127.0.0.1:26902/health
sudo nginx -t
sudo systemctl reload nginx
curl -fsS https://mxd-teams.5202345.xyz/health
curl -fsS https://mxd-sop.5202345.xyz/health
)
```

本地开发对应的两个令牌文件是：

```text
C:\Users\22734\Desktop\PROJECTS\MXDCMD\.env
C:\Users\22734\Desktop\PROJECTS\MXDCMD\mxd-player\backend-player\.env
```

服务器上的两个令牌文件是：

```text
/etc/mxd-sop/mxd-sop.env
/etc/mxd-player/mxd-player.env
```

四个文件中的同一对配置只需要保证令牌一致；本地启动脚本会自动读取 player
配置，生产环境由 systemd 的 `EnvironmentFile` 读取。升级后再检查两个本机
健康地址和两个域名，确认玩家登录、CSV 导入、账号列表与队伍查看均可用。
