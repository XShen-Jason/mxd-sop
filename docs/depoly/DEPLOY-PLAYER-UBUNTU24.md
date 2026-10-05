# mxd-player：Ubuntu 24 首次部署

本文假设 SOP 已部署在同一台服务器，源码位于 `/opt/mxd-sop/mxd-player`。
player 后端监听 `127.0.0.1:26906`，前端由 Nginx 提供静态文件。默认域名为
`player.example.com`。

## 1. 安装 Go、检查源码

```bash
(
set -eu
sudo apt update
sudo apt install -y ca-certificates curl git nginx sqlite3 openssl certbot
if ! command -v go >/dev/null 2>&1 || ! go version | grep -Eq 'go1\.(2[3-9]|[3-9][0-9])'; then
  GO_VERSION=1.23.12
  GO_ARCH=$(dpkg --print-architecture)
  case "$GO_ARCH" in amd64) GO_ARCH=amd64;; arm64) GO_ARCH=arm64;; *) echo '只支持 amd64/arm64' >&2; exit 1;; esac
  sudo install -d -m 755 /opt/mxd-player/toolchain
  curl -fsSL "https://go.dev/dl/go${GO_VERSION}.linux-${GO_ARCH}.tar.gz" | sudo tar -xzf - --strip-components=1 -C /opt/mxd-player/toolchain
  GO_BIN=/opt/mxd-player/toolchain/bin/go
else
  GO_BIN=$(command -v go)
fi
sudo install -d -o mxd-sop -g mxd-sop /opt/mxd-player/bin /var/lib/mxd-player /var/backups/mxd-player
sudo install -d -o root -g root -m 755 /etc/mxd-player
test -f /opt/mxd-sop/mxd-player/backend-player/go.mod
printf 'GO_BIN=%s\n' "$GO_BIN" | sudo tee /opt/mxd-player/toolchain.env >/dev/null
"$GO_BIN" version
)
```

## 2. 构建 player

```bash
(
set -eu
sudo -u mxd-sop bash -lc '
  set -eu
  cd /opt/mxd-sop/mxd-player/frontend-player
  npm ci
  npm run lint
  npm run build
  . /opt/mxd-player/toolchain.env
  cd ../backend-player
  "$GO_BIN" mod download
  "$GO_BIN" test ./...
  "$GO_BIN" vet ./...
  "$GO_BIN" build -trimpath -ldflags="-s -w" -o /opt/mxd-player/bin/mxd-player.new ./cmd/mxd-player
'
sudo mv /opt/mxd-player/bin/mxd-player.new /opt/mxd-player/bin/mxd-player
sudo chown mxd-sop:mxd-sop /opt/mxd-player/bin/mxd-player
sudo chmod 755 /opt/mxd-player/bin/mxd-player
test -f /opt/mxd-sop/mxd-player/frontend-player/dist/index.html
)
```

## 3. 配置令牌、CSV 和 systemd

`PLAYER_SERVICE_TOKEN` 必须与 `/etc/mxd-sop/mxd-sop.env` 中的
`MXD_PLAYER_SERVICE_TOKEN` 相同。CSV 目录可留空，之后从 SOP/player 页面导入；
若已有 `*-char-user-qq.csv`，放入指定目录，文件名必须是 `mg`、`xr`、`hwn`、`uu`、
`ppz` 或 `zz` 前缀。

```bash
(
set -eu
read -rp 'Player 域名（例如 player.example.com）: ' PLAYER_DOMAIN
TOKEN=$(sudo sed -n 's/^MXD_PLAYER_SERVICE_TOKEN=//p' /etc/mxd-sop/mxd-sop.env)
test -n "$TOKEN"
sudo install -d -o mxd-sop -g mxd-sop -m 700 /var/lib/mxd-player/char-user-qq
sudo tee /etc/mxd-player/mxd-player.env >/dev/null <<ENV
HOST=127.0.0.1
PORT=26906
PLAYER_DATABASE_PATH=/var/lib/mxd-player/player.sqlite
PLAYER_CHAR_DATA_DIR=/var/lib/mxd-player/char-user-qq
PLAYER_CORS_ORIGIN=https://$PLAYER_DOMAIN
PLAYER_SERVICE_TOKEN=$TOKEN
PLAYER_DOMAIN=$PLAYER_DOMAIN
ENV
sudo chmod 600 /etc/mxd-player/mxd-player.env
sudo tee /etc/systemd/system/mxd-player.service >/dev/null <<'SERVICE'
[Unit]
Description=MXDCMD player service
After=network-online.target
Wants=network-online.target

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
curl -fsS http://127.0.0.1:26906/health
)
```

