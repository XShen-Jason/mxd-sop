# mxd-auto-process：Ubuntu 24.04 从 GitHub 部署

本文按 [SOP 部署手册](DEPLOY-SOP-UBUNTU24.md) 的方式，在服务器上直接拉取
GitHub 仓库、构建 Auto、配置 systemd 与 Nginx。**不需要从 Windows 上传文件，
也不需要执行任何仓库部署脚本。** Auto 与 SOP 共用 /opt/mxd-sop 的 Git 源码，
但使用独立的进程、数据、配置和备份。以下步骤适用于同机首次部署，以及
保留已有数据的重新部署。跨服务器说明在最后。

生产服务只监听 127.0.0.1:26909，React 前端嵌入 Go 二进制；
6909 仅供 Vite 本地开发，不对外开放。上次终端出现残缺的 “)rintf...”
和孤立的 “)” 是长文本粘贴损坏。**每次只执行一个短命令块，成功后再执行下一块；**
失败时停在当前步骤，不要从头清库。

## 1. 前提和防断线终端

需要 Ubuntu 24.04、已按 SOP 手册部署的同机 /opt/mxd-sop 仓库与
/etc/mxd-sop/mxd-sop.env，其中应有 MXD_AUTO_SERVICE_TOKEN。
Auto 代码必须已经推送到 GitHub 的 origin/main。准备一个解析到本机的
真实 Auto 域名；公网只开放 80/443。用可 sudo 的账号 SSH 登录：

~~~bash
sudo apt update
sudo apt install -y tmux ca-certificates curl git nginx sqlite3 openssl certbot jq
tmux new -As mxd-auto-deploy
~~~

后续命令在 tmux 中运行。SSH 断线后重新登录，执行
tmux attach -t mxd-auto-deploy 接回原会话；按 Ctrl+B、再按 D 可主动离开。
若会话已结束，用 tmux new -As mxd-auto-deploy 新建后，从失败的小节继续。
不必把几个小节拼成一个巨大的 Bash 块。

先确认已有数据的位置，不要输出环境文件或密钥内容：

~~~bash
sudo systemctl status mxd-auto-process --no-pager -l || true
sudo journalctl -b -u mxd-auto-process -n 30 --no-pager
sudo ls -ld /var/lib/mxd-auto-process 2>/dev/null || true
sudo ls -l /var/lib/mxd-auto-process/auto.sqlite* 2>/dev/null || true
sudo ls -l /var/lib/mxd-auto-process/auto-credentials.key 2>/dev/null || true
~~~

首次部署时文件不存在是正常的。数据库 auto.sqlite 与
auto-credentials.key 必须作为一对保留；不要删除 SQLite 的 WAL/SHM 文件。
已有数据库但密钥丢失时先恢复配对备份，不要启动一个新空库。

## 2. 从 GitHub 拉取 Auto 源码

与 SOP 手册一致，在 /opt/mxd-sop 更新仓库。若工作区有已跟踪修改就停止，
按 SOP 文档处理，不自动清理或覆盖：

~~~bash
(
set -eu
test -d /opt/mxd-sop/.git
status=$(sudo -u mxd-sop git -c core.fileMode=false -C /opt/mxd-sop status --porcelain --untracked-files=no)
test -z "$status" || { printf 'Git 工作区有修改，先处理：\n%s\n' "$status" >&2; exit 1; }
sudo -u mxd-sop git -C /opt/mxd-sop pull --ff-only origin main
test -f /opt/mxd-sop/mxd-auto-process/backend-auto-process/go.mod
sudo -u mxd-sop git -C /opt/mxd-sop rev-parse HEAD
)
~~~

记下最后输出的提交号，与计划部署的 GitHub 提交核对。Git 拉取只更新源码；
本节不接触 Auto 数据库。若未先部署 SOP，请先完成 SOP 手册，取得同机服务令牌。

## 3. 工具链与生产目录

SOP 通常已有 Node.js 22；以下命令检查并按需安装：

