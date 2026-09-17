# mxd-auto-process Debian 同机首次部署

本文用于把 `mxd-auto-process` 首次部署到现有 MXDCMD 服务器。它与客服后台
共用 `/opt/mxd-sop` Git 仓库，但使用独立进程、配置、SQLite 数据库和备份目录。

固定拓扑：

- 公网地址：`https://mxd-auto-process.5202345.xyz`
- 本机监听：`127.0.0.1:26909`
- 前端开发/临时预览：`127.0.0.1:6909`（仅回环，不开放防火墙或安全组）
- systemd 服务：`mxd-auto-process`
- 数据库：`/var/lib/mxd-auto-process/auto.sqlite`
- 凭据加密密钥：`/var/lib/mxd-auto-process/auto-credentials.key`
- 可选角色 opaque 资料：`/var/lib/mxd-auto-process/datacj/`
- 环境文件：`/etc/mxd-auto-process/mxd-auto-process.env`
- 服务器初始配置：`/etc/mxd-auto-process/servers.json`
- 程序：`/opt/mxd-auto-process/bin/mxd-auto-process`

开始前，把 DNS A/AAAA 记录指向客服后台所在服务器，并确认包含 auto 项目的
提交已经推送到 `origin/main`。不要上传本地的 SQLite、`auto-credentials.key`、
`.env` 或抓包文件。首次部署期间先启动 auto，最后再按
[DEPLOYMENT-UPDATE.md](DEPLOYMENT-UPDATE.md) 第 2 节更新 SOP，避免 SOP 在 auto
尚未运行时接收自动执行请求。生产环境不运行一个对外监听的 Vite 前端：前端
先构建为 Go 嵌入资源，由 26909 上的 auto 进程提供；6909 只用于本机开发或临时
预览，并且必须绑定 `127.0.0.1`。Nginx 生产站点应反代到
`127.0.0.1:26909`，不要把 `6909` 写入公网反代或安全组规则。

## 1. 检查服务器和工具链

下面假定客服后台和 player 已按现有文档部署。auto 与 player 都要求 Go 1.23
或更高版本，因此复用 `/opt/mxd-player/toolchain.env`，不会替换系统 Go。前端
构建要求 Node.js 20.19 或更高版本，建议使用 Node.js 22 LTS。

~~~bash
(
set -eu
sudo -v
sudo apt update
sudo apt install -y ca-certificates curl sqlite3 certbot
cd /opt/mxd-sop
status=$(sudo -u mxd-sop git -c core.fileMode=false status --porcelain)
if [ -n "$status" ]; then
  echo '服务器工作区有未提交的内容修改，已停止：' >&2
  printf '%s\n' "$status" >&2
  exit 1
fi
sudo -u mxd-sop git -c core.fileMode=false pull --ff-only origin main

test -f /opt/mxd-player/toolchain.env
. /opt/mxd-player/toolchain.env
test -x "$GO_BIN"
goVersion=$("$GO_BIN" env GOVERSION | sed 's/^go//')
dpkg --compare-versions "$goVersion" ge 1.23

nodeVersion=$(node --version | sed 's/^v//')
dpkg --compare-versions "$nodeVersion" ge 20.19
node --version
npm --version
"$GO_BIN" version
sqlite3 --version
sudo nginx -t
sudo ss -ltnp | grep -E ':26909\b' || true
if sudo ss -ltnp | grep -E ':6909\b' | grep -v '127\.0\.0\.1:6909'; then
  echo '6909 必须只绑定 127.0.0.1，不能监听公网地址' >&2
  exit 1
fi
)
~~~

如果服务器没有 player 的工具链文件，先安装 Go 1.23 或更高版本，并在
`/opt/mxd-player/toolchain.env` 写入一行绝对路径（不要把 Go 路径写进服务命令）：

~~~text
GO_BIN=/实际路径/go
~~~

## 2. 创建用户和生产目录

