# mxd-auto-process：Ubuntu 24 首次部署

本文部署 `mxd-auto-process`。它将 React 前端构建到 Go 的嵌入资源中，生产环境
只运行一个 `26909` 进程，不运行对外的 Vite `6909`。默认域名为
`auto.example.com`。同机部署时 SOP 通过 `http://127.0.0.1:26909` 调用它。

## 1. 安装工具链和目录

```bash
(
set -eu
sudo apt update
sudo apt install -y ca-certificates curl git nginx sqlite3 openssl certbot
if ! command -v node >/dev/null 2>&1 || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt install -y nodejs
fi
if ! command -v go >/dev/null 2>&1 || ! go version | grep -Eq 'go1\.(2[3-9]|[3-9][0-9])'; then
  GO_VERSION=1.23.12
  GO_ARCH=$(dpkg --print-architecture); case "$GO_ARCH" in amd64) GO_ARCH=amd64;; arm64) GO_ARCH=arm64;; *) exit 1;; esac
  sudo install -d -m 755 /opt/mxd-auto-process/toolchain
  curl -fsSL "https://go.dev/dl/go${GO_VERSION}.linux-${GO_ARCH}.tar.gz" | sudo tar -xzf - --strip-components=1 -C /opt/mxd-auto-process/toolchain
  GO_BIN=/opt/mxd-auto-process/toolchain/bin/go
else GO_BIN=$(command -v go); fi
id mxd-auto >/dev/null 2>&1 || sudo useradd --system --home /var/lib/mxd-auto-process --shell /usr/sbin/nologin mxd-auto
sudo install -d -o root -g root -m 755 /opt/mxd-auto-process/bin
sudo install -d -o mxd-auto -g mxd-auto -m 700 /var/lib/mxd-auto-process /var/lib/mxd-auto-process/datacj
sudo install -d -o root -g root -m 755 /etc/mxd-auto-process
sudo install -d -o root -g root -m 700 /var/backups/mxd-auto-process
printf 'GO_BIN=%s\n' "$GO_BIN" | sudo tee /opt/mxd-auto-process/toolchain.env >/dev/null
test -f /opt/mxd-sop/mxd-auto-process/backend-auto-process/go.mod
)
```

## 2. 配置服务器目录、令牌和初始密码

`servers.json` 只用于新数据库的初始导入；后续服务器配置在 auto 页面维护。
请把示例中的游戏服务器地址改为真实地址。

```bash
(
set -eu
read -rp 'Auto 域名（例如 auto.example.com）: ' AUTO_DOMAIN
sudo cp /opt/mxd-sop/mxd-auto-process/backend-auto-process/config/servers.example.json /etc/mxd-auto-process/servers.json
sudo chown root:mxd-auto /etc/mxd-auto-process/servers.json
sudo chmod 640 /etc/mxd-auto-process/servers.json
sudoedit /etc/mxd-auto-process/servers.json
read -rsp 'Auto 初始管理员密码（至少 6 位）: ' AUTO_PASSWORD; printf '\n'
TOKEN=$(sudo sed -n 's/^MXD_AUTO_SERVICE_TOKEN=//p' /etc/mxd-sop/mxd-sop.env)
test -n "$TOKEN"
sudo tee /etc/mxd-auto-process/mxd-auto-process.env >/dev/null <<ENV
AUTO_DATABASE_PATH=/var/lib/mxd-auto-process/auto.sqlite
AUTO_CREDENTIAL_KEY_PATH=/var/lib/mxd-auto-process/auto-credentials.key
AUTO_INITIAL_PASSWORD=$AUTO_PASSWORD
AUTO_SERVICE_TOKEN=$TOKEN
AUTO_COOKIE_SECURE=true
AUTO_DOMAIN=$AUTO_DOMAIN
ENV
sudo chmod 600 /etc/mxd-auto-process/mxd-auto-process.env
unset AUTO_PASSWORD TOKEN
)
```

如有已授权的角色 opaque 抓包，把 `.pcap` 文件通过安全传输复制到
`/var/lib/mxd-auto-process/datacj/`，并执行：