~~~bash
(
set -euo pipefail
if ! command -v node >/dev/null 2>&1 ||
   ! dpkg --compare-versions "$(node -v | sed 's/^v//')" ge 22; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt install -y nodejs
fi
node --version
npm --version
node -e 'if (Number(process.versions.node.split(".")[0]) < 22) process.exit(1)'
)
~~~

Auto 的 Go 模块要求 Go 1.23。使用独立工具链，不替换系统 Go。
已有合格工具链时跳过下载；否则下载 Go 1.23.12 到新目录，
把旧工具链移入带时间戳的目录后切换：

~~~bash
(
set -eu
sudo test ! -L /opt/mxd-auto-process
sudo install -d -o root -g root -m 755 /opt/mxd-auto-process
goBin=/opt/mxd-auto-process/toolchain/bin/go
if ! sudo test -x "$goBin" ||
   ! dpkg --compare-versions "$(sudo "$goBin" env GOVERSION 2>/dev/null | sed 's/^go//')" ge 1.23; then
  arch=$(dpkg --print-architecture)
  case "$arch" in amd64|arm64) ;; *) echo "不支持的架构: $arch" >&2; exit 1;; esac
  archive=$(mktemp /var/tmp/mxd-auto-go.XXXXXXXX.tar.gz)
  curl -fL --retry 3 -o "$archive" "https://go.dev/dl/go1.23.12.linux-$arch.tar.gz"
  tar -tzf "$archive" >/dev/null
  newToolchain=$(sudo mktemp -d /opt/mxd-auto-process/toolchain.new.XXXXXXXX)
  sudo tar -xzf "$archive" --strip-components=1 -C "$newToolchain"
  sudo "$newToolchain/bin/go" version
  sudo chmod 755 "$newToolchain"
  if sudo test -e /opt/mxd-auto-process/toolchain; then
    sudo mv -T /opt/mxd-auto-process/toolchain "/opt/mxd-auto-process/toolchain.old.$(date -u +%Y%m%dT%H%M%S%N)"
  fi
  sudo mv -T "$newToolchain" /opt/mxd-auto-process/toolchain
  rm -f -- "$archive"
fi
sudo "$goBin" version
sudo -u mxd-sop test -x "$goBin"
)
~~~

上面的 Go 压缩包只写入临时路径及 Auto 专用目录。若下载中断，
重新执行本节；不要向正在运行的服务目录直接解压覆盖。

创建 Auto 用户及独立目录。install -d 不会清空已有目录：

~~~bash
(
set -eu
sudo test ! -L /var/lib/mxd-auto-process
id mxd-auto >/dev/null 2>&1 ||
  sudo useradd --system --home /var/lib/mxd-auto-process --shell /usr/sbin/nologin mxd-auto
sudo install -d -o root -g root -m 755 /opt/mxd-auto-process/bin
sudo install -d -o root -g root -m 755 /etc/mxd-auto-process
sudo install -d -o root -g root -m 700 /var/backups/mxd-auto-process
sudo install -d -o mxd-auto -g mxd-auto -m 700 /var/lib/mxd-auto-process
sudo install -d -o mxd-auto -g mxd-auto -m 700 /var/lib/mxd-auto-process/datacj
)
~~~

## 4. 配置服务器、密钥路径和服务令牌

servers.json 只在新库中用于首次导入；之后服务器目录以 Auto 页面保存的数据为准。
首次创建空目录，已有文件保持原样。需要初始游戏服务器时，可参考仓库中的
mxd-auto-process/backend-auto-process/config/servers.example.json 手工填写真实地址：

~~~bash
(
set -eu
servers=/etc/mxd-auto-process/servers.json
sudo test ! -L "$servers"
if ! sudo test -e "$servers"; then
  printf '{"servers":[]}\n' | sudo tee "$servers" >/dev/null
fi
sudo test -s "$servers"
sudo jq -e '.servers | type == "array"' "$servers" >/dev/null
sudo chown root:mxd-auto "$servers"
sudo chmod 640 "$servers"
)
~~~

检查旧环境里记录的数据路径，以及旧版默认数据目录。只要有路径不一致，
**本块就会停止**。此时先备份并迁移原数据库与配对密钥；
仅改环境变量会使旧账号看似消失：