~~~bash
(
set -eu
id mxd-auto >/dev/null 2>&1 || \
  sudo useradd --system --home /var/lib/mxd-auto-process \
    --shell /usr/sbin/nologin mxd-auto

sudo install -d -o root -g root -m 755 /opt/mxd-auto-process
sudo install -d -o root -g root -m 755 /opt/mxd-auto-process/bin
sudo install -d -o mxd-auto -g mxd-auto -m 700 /var/lib/mxd-auto-process
sudo install -d -o mxd-auto -g mxd-auto -m 700 /var/lib/mxd-auto-process/datacj
sudo install -d -o root -g root -m 755 /etc/mxd-auto-process
sudo install -d -o root -g root -m 700 /var/backups/mxd-auto-process
sudo install -d -o mxd-sop -g mxd-sop -m 700 /home/mxd-sop

sudo cp /opt/mxd-player/toolchain.env /opt/mxd-auto-process/toolchain.env
sudo chown root:root /opt/mxd-auto-process/toolchain.env
sudo chmod 644 /opt/mxd-auto-process/toolchain.env
)
~~~

## 3. 创建运行配置

先创建 auto 的服务器引导文件。它只在新数据库中导入一次；数据库创建后，
网页中的服务器配置是权威数据，继续修改此 JSON 不会覆盖数据库。

~~~bash
sudo cp /opt/mxd-sop/mxd-auto-process/backend-auto-process/config/servers.example.json \
  /etc/mxd-auto-process/servers.json
sudo chown root:mxd-auto /etc/mxd-auto-process/servers.json
sudo chmod 640 /etc/mxd-auto-process/servers.json
sudoedit /etc/mxd-auto-process/servers.json
~~~

生成两个不同的随机值：一个作为 auto 管理员初始密码，一个作为 SOP 与 auto
之间的服务令牌。不要把输出写入 Git、命令历史或聊天。

~~~bash
openssl rand -hex 32
openssl rand -hex 32
~~~

创建环境文件：

~~~bash
sudo install -o root -g root -m 600 /dev/null \
  /etc/mxd-auto-process/mxd-auto-process.env
sudoedit /etc/mxd-auto-process/mxd-auto-process.env
~~~

填写以下内容，替换两个占位值：

~~~env
AUTO_DATABASE_PATH=/var/lib/mxd-auto-process/auto.sqlite
AUTO_CREDENTIAL_KEY_PATH=/var/lib/mxd-auto-process/auto-credentials.key
AUTO_INITIAL_PASSWORD=替换为第一个随机值
AUTO_SERVICE_TOKEN=替换为第二个随机值
AUTO_COOKIE_SECURE=true
~~~

然后编辑客服后台配置，加入同机地址和同一个服务令牌：

~~~bash
sudo cp -a /etc/mxd-sop/mxd-sop.env \
  /etc/mxd-sop/mxd-sop.env.before-auto-deployment
sudoedit /etc/mxd-sop/mxd-sop.env
~~~

~~~env
MXD_AUTO_LOCAL_URL=http://127.0.0.1:26909
MXD_AUTO_SERVICE_TOKEN=替换为上面相同的第二个随机值
MXD_AUTO_TIMEOUT_MS=10000
~~~

无输出校验两个令牌一致：

~~~bash
sudo sh -c '
  set -eu
  ops=$(sed -n "s/^MXD_AUTO_SERVICE_TOKEN=//p" /etc/mxd-sop/mxd-sop.env | head -n1)
  auto=$(sed -n "s/^AUTO_SERVICE_TOKEN=//p" /etc/mxd-auto-process/mxd-auto-process.env | head -n1)
  test -n "$ops" && test "$ops" = "$auto"
  case "$ops" in local-auto-service-token|replace-with-*|*" "*) exit 1;; esac
'
~~~

如果登录响应本身不包含角色 opaque，角色选择会从上述 `datacj` 目录读取
成功的 `op=6` 资料。需要此兼容来源时，只通过受控的安全传输把已授权的 `.pcap`
文件放入该目录，并保持运行用户可读；不要将抓包文件加入 Git 或备份：

