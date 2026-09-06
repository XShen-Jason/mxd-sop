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

## 1. 检查主项目工作区

整段复制执行。任一检查失败都会停止，不会修改现有服务。

```bash
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
```

## 2. 创建 player 目录

整段复制执行。复用主项目已有的 `mxd-sop` 用户，不创建新的 Linux 用户，
避免 Git 权限和 SSH 认证问题。如果系统没有 Go 1.23+，只在 player 专用目录
安装 Go，不替换主项目或其他服务使用的系统版本。

```bash
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
```

## 3. 首次构建 player

整段复制执行。前端和后端都从 `/opt/mxd-sop/mxd-player` 构建；构建失败时
命令会停止，不会启动不完整的服务。

```bash
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
  "$GO_BIN" build -trimpath -ldflags="-s -w" -o /opt/mxd-player/bin/mxd-player.new ./...
'
sudo -u mxd-sop mv /opt/mxd-player/bin/mxd-player.new /opt/mxd-player/bin/mxd-player
sudo chmod 755 /opt/mxd-player/bin/mxd-player
sudo test -f /opt/mxd-sop/mxd-player/frontend-player/dist/index.html
sudo test -x /opt/mxd-player/bin/mxd-player
```

## 4. 创建 player systemd 服务

整段复制执行。数据库位于主项目仓库之外，服务只写入自己的数据目录。

```bash
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
PLAYER_CHAR_DATA_DIR=/opt/mxd-sop/mxd-player/backend-player/data/char-user-qq
PLAYER_CORS_ORIGIN=https://mxd-teams.5202345.xyz
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
```

## 5. 创建临时 HTTP Nginx 站点并申请证书

本段只新增 `mxd-teams.5202345.xyz.conf`。已有同名文件或 Nginx 配置时会
停止，不会覆盖。`nginx -t` 失败时不会 reload。

```bash
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
```

## 6. 切换到最终 HTTPS 配置

整段复制执行。只覆盖第 5 步创建且带有管理标记的 player 配置；检查失败
会自动恢复临时配置，已有站点不会 reload。

```bash
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
```

## 7. 配置证书自动续期

```bash
sudo tee /etc/letsencrypt/renewal-hooks/deploy/mxd-teams-nginx.sh >/dev/null <<'HOOK'
#!/bin/sh
systemctl reload nginx
HOOK
sudo chmod 750 /etc/letsencrypt/renewal-hooks/deploy/mxd-teams-nginx.sh
sudo systemctl enable --now certbot.timer
sudo certbot renew --dry-run
```

## 8. 配置 player 数据库备份

```bash
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
```

## 9. 每次发布（接在主项目更新后）

你原来的主项目更新命令保持不变。主项目 `git pull` 完成后，直接执行下面
这一段即可。它不会再次执行 Git 拉取，也不会停止或重启 `mxd-sop` 服务。

```bash
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
  "$GO_BIN" build -trimpath -ldflags="-s -w" -o /opt/mxd-player/bin/mxd-player.new ./...
'
sudo -u mxd-sop mv /opt/mxd-player/bin/mxd-player.new /opt/mxd-player/bin/mxd-player
sudo chmod 755 /opt/mxd-player/bin/mxd-player
sudo systemctl restart mxd-player
sudo systemctl is-active --quiet mxd-player
sudo curl -fsS http://127.0.0.1:26906/health
sudo curl -fsS https://mxd-teams.5202345.xyz/health
```

## 10. 故障检查

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