~~~bash
(
set -eu
envFile=/etc/mxd-auto-process/mxd-auto-process.env
sudo test ! -L "$envFile"
oldDatabase=$(sudo sed -n 's/^AUTO_DATABASE_PATH=//p' "$envFile" 2>/dev/null || true)
oldKey=$(sudo sed -n 's/^AUTO_CREDENTIAL_KEY_PATH=//p' "$envFile" 2>/dev/null || true)
if { [ -n "$oldDatabase" ] && [ "$oldDatabase" != /var/lib/mxd-auto-process/auto.sqlite ]; } ||
   { [ -n "$oldKey" ] && [ "$oldKey" != /var/lib/mxd-auto-process/auto-credentials.key ]; }; then
  echo '旧环境文件指向其他数据路径；先迁移数据库与配对密钥' >&2
  exit 1
fi
for oldFile in /opt/mxd-auto-process/data/auto.sqlite /opt/mxd-auto-process/data/auto-credentials.key; do
  if sudo test -e "$oldFile"; then
    echo "旧数据仍位于 $oldFile；先迁移配对数据" >&2
    exit 1
  fi
done
)
~~~

只有环境文件不存在时才新建。已有文件应保留，并按下方校验；如果需要改域名、
令牌或数据路径，用 sudoedit 修改并先按第 6 节备份。初始密码仅对新库有效：

~~~bash
(
set -eu
envFile=/etc/mxd-auto-process/mxd-auto-process.env
sudo test ! -L "$envFile"
if ! sudo test -e "$envFile"; then
  read -rp 'Auto 真实域名: ' AUTO_DOMAIN
  printf '%s\n' "$AUTO_DOMAIN" | grep -Eq '^[A-Za-z0-9][A-Za-z0-9.-]*\.[A-Za-z]{2,}$'
  case "$AUTO_DOMAIN" in example.com|*.example.com) echo '不能使用示例域名' >&2; exit 1;; esac
  read -rsp 'Auto 初始管理员密码（至少 16 位英文字母和数字）: ' AUTO_PASSWORD
  printf '\n'
  printf '%s\n' "$AUTO_PASSWORD" | grep -Eq '^[A-Za-z0-9]{16,}$'
  AUTO_TOKEN=$(sudo sed -n 's/^MXD_AUTO_SERVICE_TOKEN=//p' /etc/mxd-sop/mxd-sop.env | head -n 1)
  printf '%s\n' "$AUTO_TOKEN" | grep -Eq '^[A-Za-z0-9_-]{16,}$'
  printf '%s\n' \
    'AUTO_DATABASE_PATH=/var/lib/mxd-auto-process/auto.sqlite' \
    'AUTO_CREDENTIAL_KEY_PATH=/var/lib/mxd-auto-process/auto-credentials.key' \
    "AUTO_INITIAL_PASSWORD=$AUTO_PASSWORD" \
    "AUTO_SERVICE_TOKEN=$AUTO_TOKEN" \
    'AUTO_COOKIE_SECURE=true' \
    "AUTO_DOMAIN=$AUTO_DOMAIN" | sudo tee "$envFile" >/dev/null
  unset AUTO_PASSWORD AUTO_TOKEN
fi
sudo chown root:root "$envFile"
sudo chmod 600 "$envFile"
)
~~~

运行无输出校验；失败时先用 sudoedit 检查，不要继续启动服务，
也不要把令牌或密码贴到聊天中：

~~~bash
sudo grep -qxF 'AUTO_DATABASE_PATH=/var/lib/mxd-auto-process/auto.sqlite' /etc/mxd-auto-process/mxd-auto-process.env
sudo grep -qxF 'AUTO_CREDENTIAL_KEY_PATH=/var/lib/mxd-auto-process/auto-credentials.key' /etc/mxd-auto-process/mxd-auto-process.env
sudo grep -qxF 'AUTO_COOKIE_SECURE=true' /etc/mxd-auto-process/mxd-auto-process.env
sudo sh -c 'sop=$(sed -n "s/^MXD_AUTO_SERVICE_TOKEN=//p" /etc/mxd-sop/mxd-sop.env); auto=$(sed -n "s/^AUTO_SERVICE_TOKEN=//p" /etc/mxd-auto-process/mxd-auto-process.env); test -n "$sop" && test "$sop" = "$auto"'
if ! sudo test -e /var/lib/mxd-auto-process/auto.sqlite; then
  sudo grep -Eq '^AUTO_INITIAL_PASSWORD=[A-Za-z0-9]{16,}$' /etc/mxd-auto-process/mxd-auto-process.env
