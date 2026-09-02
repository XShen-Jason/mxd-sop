# MXD SOP Debian 部署（443）

本方案不使用 Docker，前端通过现有 Nginx 的域名虚拟主机监听 `443`，后端只
监听 `127.0.0.1:26902`。现有项目继续使用自己的 `server_name`，不会互相影响。
最终访问地址为：

```text
https://mxd-sop.5202345.xyz
```

以下命令在 Debian/Ubuntu 服务器执行。需要先把 DNS 的 A 记录
`mxd-sop.5202345.xyz` 指向服务器公网 IP。

## 1. 检查环境

```bash
sudo apt update
sudo apt install -y git nginx sqlite3 build-essential python3 curl certbot

node --version
npm --version
sudo ss -ltnp | grep -E ':26902' || true
sudo nginx -T | grep -E 'listen|server_name' || true
```

Node.js 版本必须为 20 或更高，建议使用 Node.js 22 LTS。服务器已有项目
如果依赖其他 Node.js 主版本，不要覆盖它；请改用独立 Node.js 安装或
Docker，并将后面的 `ExecStart` 改为对应的 Node 路径。

如果服务器没有 Node.js，或版本低于 20，再执行：

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
node --version
npm --version
```

## 2. 创建运行用户和目录

```bash
sudo useradd --system --home /opt/mxd-sop --shell /usr/sbin/nologin mxd-sop
sudo install -d -o mxd-sop -g mxd-sop /opt/mxd-sop
sudo install -d -o mxd-sop -g mxd-sop /var/lib/mxd-sop
sudo install -d -o root -g root -m 755 /etc/mxd-sop
sudo install -d -o root -g root -m 700 /var/backups/mxd-sop
```

如果用户已经存在，`useradd` 报错可以忽略，继续执行后面的命令。

## 3. 拉取代码并构建

```bash
sudo git clone https://github.com/XShen-Jason/mxd-sop.git /opt/mxd-sop
sudo chown -R mxd-sop:mxd-sop /opt/mxd-sop

sudo -u mxd-sop bash -lc 'cd /opt/mxd-sop && npm ci'
sudo -u mxd-sop bash -lc 'cd /opt/mxd-sop && npm test'
sudo -u mxd-sop bash -lc 'cd /opt/mxd-sop && npm run build'
sudo -u mxd-sop bash -lc 'cd /opt/mxd-sop && npm prune --omit=dev'
```

## 4. 创建生产环境变量

```bash
sudo cp /opt/mxd-sop/.env.example /etc/mxd-sop/mxd-sop.env
sudo chmod 600 /etc/mxd-sop/mxd-sop.env
sudo sed -i 's#^DATABASE_PATH=.*#DATABASE_PATH=/var/lib/mxd-sop/ops.sqlite#' \
  /etc/mxd-sop/mxd-sop.env
sudoedit /etc/mxd-sop/mxd-sop.env
```

将文件内容改为下面的值，并把密码替换成随机强密码：

```env
NODE_ENV=production
HOST=127.0.0.1
PORT=26902
DATABASE_PATH=/var/lib/mxd-sop/ops.sqlite
COOKIE_SECURE=true

INITIAL_ADMIN_USERNAME=superadmin
INITIAL_ADMIN_DISPLAY_NAME=System Administrator
INITIAL_ADMIN_PASSWORD=请替换为强密码
```

确认数据库路径没有变回模板中的 `/var/lib/ops-desk`：

```bash
sudo grep -E '^(HOST|PORT|DATABASE_PATH|COOKIE_SECURE)=' \
  /etc/mxd-sop/mxd-sop.env
```

不要设置 `CORS_ORIGIN`。前端和 API 通过同一个域名提供服务，不需要跨域。

## 5. 创建并启动后端服务

```bash
sudo tee /etc/systemd/system/mxd-sop.service >/dev/null <<'SERVICE'
[Unit]
Description=MXD SOP backend
After=network.target

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
sudo systemctl status mxd-sop --no-pager
curl -fsS http://127.0.0.1:26902/health
```

第一次启动成功并创建超级管理员后，删除环境文件中的
`INITIAL_ADMIN_PASSWORD`，然后重启服务：

```bash
sudoedit /etc/mxd-sop/mxd-sop.env
sudo systemctl restart mxd-sop
```

## 6. 配置 Nginx 临时 HTTP 站点

服务器已有 Nginx 时不要安装或启动第二个 Nginx，也不要修改现有项目的
配置文件。下面的配置作为新的站点文件加入同一个 Nginx；现有站点会继续
使用它们自己的 `server_name` 和端口。即使现有配置有 `443 default_server`，
Nginx 也会优先按请求中的 `server_name`（TLS SNI/HTTP Host）选择 MXD SOP。

先确认 `mxd-sop.5202345.xyz` 没有出现在现有配置中：

```bash
sudo nginx -T | grep -n 'mxd-sop.5202345.xyz' || true
ls -l /etc/nginx/sites-enabled
```

先创建 ACME 证书验证所需的 HTTP 配置：

```bash
sudo tee /etc/nginx/sites-available/mxd-sop.conf >/dev/null <<'NGINX'
server {
    listen 80;
    listen [::]:80;
    server_name mxd-sop.5202345.xyz;

    root /opt/mxd-sop/frontend/dist;

    location /.well-known/acme-challenge/ {
        try_files $uri =404;
    }

    location / {
        return 301 https://$host$request_uri;
    }
}
NGINX

sudo ln -sfn /etc/nginx/sites-available/mxd-sop.conf \
  /etc/nginx/sites-enabled/mxd-sop.conf
