# SOP 运营台：Ubuntu 24 首次部署

本文部署仓库根目录的 `backend` 和 `frontend`。player、auto 依赖本仓库中的
源码，但各自的部署见另外两份文档。默认域名为 `sop.example.com`，可直接替换
为自己的域名。

## 1. 一次性准备

先把域名 A/AAAA 记录指向服务器，并以可使用 `sudo` 的账号 SSH 登录。整段复制：

```bash
(
set -eu
sudo apt update
sudo apt install -y ca-certificates curl git nginx sqlite3 build-essential openssl certbot
if ! command -v node >/dev/null 2>&1 || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt install -y nodejs
fi
node --version
npm --version
)
```

创建源码、数据和配置目录：

```bash
(
set -eu
id mxd-sop >/dev/null 2>&1 || sudo useradd --system --home /opt/mxd-sop --shell /usr/sbin/nologin mxd-sop
sudo install -d -o mxd-sop -g mxd-sop /opt/mxd-sop /var/lib/mxd-sop
sudo install -d -o root -g root -m 755 /etc/mxd-sop
sudo install -d -o root -g root -m 700 /var/backups/mxd-sop
if [ ! -d /opt/mxd-sop/.git ]; then
  sudo git clone https://github.com/XShen-Jason/mxd-sop.git /opt/mxd-sop
fi
sudo chown -R mxd-sop:mxd-sop /opt/mxd-sop
)
```

## 2. 安装依赖并构建

```bash
(
set -eu
sudo -u mxd-sop bash -lc 'cd /opt/mxd-sop && npm ci && npm test && npm run lint && npm run build && npm prune --omit=dev && npm audit --omit=dev --audit-level=high'
test -f /opt/mxd-sop/frontend/dist/index.html
test -f /opt/mxd-sop/backend/dist/src/server.js
)
```

## 3. 创建配置

下面命令会交互式询问域名、管理员账号和密码，并自动生成 player/auto 令牌。
令牌会写入本机文件，不会打印。player、auto 部署文档会读取相同的令牌。

```bash
(
set -eu
read -rp 'SOP 域名（例如 sop.example.com）: ' SOP_DOMAIN
read -rp '初始管理员用户名 [superadmin]: ' SOP_ADMIN
SOP_ADMIN=${SOP_ADMIN:-superadmin}
read -rsp '初始管理员密码（至少 6 位）: ' SOP_PASSWORD; printf '\n'
read -rsp '与 player 共用的服务令牌（留空自动生成）: ' PLAYER_TOKEN; printf '\n'
PLAYER_TOKEN=${PLAYER_TOKEN:-$(openssl rand -hex 32)}
read -rsp '与 auto 共用的服务令牌（留空自动生成）: ' AUTO_TOKEN; printf '\n'
AUTO_TOKEN=${AUTO_TOKEN:-$(openssl rand -hex 32)}
sudo tee /etc/mxd-sop/mxd-sop.env >/dev/null <<ENV
NODE_ENV=production
HOST=127.0.0.1
PORT=26902
DATABASE_PATH=/var/lib/mxd-sop/ops.sqlite
COOKIE_SECURE=true
INITIAL_ADMIN_USERNAME=$SOP_ADMIN
INITIAL_ADMIN_DISPLAY_NAME=System Administrator
INITIAL_ADMIN_PASSWORD=$SOP_PASSWORD
MXD_PLAYER_LOCAL_URL=http://127.0.0.1:26906
MXD_PLAYER_SERVICE_TOKEN=$PLAYER_TOKEN
MXD_PLAYER_DEPLOYMENT_MODE=local
MXD_AUTO_LOCAL_URL=http://127.0.0.1:26909
MXD_AUTO_SERVICE_TOKEN=$AUTO_TOKEN
MXD_AUTO_TIMEOUT_MS=10000
SOP_DOMAIN=$SOP_DOMAIN
ENV
sudo chmod 600 /etc/mxd-sop/mxd-sop.env
unset SOP_PASSWORD PLAYER_TOKEN AUTO_TOKEN
)
```

首次成功登录并修改密码后，删除一次性环境变量：

```bash
sudo sed -i '/^INITIAL_ADMIN_PASSWORD=/d' /etc/mxd-sop/mxd-sop.env
```

## 4. 创建并启动 systemd

```bash
sudo tee /etc/systemd/system/mxd-sop.service >/dev/null <<'SERVICE'
[Unit]
Description=MXDCMD SOP operations desk
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=mxd-sop
Group=mxd-sop
WorkingDirectory=/opt/mxd-sop
EnvironmentFile=/etc/mxd-sop/mxd-sop.env
ExecStart=/usr/bin/node /opt/mxd-sop/backend/dist/src/server.js
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/mxd-sop
LimitNOFILE=4096

[Install]
WantedBy=multi-user.target
SERVICE
sudo systemctl daemon-reload
sudo systemctl enable --now mxd-sop
sudo systemctl is-active --quiet mxd-sop
curl -fsS http://127.0.0.1:26902/health
```

## 5. 配置 Nginx 和 HTTPS