fi
~~~

若有已授权的角色 opaque 抓包，可通过安全方式放到
/var/lib/mxd-auto-process/datacj/；不要放进 Git。第 6 节会把数据目录
调整为 mxd-auto 私有。没有所需抓包且游戏登录没有返回角色 opaque 时，
对应账号可能报 missing_role_opaque，此时需补齐合法来源。

## 5. 构建内嵌前端的 Go 程序

这些命令直接使用第 2 节从 GitHub 拉取的源码。
先构建前端；构建产物写入 Go 嵌入资源目录，不需要启动 Vite：

~~~bash
sudo -u mxd-sop bash -lc '
  set -eu
  cd /opt/mxd-sop/mxd-auto-process/frontend-auto-process
  npm ci
  npm run lint
  npm test
  npm run build
'
~~~

再测试并构建 Go。新程序先放在 .new，现有服务在切换前保持原状：

~~~bash
(
set -eu
buildRoot=$(mktemp -d /var/tmp/mxd-auto-build.XXXXXXXX)
sudo chown mxd-sop:mxd-sop "$buildRoot"
sudo -u mxd-sop env HOME=/opt/mxd-sop BUILD_ROOT="$buildRoot" bash -c '
  set -eu
  cd /opt/mxd-sop/mxd-auto-process/backend-auto-process
  /opt/mxd-auto-process/toolchain/bin/go mod download
  /opt/mxd-auto-process/toolchain/bin/go test ./...
  /opt/mxd-auto-process/toolchain/bin/go vet ./...
  /opt/mxd-auto-process/toolchain/bin/go build -trimpath -ldflags="-s -w" \
    -o "$BUILD_ROOT/mxd-auto-process.new" ./cmd/mxd-auto-process
'
sudo test -s "$buildRoot/mxd-auto-process.new"
sudo install -o root -g root -m 755 "$buildRoot/mxd-auto-process.new" /opt/mxd-auto-process/bin/mxd-auto-process.new
sudo rm -f -- "$buildRoot/mxd-auto-process.new"
sudo rmdir "$buildRoot"
)
~~~

测试失败时不要切换服务；检查 npm/Go 的第一条错误，修复后重跑本节。

## 6. 切换前备份并修复 SQLite 只读错误

**先执行完构建，再停止旧服务。** 下面命令停止 Auto，把已有配置和二进制
留在 root 私有快照中；如果有数据库，则使用 SQLite .backup 制作一致性快照，
验证数据库并配对保存 32 字节的密钥。任何校验失败都应停止，不能清库。
备份目录会打印出来，记下位置：

~~~bash
(
set -eu
sudo systemctl stop mxd-auto-process 2>/dev/null || true
if sudo systemctl is-active --quiet mxd-auto-process; then
  echo '旧服务未停止，不能备份或切换' >&2
  exit 1
fi
target=$(sudo mktemp -d /var/backups/mxd-auto-process/predeploy-XXXXXXXX)
for file in /etc/mxd-auto-process/mxd-auto-process.env /etc/mxd-auto-process/servers.json \
  /etc/systemd/system/mxd-auto-process.service /etc/nginx/sites-available/mxd-auto.conf \
  /opt/mxd-auto-process/bin/mxd-auto-process; do
  if sudo test -f "$file"; then
    sudo install -o root -g root -m 600 "$file" "$target/$(basename "$file")"
  fi
done
database=/var/lib/mxd-auto-process/auto.sqlite
key=/var/lib/mxd-auto-process/auto-credentials.key
sudo test ! -L "$database"
sudo test ! -L "$key"
if sudo test -e "$database"; then
  sudo test -f "$database"
  sudo test -f "$key"
  test "$(sudo stat -c %s "$key")" -eq 32
  sudo sqlite3 "$database" ".backup '$target/auto.sqlite'"
  test "$(sudo sqlite3 "$target/auto.sqlite" 'PRAGMA quick_check;')" = ok
  sudo install -o root -g root -m 600 "$key" "$target/auto-credentials.key"
elif sudo test -e "$key"; then
  test "$(sudo stat -c %s "$key")" -eq 32
fi
printf '切换前备份：%s\n' "$target"
)
~~~