~~~bash
sudo chown -R mxd-auto:mxd-auto /var/lib/mxd-auto-process/datacj
sudo find /var/lib/mxd-auto-process/datacj -type f -name '*.pcap' -exec chmod 600 {} +
~~~

如果服务器端没有这些资料，而游戏登录响应也不提供 opaque，新增账号会返回
`missing_role_opaque`；这表示需要补充受控的成功捕获或使用能返回角色 opaque
的登录流程，不应把 opaque 写入配置文件。

## 4. 在临时目录测试并构建

前端产物会嵌入 Go 二进制。6909 不参与生产对外服务；如需在服务器上临时预览，
另开终端运行 `cd /opt/mxd-sop/mxd-auto-process/frontend-auto-process && npm run dev -- --host 127.0.0.1 --port 6909`，
并在结束后停止 Vite。命令从当前 Git 提交导出临时源码后构建，不会把
生成文件写回 `/opt/mxd-sop`，因此服务器工作区在构建后仍保持干净。

~~~bash
(
set -eu
sudo -v
cd /opt/mxd-sop

buildRoot=$(mktemp -d /var/tmp/mxd-auto-build.XXXXXX)
cleanup() {
  case "$buildRoot" in
    /var/tmp/mxd-auto-build.*) sudo rm -rf -- "$buildRoot" ;;
  esac
}
trap cleanup EXIT
sudo chown mxd-sop:mxd-sop "$buildRoot"

sudo -u mxd-sop git archive --format=tar HEAD mxd-auto-process | \
  sudo -u mxd-sop tar -xf - -C "$buildRoot"

sudo -u mxd-sop env HOME=/home/mxd-sop bash -lc '
  set -eu
  buildRoot=$1
  . /opt/mxd-auto-process/toolchain.env

  cd "$buildRoot/mxd-auto-process/frontend-auto-process"
  npm ci
  npm run lint
  npm test
  npm run build

  cd "$buildRoot/mxd-auto-process/backend-auto-process"
  "$GO_BIN" mod download
  "$GO_BIN" test ./...
  "$GO_BIN" vet ./...
  "$GO_BIN" build -trimpath -ldflags="-s -w" \
    -o "$buildRoot/mxd-auto-process.new" ./cmd/mxd-auto-process
' sh "$buildRoot"

sudo install -o mxd-auto -g mxd-auto -m 755 \
  "$buildRoot/mxd-auto-process.new" \
  /opt/mxd-auto-process/bin/mxd-auto-process
)
~~~

## 5. 创建备份命令

数据库中的账号密码依赖 `auto-credentials.key` 解密，所以两者必须一起备份。

~~~bash
sudo tee /usr/local/sbin/mxd-auto-backup >/dev/null <<'SCRIPT'
#!/bin/sh
set -eu

database=/var/lib/mxd-auto-process/auto.sqlite
key=/var/lib/mxd-auto-process/auto-credentials.key
backup_dir=/var/backups/mxd-auto-process
timestamp=$(date -u +%Y%m%dT%H%M%SZ)
target=$backup_dir/$timestamp

test -f "$database"
test -f "$key"
install -d -o root -g root -m 700 "$target"
sqlite3 "$database" ".backup '$target/auto.sqlite'"
install -o root -g root -m 600 "$key" "$target/auto-credentials.key"
install -o root -g root -m 600 \
  /etc/mxd-auto-process/mxd-auto-process.env "$target/mxd-auto-process.env"
install -o root -g root -m 600 \
  /etc/mxd-auto-process/servers.json "$target/servers.json"
echo "Created $target"
SCRIPT
sudo chown root:root /usr/local/sbin/mxd-auto-backup
sudo chmod 750 /usr/local/sbin/mxd-auto-backup
~~~

备份目录含数据库解密密钥和服务令牌，只允许 root 读取。将该目录纳入服务器
的加密异机备份；仅备份 `auto.sqlite` 无法恢复已保存的游戏账号密码。

## 6. 创建并启动 systemd 服务