```bash
sudo chown -R mxd-auto:mxd-auto /var/lib/mxd-auto-process/datacj
sudo find /var/lib/mxd-auto-process/datacj -type f -exec chmod 600 {} +
```

## 3. 构建 Go 二进制（包含前端）

```bash
(
set -eu
BUILD_ROOT=$(mktemp -d /var/tmp/mxd-auto-build.XXXXXX)
trap 'rm -rf "$BUILD_ROOT"' EXIT
sudo chown mxd-auto:mxd-auto "$BUILD_ROOT"
sudo -u mxd-sop git -C /opt/mxd-sop archive --format=tar HEAD mxd-auto-process | sudo -u mxd-auto tar -xf - -C "$BUILD_ROOT"
sudo -u mxd-auto bash -lc '
  set -eu
  . /opt/mxd-auto-process/toolchain.env
  cd "$1/mxd-auto-process/frontend-auto-process"
  npm ci && npm run lint && npm test && npm run build
  cd ../backend-auto-process
  "$GO_BIN" mod download && "$GO_BIN" test ./... && "$GO_BIN" vet ./...
  "$GO_BIN" build -trimpath -ldflags="-s -w" -o "$1/mxd-auto-process" ./cmd/mxd-auto-process
' sh "$BUILD_ROOT"
sudo install -o mxd-auto -g mxd-auto -m 755 "$BUILD_ROOT/mxd-auto-process" /opt/mxd-auto-process/bin/mxd-auto-process
)
```

## 4. 创建 systemd、启动和备份

```bash
sudo tee /etc/systemd/system/mxd-auto-process.service >/dev/null <<'SERVICE'
[Unit]
Description=MXDCMD auto process
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=mxd-auto
Group=mxd-auto
WorkingDirectory=/opt/mxd-auto-process
EnvironmentFile=/etc/mxd-auto-process/mxd-auto-process.env
ExecStart=/opt/mxd-auto-process/bin/mxd-auto-process --config /etc/mxd-auto-process/servers.json --role-opaque-pcap-path /var/lib/mxd-auto-process/datacj --listen 127.0.0.1:26909
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/mxd-auto-process
LimitNOFILE=4096

[Install]
WantedBy=multi-user.target
SERVICE
sudo systemctl daemon-reload
sudo systemctl enable --now mxd-auto-process
sudo systemctl is-active --quiet mxd-auto-process
curl -fsS http://127.0.0.1:26909/api/v1/healthz
sudo tee /usr/local/sbin/mxd-auto-backup >/dev/null <<'SCRIPT'
#!/bin/sh
set -eu
target=/var/backups/mxd-auto-process/$(date -u +%Y%m%dT%H%M%SZ)
install -d -o root -g root -m 700 "$target"
sqlite3 /var/lib/mxd-auto-process/auto.sqlite ".backup '$target/auto.sqlite'"
cp -p /var/lib/mxd-auto-process/auto-credentials.key "$target/"
cp -p /etc/mxd-auto-process/mxd-auto-process.env "$target/"
cp -p /etc/mxd-auto-process/servers.json "$target/"
chmod 600 "$target"/*
find /var/backups/mxd-auto-process -mindepth 1 -maxdepth 1 -type d -mtime +30 -exec rm -rf -- {} +
SCRIPT
sudo chmod 750 /usr/local/sbin/mxd-auto-backup
sudo tee /etc/cron.d/mxd-auto-backup >/dev/null <<'CRON'
0 3 * * * root /usr/local/sbin/mxd-auto-backup
CRON
sudo chmod 644 /etc/cron.d/mxd-auto-backup
sudo /usr/local/sbin/mxd-auto-backup
```

## 5. Nginx、HTTPS 和 SOP 联通