上次的 “attempt to write a readonly database (8)” 通常是数据目录、
auto.sqlite 或 WAL/SHM 由 root 拥有。**备份成功后**再修正权限；
这一步不删除数据库或密钥：

~~~bash
(
set -eu
sudo test ! -L /var/lib/mxd-auto-process
sudo chown -R mxd-auto:mxd-auto /var/lib/mxd-auto-process
sudo find /var/lib/mxd-auto-process -type d -exec chmod 700 {} +
sudo find /var/lib/mxd-auto-process -type f -exec chmod 600 {} +
sudo -u mxd-auto test -w /var/lib/mxd-auto-process
sudo -u mxd-auto test -w /var/lib/mxd-auto-process/datacj
for file in auto.sqlite auto.sqlite-wal auto.sqlite-shm; do
  path=/var/lib/mxd-auto-process/$file
  if sudo test -e "$path"; then sudo -u mxd-auto test -w "$path"; fi
done
)
~~~

若旧环境文件指向 /opt/mxd-auto-process/data/ 等其他路径，
或旧库缺少配对密钥，不要运行本节的切换；先从旧位置/备份迁移一对文件，
并校验 SQLite quick_check。仅有健康接口不能证明旧密钥能解密所有账号。

## 7. systemd 启动与检查

创建与 SOP 文档同风格的服务单元。原单元已在第 6 节留快照：

~~~bash
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
sudo chmod 644 /etc/systemd/system/mxd-auto-process.service
sudo systemctl daemon-reload
sudo systemd-analyze verify /etc/systemd/system/mxd-auto-process.service
~~~

仅当上一步成功后切换已测试的二进制，然后启动：

~~~bash
(
set -eu
sudo test -x /opt/mxd-auto-process/bin/mxd-auto-process.new
sudo mv -f /opt/mxd-auto-process/bin/mxd-auto-process.new /opt/mxd-auto-process/bin/mxd-auto-process
sudo systemctl reset-failed mxd-auto-process || true
sudo systemctl enable mxd-auto-process
sudo systemctl restart mxd-auto-process
healthy=0
for attempt in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
  if sudo systemctl is-active --quiet mxd-auto-process &&
     curl -fsS --max-time 2 http://127.0.0.1:26909/api/v1/healthz; then
    healthy=1
    break
  fi
  sleep 1
done
if [ "$healthy" -ne 1 ]; then
  sudo systemctl status mxd-auto-process --no-pager -l || true
  sudo journalctl -b -u mxd-auto-process -n 60 --no-pager
  exit 1
fi
sudo test -s /var/lib/mxd-auto-process/auto.sqlite
test "$(sudo stat -c %s /var/lib/mxd-auto-process/auto-credentials.key)" -eq 32
)
~~~

若失败，不要删除数据库。查看本节输出和
sudo namei -l /var/lib/mxd-auto-process/auto.sqlite；
确认父目录可遍历、数据库和 WAL/SHM 可由 mxd-auto 写，再重跑第 6～7 节。
重复启动不会重设已有管理员密码。

## 8. Nginx 与 HTTPS

域名必须指向本机，80/443 已放行。先取环境文件中的域名，检查 Nginx；
已有同名站点须确认属于 Auto。第 6 节已对现有站点留快照：