先确认 `SOP_DOMAIN` 的 DNS 已生效，然后执行。命令会自动申请证书；邮箱用于
证书到期提醒。

```bash
(
set -eu
SOP_DOMAIN=$(sudo sed -n 's/^SOP_DOMAIN=//p' /etc/mxd-sop/mxd-sop.env)
read -rp 'Let’s Encrypt 邮箱: ' ACME_EMAIL
sudo install -d -o mxd-sop -g mxd-sop -m 755 /opt/mxd-sop/frontend/dist
sudo tee /etc/nginx/sites-available/mxd-sop.conf >/dev/null <<NGINX
server {
    listen 80;
    listen [::]:80;
    server_name $SOP_DOMAIN;
    root /opt/mxd-sop/frontend/dist;
    location /.well-known/acme-challenge/ { try_files \$uri =404; }
    location / { try_files \$uri \$uri/ /index.html; }
}
NGINX
sudo ln -sfn /etc/nginx/sites-available/mxd-sop.conf /etc/nginx/sites-enabled/mxd-sop.conf
sudo nginx -t && sudo systemctl reload nginx
sudo certbot certonly --webroot --non-interactive --agree-tos --email "$ACME_EMAIL" --keep-until-expiring -w /opt/mxd-sop/frontend/dist -d "$SOP_DOMAIN"
sudo tee /etc/nginx/sites-available/mxd-sop.conf >/dev/null <<NGINX
server {
    listen 80;
    listen [::]:80;
    server_name $SOP_DOMAIN;
    location /.well-known/acme-challenge/ { root /opt/mxd-sop/frontend/dist; try_files \$uri =404; }
    location / { return 301 https://\$host\$request_uri; }
}
server {
    listen 443 ssl;
    listen [::]:443 ssl;
    server_name $SOP_DOMAIN;
    ssl_certificate /etc/letsencrypt/live/$SOP_DOMAIN/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/$SOP_DOMAIN/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    root /opt/mxd-sop/frontend/dist;
    index index.html;
    client_max_body_size 8m;
    location = /api/v1/operation-groups/events {
        proxy_pass http://127.0.0.1:26902;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header Connection "";
        proxy_buffering off;
        proxy_read_timeout 1h;
    }
    location /api/ {
        proxy_pass http://127.0.0.1:26902;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_read_timeout 60s;
    }
    location = /health { proxy_pass http://127.0.0.1:26902; }
    location / { try_files \$uri \$uri/ /index.html; }
}
NGINX
sudo nginx -t && sudo systemctl reload nginx
sudo systemctl enable --now certbot.timer
curl -fsS "https://$SOP_DOMAIN/health"
)
```

防火墙和云安全组只放行 `80/tcp`、`443/tcp`：

```bash
sudo ufw allow 80/tcp 2>/dev/null || true
sudo ufw allow 443/tcp 2>/dev/null || true
```

## 6. SQLite 备份与日常升级

```bash
sudo tee /usr/local/sbin/mxd-sop-backup >/dev/null <<'SCRIPT'
#!/bin/sh
set -eu
target=/var/backups/mxd-sop/$(date -u +%Y%m%dT%H%M%SZ)
install -d -o root -g root -m 700 "$target"
sqlite3 /var/lib/mxd-sop/ops.sqlite ".backup '$target/ops.sqlite'"
test ! -e /var/lib/mxd-sop/item-catalog.csv || cp -p /var/lib/mxd-sop/item-catalog.csv "$target/"
find /var/backups/mxd-sop -mindepth 1 -maxdepth 1 -type d -mtime +30 -exec rm -rf -- {} +
SCRIPT
sudo chmod 750 /usr/local/sbin/mxd-sop-backup
sudo tee /etc/cron.d/mxd-sop-backup >/dev/null <<'CRON'
0 3 * * * root /usr/local/sbin/mxd-sop-backup
CRON
sudo chmod 644 /etc/cron.d/mxd-sop-backup
sudo /usr/local/sbin/mxd-sop-backup
```

后续发布：

```bash
(
set -eu
sudo /usr/local/sbin/mxd-sop-backup
sudo -u mxd-sop git -C /opt/mxd-sop pull --ff-only origin main
sudo -u mxd-sop bash -lc 'cd /opt/mxd-sop && npm ci && npm test && npm run lint && npm run build && npm prune --omit=dev && npm audit --omit=dev --audit-level=high'
sudo systemctl restart mxd-sop
curl -fsS http://127.0.0.1:26902/health
)
```

## 7. 跨服务器部署（放在最后）

SOP 与 player/auto 分开时，把 `MXD_PLAYER_LOCAL_URL`、`MXD_AUTO_LOCAL_URL` 改为
HTTPS 或私网地址，把 `MXD_PLAYER_DEPLOYMENT_MODE` 改为 `remote`，并在远端服务
的反代层限制来源 IP。三组服务令牌仍必须完全一致；不要把 `26902/26906/26909`
直接暴露公网。SOP 的 Nginx 只代理本机 `26902`，远端 player/auto 各自通过
Nginx 443 提供 API，远端主机之间使用防火墙白名单。