```bash
(
set -eu
AUTO_DOMAIN=$(sudo sed -n 's/^AUTO_DOMAIN=//p' /etc/mxd-auto-process/mxd-auto-process.env)
read -rp 'Let’s Encrypt 邮箱: ' ACME_EMAIL
sudo tee /etc/nginx/sites-available/mxd-auto.conf >/dev/null <<NGINX
server {
    listen 80;
    listen [::]:80;
    server_name $AUTO_DOMAIN;
    location /.well-known/acme-challenge/ { root /var/www/html; try_files \$uri =404; }
    location / { return 301 https://\$host\$request_uri; }
}
NGINX
sudo mkdir -p /var/www/html
sudo ln -sfn /etc/nginx/sites-available/mxd-auto.conf /etc/nginx/sites-enabled/mxd-auto.conf
sudo nginx -t && sudo systemctl reload nginx
sudo certbot certonly --webroot --non-interactive --agree-tos --email "$ACME_EMAIL" --keep-until-expiring -w /var/www/html -d "$AUTO_DOMAIN"
sudo tee /etc/nginx/sites-available/mxd-auto.conf >/dev/null <<NGINX
server {
    listen 80;
    listen [::]:80;
    server_name $AUTO_DOMAIN;
    location /.well-known/acme-challenge/ { root /var/www/html; try_files \$uri =404; }
    location / { return 301 https://\$host\$request_uri; }
}
server {
    listen 443 ssl;
    listen [::]:443 ssl;
    server_name $AUTO_DOMAIN;
    ssl_certificate /etc/letsencrypt/live/$AUTO_DOMAIN/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/$AUTO_DOMAIN/privkey.pem;
    client_max_body_size 64k;
    location / {
        proxy_pass http://127.0.0.1:26909;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_buffering off;
        proxy_read_timeout 300s;
    }
}
NGINX
sudo nginx -t && sudo systemctl reload nginx
sudo systemctl enable --now certbot.timer
curl -fsS "https://$AUTO_DOMAIN/api/v1/healthz"
curl -fsS http://127.0.0.1:26902/health
)
```

打开 `https://$AUTO_DOMAIN/`，使用 `admin` 和 `AUTO_INITIAL_PASSWORD` 登录并立即
修改密码。然后在 SOP 的服务器管理页面确认 auto 可用。

## 6. 后续升级

```bash
(
set -eu
sudo /usr/local/sbin/mxd-auto-backup
BUILD_ROOT=$(mktemp -d /var/tmp/mxd-auto-build.XXXXXX)
trap 'rm -rf "$BUILD_ROOT"' EXIT
sudo chown mxd-auto:mxd-auto "$BUILD_ROOT"
sudo -u mxd-sop git -C /opt/mxd-sop archive --format=tar HEAD mxd-auto-process | sudo -u mxd-auto tar -xf - -C "$BUILD_ROOT"
sudo -u mxd-auto bash -lc '
  set -eu; . /opt/mxd-auto-process/toolchain.env
  cd "$1/mxd-auto-process/frontend-auto-process"; npm ci && npm run lint && npm test && npm run build
  cd ../backend-auto-process; "$GO_BIN" test ./... && "$GO_BIN" vet ./... && "$GO_BIN" build -trimpath -ldflags="-s -w" -o "$1/mxd-auto-process" ./cmd/mxd-auto-process
' sh "$BUILD_ROOT"
sudo install -o mxd-auto -g mxd-auto -m 755 "$BUILD_ROOT/mxd-auto-process" /opt/mxd-auto-process/bin/mxd-auto-process
sudo systemctl restart mxd-auto-process
curl -fsS http://127.0.0.1:26909/api/v1/healthz
)
```

## 7. 跨服务器部署（放在最后）

auto 与 SOP 分开时，SOP 的 `MXD_AUTO_LOCAL_URL` 实际上填写 auto 服务器的
HTTPS 反代地址（变量名称沿用当前代码），并将 `MXD_AUTO_SERVICE_TOKEN` 与
auto 的 `AUTO_SERVICE_TOKEN` 保持一致。auto 服务器只允许 SOP 服务器访问 API，
使用 VPN、私网或带来源白名单的 HTTPS；不要暴露 `26909`，也不要使用 `6909`。
跨主机时必须把 `AUTO_COOKIE_SECURE=true` 保持开启，并分别备份 auto SQLite 与
`auto-credentials.key`，两者缺一不可。