~~~bash
(
set -eu
AUTO_DOMAIN=$(sudo sed -n 's/^AUTO_DOMAIN=//p' /etc/mxd-auto-process/mxd-auto-process.env)
printf '%s\n' "$AUTO_DOMAIN" | grep -Eq '^[A-Za-z0-9][A-Za-z0-9.-]*\.[A-Za-z]{2,}$'
getent ahosts "$AUTO_DOMAIN" >/dev/null
sudo nginx -t
site=/etc/nginx/sites-available/mxd-auto.conf
enabled=/etc/nginx/sites-enabled/mxd-auto.conf
sudo test ! -L "$site"
if sudo test -e "$site"; then
  sudo grep -Fq "server_name $AUTO_DOMAIN;" "$site" || { echo '同名站点属于其他域名' >&2; exit 1; }
fi
if sudo test -e "$enabled" || sudo test -L "$enabled"; then
  test "$(sudo readlink -f "$enabled")" = "$site" || { echo '同名启用文件属于其他站点' >&2; exit 1; }
fi
if sudo nginx -T 2>/dev/null | awk -v host="$AUTO_DOMAIN" -v own="$enabled" '
  /^# configuration file / { file=$4; sub(/:$/, "", file) }
  file != own && $1 == "server_name" {
    for (i=2; i<=NF; i++) { name=$i; sub(/;$/, "", name); if (tolower(name) == tolower(host)) found=1 }
  }
  END { exit !found }
'; then
  echo '该域名已被另一个 Nginx 站点使用' >&2
  exit 1
fi
sudo install -d -o root -g root -m 755 /var/www/html
)
~~~

先创建只负责 ACME 验证的 HTTP 站点。此块较短，复制后等 Nginx 检查通过
再运行下一块：