~~~bash
sudo tee /etc/systemd/system/mxd-auto-process.service >/dev/null <<'SERVICE'
[Unit]
Description=MXD auto process
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
sudo /usr/local/sbin/mxd-auto-backup
~~~

## 7. 配置 Nginx 和 HTTPS

先创建 HTTP 站点供 ACME 验证。不要修改客服后台现有站点。

~~~bash
sudo install -d -o www-data -g www-data -m 755 /var/www/certbot
sudo tee /etc/nginx/sites-available/mxd-auto-process.conf >/dev/null <<'NGINX'
server {
    listen 80;
    listen [::]:80;
    server_name mxd-auto-process.5202345.xyz;

    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
        try_files $uri =404;
    }

    location / {
        return 301 https://$host$request_uri;
    }
}
NGINX
sudo ln -sfn /etc/nginx/sites-available/mxd-auto-process.conf \
  /etc/nginx/sites-enabled/mxd-auto-process.conf
sudo nginx -t
sudo systemctl reload nginx
~~~

确认 DNS 已生效，再把邮箱替换为真实地址并申请证书：

~~~bash
sudo certbot certonly --webroot \
  -w /var/www/certbot \
  -d mxd-auto-process.5202345.xyz \
  --email YOUR_EMAIL@example.com \
  --agree-tos \
  --no-eff-email
~~~

写入最终站点。`proxy_buffering off` 用于 auto 的 SSE 监控流。

~~~bash
sudo tee /etc/nginx/sites-available/mxd-auto-process.conf >/dev/null <<'NGINX'
server {
    listen 80;
    listen [::]:80;
    server_name mxd-auto-process.5202345.xyz;

    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
        try_files $uri =404;
    }

    location / {
        return 301 https://$host$request_uri;
    }
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name mxd-auto-process.5202345.xyz;

    ssl_certificate /etc/letsencrypt/live/mxd-auto-process.5202345.xyz/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/mxd-auto-process.5202345.xyz/privkey.pem;

    client_max_body_size 64k;

    location / {
        proxy_pass http://127.0.0.1:26909;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_buffering off;
        proxy_read_timeout 300s;
    }
}
NGINX

sudo nginx -t
sudo systemctl reload nginx
curl -fsS https://mxd-auto-process.5202345.xyz/api/v1/healthz
~~~

## 8. 更新 SOP 并验收

auto 健康检查成功后，执行 [DEPLOYMENT-UPDATE.md](DEPLOYMENT-UPDATE.md) 第 2 节
“只更新 SOP 项目”。该流程会备份并迁移 SOP 数据库、测试和构建新增集成代码，
然后重启客服后台以加载第 3 节写入的环境变量。第 2 节成功后再执行：

~~~bash
(
set -eu
sudo systemctl is-active --quiet mxd-sop
curl -fsS http://127.0.0.1:26902/health
curl -fsS http://127.0.0.1:26909/api/v1/healthz
curl -fsS https://mxd-auto-process.5202345.xyz/api/v1/healthz
sudo ss -ltnp | grep -E ':26902\b|:26909\b'
)
~~~

打开 `https://mxd-auto-process.5202345.xyz/`，使用 `admin` 和
`AUTO_INITIAL_PASSWORD` 登录并按要求立即修改密码。然后在客服后台的
“服务器管理”工作区确认 auto 为可用状态，再配置服务器和游戏账号。

保留 `AUTO_INITIAL_PASSWORD` 为强随机值；如果数据库需要从备份重建，启动时
不会退回到默认密码。环境文件及其备份只允许 root 读取。

出现问题时先查看：

~~~bash
sudo systemctl status mxd-auto-process --no-pager -l
sudo journalctl -u mxd-auto-process -n 100 --no-pager
sudo nginx -t
curl -v http://127.0.0.1:26909/api/v1/healthz
~~~

后续发布不要重复本手册，使用 [DEPLOYMENT-UPDATE.md](DEPLOYMENT-UPDATE.md)
中的“只更新 auto 项目”。