## 4. Nginx、HTTPS 和备份

```bash
(
set -eu
PLAYER_DOMAIN=$(sudo sed -n 's/^PLAYER_DOMAIN=//p' /etc/mxd-player/mxd-player.env)
read -rp 'Let’s Encrypt 邮箱: ' ACME_EMAIL
sudo tee /etc/nginx/sites-available/mxd-player.conf >/dev/null <<NGINX
server {
    listen 80;
    listen [::]:80;
    server_name $PLAYER_DOMAIN;
    root /opt/mxd-sop/mxd-player/frontend-player/dist;
    location /.well-known/acme-challenge/ { try_files \$uri =404; }
    location / { try_files \$uri \$uri/ /index.html; }
}
NGINX
sudo ln -sfn /etc/nginx/sites-available/mxd-player.conf /etc/nginx/sites-enabled/mxd-player.conf
sudo nginx -t && sudo systemctl reload nginx
sudo certbot certonly --webroot --non-interactive --agree-tos --email "$ACME_EMAIL" --keep-until-expiring -w /opt/mxd-sop/mxd-player/frontend-player/dist -d "$PLAYER_DOMAIN"
sudo tee /etc/nginx/sites-available/mxd-player.conf >/dev/null <<NGINX
server {
    listen 80;
    listen [::]:80;
    server_name $PLAYER_DOMAIN;
    location /.well-known/acme-challenge/ { root /opt/mxd-sop/mxd-player/frontend-player/dist; try_files \$uri =404; }
    location / { return 301 https://\$host\$request_uri; }
}
server {
    listen 443 ssl;
    listen [::]:443 ssl;
    server_name $PLAYER_DOMAIN;
    ssl_certificate /etc/letsencrypt/live/$PLAYER_DOMAIN/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/$PLAYER_DOMAIN/privkey.pem;
    root /opt/mxd-sop/mxd-player/frontend-player/dist;
    index index.html;
    client_max_body_size 32k;
    location /api/ {
        proxy_pass http://127.0.0.1:26906;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    }
    location = /health { proxy_pass http://127.0.0.1:26906; }
    location / { try_files \$uri \$uri/ /index.html; }
}
NGINX
sudo nginx -t && sudo systemctl reload nginx
sudo systemctl enable --now certbot.timer
sudo tee /usr/local/sbin/mxd-player-backup >/dev/null <<'SCRIPT'
#!/bin/sh
set -eu
target=/var/backups/mxd-player/player-$(date -u +%Y%m%dT%H%M%SZ).sqlite
install -d -o root -g root -m 700 /var/backups/mxd-player
sqlite3 /var/lib/mxd-player/player.sqlite ".backup '$target'"
chmod 600 "$target"
find /var/backups/mxd-player -type f -mtime +30 -delete
SCRIPT
sudo chmod 750 /usr/local/sbin/mxd-player-backup
sudo tee /etc/cron.d/mxd-player-backup >/dev/null <<'CRON'
0 3 * * * root /usr/local/sbin/mxd-player-backup
CRON
sudo chmod 644 /etc/cron.d/mxd-player-backup
sudo /usr/local/sbin/mxd-player-backup
curl -fsS "https://$PLAYER_DOMAIN/health"
)
```

## 5. 后续升级

```bash
(
set -eu
sudo /usr/local/sbin/mxd-player-backup
sudo -u mxd-sop bash -lc '
  set -eu
  cd /opt/mxd-sop/mxd-player/frontend-player
  npm ci && npm run lint && npm run build
  . /opt/mxd-player/toolchain.env
  cd ../backend-player
  "$GO_BIN" test ./... && "$GO_BIN" vet ./...
  "$GO_BIN" build -trimpath -ldflags="-s -w" -o /opt/mxd-player/bin/mxd-player.new ./cmd/mxd-player
'
sudo mv /opt/mxd-player/bin/mxd-player.new /opt/mxd-player/bin/mxd-player
sudo chown mxd-sop:mxd-sop /opt/mxd-player/bin/mxd-player
sudo systemctl restart mxd-player
curl -fsS http://127.0.0.1:26906/health
)
```

## 6. 跨服务器部署（放在最后）

跨主机时在 player 的 env 中把 `PLAYER_CORS_ORIGIN` 设置为实际前端域名；SOP 的
`MXD_PLAYER_REMOTE_URL` 指向 player 的 HTTPS 域名，并将
`MXD_PLAYER_DEPLOYMENT_MODE=remote`。令牌仍使用同一随机值。player Nginx 只允许
SOP 主机访问内部 API（或使用 mTLS/VPN），公网不要开放 `26906`。