~~~bash
AUTO_DOMAIN=$(sudo sed -n 's/^AUTO_DOMAIN=//p' /etc/mxd-auto-process/mxd-auto-process.env)
sudo tee /etc/nginx/sites-available/mxd-auto.conf >/dev/null <<NGINX
# Managed by MXDCMD Ubuntu 24 Auto guide
server {
    listen 80;
    listen [::]:80;
    server_name $AUTO_DOMAIN;
    location /.well-known/acme-challenge/ { root /var/www/html; try_files \$uri =404; }
    location / { return 301 https://\$host\$request_uri; }
}
NGINX
sudo ln -sfn /etc/nginx/sites-available/mxd-auto.conf /etc/nginx/sites-enabled/mxd-auto.conf
sudo nginx -t
sudo systemctl enable --now nginx
sudo systemctl reload nginx
~~~

输入真实邮箱申请/复用 Let’s Encrypt 证书：

~~~bash
AUTO_DOMAIN=$(sudo sed -n 's/^AUTO_DOMAIN=//p' /etc/mxd-auto-process/mxd-auto-process.env)
read -rp 'Let’s Encrypt 邮箱: ' ACME_EMAIL
sudo certbot certonly --webroot --non-interactive --agree-tos \
  --email "$ACME_EMAIL" --keep-until-expiring \
  -w /var/www/html -d "$AUTO_DOMAIN"
~~~

证书成功后写 HTTPS 反代；它只指向本机 26909，不指向 Vite 6909：

~~~bash
AUTO_DOMAIN=$(sudo sed -n 's/^AUTO_DOMAIN=//p' /etc/mxd-auto-process/mxd-auto-process.env)
sudo tee /etc/nginx/sites-available/mxd-auto.conf >/dev/null <<NGINX
# Managed by MXDCMD Ubuntu 24 Auto guide
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
~~~

打开 https://实际Auto域名/operator，用 admin 和首次部署的初始密码登录并
立即修改；根路径 / 是只读监控页。旧数据库使用旧管理员密码。
同机 SOP 的 MXD_AUTO_LOCAL_URL 应为 http://127.0.0.1:26909，
MXD_AUTO_SERVICE_TOKEN 要与 Auto 一致；在 SOP 页面验证 Auto 联通和
一个已有账号连接。健康接口不能证明旧加密凭据一定可用。

## 9. SQLite 与密钥的日常备份

下面创建的是**日常备份命令**，不是部署脚本。它把 SQLite 的一致性快照、
配对密钥及配置写入 root 私有目录；失败的中间目录以 .incomplete 开头，
不会冒充完成的备份。不要只备份 auto.sqlite：

~~~bash
sudo tee /usr/local/sbin/mxd-auto-backup >/dev/null <<'BACKUP'
#!/bin/sh
set -eu
database=/var/lib/mxd-auto-process/auto.sqlite
key=/var/lib/mxd-auto-process/auto-credentials.key
test -f "$database"
test -f "$key"
test "$(wc -c < "$key")" -eq 32
umask 077
install -d -o root -g root -m 700 /var/backups/mxd-auto-process
target=$(mktemp -d /var/backups/mxd-auto-process/.incomplete-XXXXXXXX)
sqlite3 "$database" ".backup '$target/auto.sqlite'"
test "$(sqlite3 "$target/auto.sqlite" 'PRAGMA quick_check;')" = ok
install -o root -g root -m 600 "$key" "$target/auto-credentials.key"
install -o root -g root -m 600 /etc/mxd-auto-process/mxd-auto-process.env "$target/mxd-auto-process.env"
install -o root -g root -m 600 /etc/mxd-auto-process/servers.json "$target/servers.json"
ready=/var/backups/mxd-auto-process/auto-$(date -u +%Y%m%dT%H%M%SZ)-$(basename "$target")
mv -T "$target" "$ready"
printf '备份已创建：%s\n' "$ready"
BACKUP
sudo sh -n /usr/local/sbin/mxd-auto-backup
sudo chown root:root /usr/local/sbin/mxd-auto-backup
sudo chmod 750 /usr/local/sbin/mxd-auto-backup
sudo /usr/local/sbin/mxd-auto-backup
~~~

每天服务器本地时间 03:00 备份一次；不自动删除旧备份。
另将备份目录纳入加密异机备份：

~~~bash
sudo tee /etc/cron.d/mxd-auto-backup >/dev/null <<'CRON'
0 3 * * * root /usr/local/sbin/mxd-auto-backup
CRON
sudo chmod 644 /etc/cron.d/mxd-auto-backup
~~~

## 10. 升级、故障恢复与跨服务器

后续升级先运行 sudo /usr/local/sbin/mxd-auto-backup，再重复第 2 节的
Git pull、第 5 节的构建、第 6 节的切换前备份/权限和第 7 节的启动检查。
域名没变时不必重新申请证书。若 Git pull 提示工作区有修改，
按 SOP 手册处理，不要直接 git reset --hard。

| 现象 | 处理 |
| --- | --- |
| SSH 断开 | 重新登录，用 tmux attach -t mxd-auto-deploy 接回 |
| 终端出现残缺 Bash 行 | 停止该块，重新输入该小节；不要接着执行后续小节 |
| SQLite readonly (8) | 先做第 6 节备份，再修复数据目录及 WAL/SHM 权限 |
| 缺密钥或旧数据路径 | 从同一次备份恢复数据库和密钥；不要空库覆盖旧库 |
| 本机健康正常、HTTPS 失败 | 查 DNS、80/443、certbot 和 sudo nginx -t |
| HTTPS 正常、SOP 不通 | 查 SOP 的 Auto URL、两端令牌和 SOP 连接状态 |

如需恢复备份，先停止服务，把当前 auto.sqlite、-wal、-shm、-journal
及 auto-credentials.key 移入单独的 root 私有隔离目录；从同一份
/var/backups/mxd-auto-process/auto-*/ 备份安装 SQLite 和密钥，
归属设为 mxd-auto、权限设为 0600，确认 quick_check 后再启动。
没有可用的数据库/密钥配对备份，旧账号加密凭据无法推算。
**只有明确放弃旧账号时**，才把整个 /var/lib/mxd-auto-process
移入隔离目录，重做第 3～7 节；不要直接删除数据目录。

跨服务器部署不能原样执行前面依赖本机 SOP 仓库和令牌文件的步骤；
需要在 Auto 主机独立克隆同一 GitHub 仓库，并安全配置相同的服务令牌。
SOP 的 MXD_AUTO_LOCAL_URL 改为受保护的 Auto HTTPS 地址，
两端令牌保持相同，并在反代/VPN/私网限制只允许 SOP 主机访问。
Auto 仍只监听其本机 127.0.0.1:26909；不要公开 26909 或 6909。