sudo nginx -t
sudo systemctl reload nginx
```

## 7. 申请 HTTPS 证书

确认 DNS 已生效后执行：

```bash
sudo certbot certonly --webroot \
  -w /opt/mxd-sop/frontend/dist \
  -d mxd-sop.5202345.xyz \
  --email YOUR_EMAIL@example.com \
  --agree-tos \
  --no-eff-email
```

## 8. 配置 Nginx 监听 443

```bash
sudo tee /etc/nginx/sites-available/mxd-sop.conf >/dev/null <<'NGINX'
server {
    listen 80;
    listen [::]:80;
    server_name mxd-sop.5202345.xyz;

    location /.well-known/acme-challenge/ {
        root /opt/mxd-sop/frontend/dist;
        try_files $uri =404;
    }

    location / {
        return 301 https://$host$request_uri;
    }
}

server {
    listen 443 ssl;
    listen [::]:443 ssl;
    server_name mxd-sop.5202345.xyz;

    ssl_certificate /etc/letsencrypt/live/mxd-sop.5202345.xyz/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/mxd-sop.5202345.xyz/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;

    root /opt/mxd-sop/frontend/dist;
    index index.html;

    location /api/ {
        proxy_pass http://127.0.0.1:26902;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 30s;
    }

    location /health {
        proxy_pass http://127.0.0.1:26902;
        proxy_set_header Host $host;
    }

    location / {
        try_files $uri $uri/ /index.html;
    }
}
NGINX

sudo nginx -t
sudo systemctl reload nginx
```

## 9. 放行端口并验证

如果服务器启用了 UFW：

```bash
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw status
```

云服务器安全组也要放行 TCP `80` 和 `443`。不要放行 `26902`。

验证服务和网页：

```bash
sudo systemctl status mxd-sop --no-pager
curl -fsS http://127.0.0.1:26902/health
curl -fsS https://mxd-sop.5202345.xyz/health
curl -fsSI https://mxd-sop.5202345.xyz/
```

浏览器访问：

```text
https://mxd-sop.5202345.xyz
```

## 10. 配置每日 SQLite 备份

```bash
sudo chmod 750 /opt/mxd-sop/deploy/backup-sqlite.sh
sudo tee /etc/cron.d/mxd-sop-backup >/dev/null <<'CRON'
0 3 * * * root env DATABASE_PATH=/var/lib/mxd-sop/ops.sqlite /opt/mxd-sop/deploy/backup-sqlite.sh /var/backups/mxd-sop
CRON
sudo chmod 644 /etc/cron.d/mxd-sop-backup
```

## 11. 证书自动续期后重载 Nginx

```bash
sudo tee /etc/letsencrypt/renewal-hooks/deploy/mxd-sop-nginx.sh >/dev/null <<'HOOK'
#!/bin/sh
systemctl reload nginx
HOOK
sudo chmod 750 /etc/letsencrypt/renewal-hooks/deploy/mxd-sop-nginx.sh
sudo systemctl enable --now certbot.timer
sudo systemctl status certbot.timer --no-pager
sudo certbot renew --dry-run
```

`certbot renew --dry-run` 只做续期演练，不会更换当前证书。Certbot 定时器
会定期检查证书，证书进入续期窗口后自动续期；续期成功时会执行上面的
hook，自动 reload Nginx。

## 12. 后续升级

### 12.1 本地提交并推送更新

在开发机的项目根目录执行。`git add -u` 只会加入已跟踪文件的修改，
不会把本地数据库、操作记录或 `docs/data/` 下的资料带入提交；不要使用
`git add .`。

```bash
git add -u
# 如果本次新增了部署所需文件，再单独添加明确的路径：
git add <新增文件路径>
git diff --cached --name-only
git commit -m "描述本次更新"
git push origin main
```

### 12.2 服务器拉取并发布

```bash
sudo env DATABASE_PATH=/var/lib/mxd-sop/ops.sqlite \
  /opt/mxd-sop/deploy/backup-sqlite.sh /var/backups/mxd-sop

sudo systemctl stop mxd-sop
sudo -u mxd-sop git -C /opt/mxd-sop pull --ff-only
sudo -u mxd-sop bash -lc 'cd /opt/mxd-sop && npm ci && npm run test && npm run build && npm prune --omit=dev'
sudo systemctl start mxd-sop

curl -fsS http://127.0.0.1:26902/health
sudo systemctl status mxd-sop --no-pager
```

## 13. 502 Bad Gateway 排查

`502` 表示 Nginx 无法连接后端 `127.0.0.1:26902`。未登录请求正常应返回
`401`，不应返回 `502`。

按顺序执行：

```bash
sudo systemctl status mxd-sop --no-pager -l
sudo journalctl -u mxd-sop -n 100 --no-pager
sudo ss -ltnp | grep ':26902' || true
curl -v http://127.0.0.1:26902/health
sudo tail -n 100 /var/log/nginx/error.log
sudo nginx -T | grep -A8 -B3 'mxd-sop.5202345.xyz'
```

如果本机 `curl` 失败，问题在后端服务。常见原因是生产环境变量缺少
`INITIAL_ADMIN_PASSWORD`、数据库目录权限错误，或者 Node 路径不是
`/usr/bin/node`。查看非敏感配置：

```bash
sudo grep -E '^(NODE_ENV|HOST|PORT|DATABASE_PATH|COOKIE_SECURE)=' \
  /etc/mxd-sop/mxd-sop.env
```

如果本机 `curl` 成功但域名仍为 `502`，问题在 Nginx 配置；`mxd-sop` 的
`location /api/` 必须代理到 `http://127.0.0.1:26902`，修改后执行：

```bash
sudo nginx -t
sudo systemctl reload nginx
```
