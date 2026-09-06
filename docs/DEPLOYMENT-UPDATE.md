# MXDCMD 同机部署更新手册

本文适用于运营台（mxd-sop）和玩家项目（mxd-player）已经部署在同一台
Debian 服务器的情况。

固定路径和服务：

- Git 仓库根目录：/opt/mxd-sop。这里包含完整的 MXDCMD 仓库和
  mxd-player 子项目；不要把两个项目拆成两个仓库上传。
- 运营台服务：mxd-sop，本机端口 26902，数据库
  /var/lib/mxd-sop/ops.sqlite。
- 玩家服务：mxd-player，本机端口 26906，数据库
  /var/lib/mxd-player/player.sqlite。
- 运营台配置：/etc/mxd-sop/mxd-sop.env。
- 玩家配置：/etc/mxd-player/mxd-player.env。

每次代码发布都先把完整 MXDCMD Git 仓库推送到 origin/main，再在服务器
执行下面其中一个“只更新”流程。服务器只执行 git pull，不通过 SCP 覆盖
生产目录；env 文件和 SQLite 数据库始终位于仓库外，不会被代码更新覆盖。

## 本地 SSH 连接

只在本机新开的 PowerShell 窗口执行。输入 IP 后，OpenSSH 会在隐藏的密码提示
中读取 root 密码；不要把密码写入命令、脚本或聊天。SSH 端口固定为 22。

~~~powershell
$serverIp = Read-Host "服务器 IP"
ssh -p 22 root@$serverIp
~~~

## 0. 本地推送完整仓库

在 Windows 开发机的仓库根目录执行。gitignore 已排除 .env、SQLite、
node_modules 和构建目录；提交前仍要检查暂存文件列表，确认没有令牌或数据
库。

~~~powershell
Set-Location C:\Users\22734\Desktop\PROJECTS\MXDCMD
git status --short
git diff --check
git add -A
git diff --cached --name-status
git diff --cached --check
$forbidden = git diff --cached --name-only | Where-Object {
  (($_ -match '(^|/)\.env($|\.)') -and ($_ -notmatch '(^|/)\.env\.example$')) -or
  ($_ -match '\.(sqlite|sqlite-wal|sqlite-shm|db)$') -or
  ($_ -match '(^|/)(node_modules|dist|build|coverage)/')
}
if ($forbidden) { throw "暂存区包含禁止上传的配置、数据库或构建文件：$forbidden" }
git commit -m "描述本次更新"
git push origin main
~~~

确认 GitHub 的 main 已包含提交后，再登录服务器。不要把令牌写入源码、
提交信息或命令参数；本地配置文件只用于本地运行。

## 1. 设置令牌

只改令牌或其他生产环境变量时，不要拉取仓库，也不要运行构建。两个配置文件
中的服务令牌必须完全相同：运营台使用 MXD_PLAYER_SERVICE_TOKEN，玩家服务
使用 PLAYER_SERVICE_TOKEN。只编辑等号右侧，不加引号。

~~~bash
(
set -eu
sudo -v
sudo cp -a /etc/mxd-sop/mxd-sop.env \
  /etc/mxd-sop/mxd-sop.env.before-token-change
sudo cp -a /etc/mxd-player/mxd-player.env \
  /etc/mxd-player/mxd-player.env.before-token-change
sudoedit /etc/mxd-sop/mxd-sop.env
sudoedit /etc/mxd-player/mxd-player.env

# 只检查是否一致，不输出令牌内容。
sudo sh -c '
  set -eu
  ops=$(sed -n "s/^MXD_PLAYER_SERVICE_TOKEN=//p" /etc/mxd-sop/mxd-sop.env | head -n1)
  player=$(sed -n "s/^PLAYER_SERVICE_TOKEN=//p" /etc/mxd-player/mxd-player.env | head -n1)
  test -n "$ops" && test "$ops" = "$player"
  case "$ops" in replace-with-*|*" "*) echo "令牌为空、仍是占位值或包含空格" >&2; exit 1;; esac
'
sudo chmod 600 /etc/mxd-sop/mxd-sop.env /etc/mxd-player/mxd-player.env
sudo systemctl daemon-reload
sudo systemctl restart mxd-player mxd-sop
sudo systemctl is-active --quiet mxd-player
sudo systemctl is-active --quiet mxd-sop
for url in http://127.0.0.1:26906/health http://127.0.0.1:26902/health; do
  ok=0
  for attempt in $(seq 1 15); do
    if curl -fsS "$url"; then ok=1; printf '\n'; break; fi
    sleep 1
  done
  test "$ok" -eq 1
done
)
~~~

推荐令牌来源：在服务器上运行 openssl rand -hex 32，再把同一个 64 位
十六进制值分别写入两个 env 文件。不要把命令输出粘贴到聊天或 Git。

## 2. 只更新 SOP 项目

这段命令会拉取完整 MXDCMD 仓库，但只安装依赖、测试、构建并重启运营台。
不会构建或重启 mxd-player，也不会触碰玩家数据库。

core.fileMode=false 只用于忽略服务器上备份脚本的执行权限差异；任何内容
修改都会停止流程。--package-lock=false 防止服务器 npm 版本把生成的元数据
写回 Git 工作区。

~~~bash
(
set -eu
sudo -v
cd /opt/mxd-sop

status=$(sudo -u mxd-sop git -c core.fileMode=false status --porcelain)
if [ -n "$status" ]; then
  echo '服务器工作区有未提交的内容修改，已停止：' >&2
  printf '%s\n' "$status" >&2
  exit 1
fi

env DATABASE_PATH=/var/lib/mxd-sop/ops.sqlite \
  sh /opt/mxd-sop/deploy/backup-sqlite.sh /var/backups/mxd-sop
sudo -u mxd-sop git -c core.fileMode=false pull --ff-only origin main

sudo -u mxd-sop bash -lc '
  set -eu
  cd /opt/mxd-sop
  npm ci --package-lock=false
  npm test
  npm run lint
  npm run build
  npm prune --omit=dev
'

sudo systemctl restart mxd-sop
sudo systemctl is-active --quiet mxd-sop
ok=0
for attempt in $(seq 1 15); do
  if curl -fsS http://127.0.0.1:26902/health; then ok=1; printf '\n'; break; fi
  sleep 1
done
test "$ok" -eq 1
sudo nginx -t
sudo systemctl reload nginx
curl -fsS --max-time 20 https://mxd-sop.5202345.xyz/health
)
~~~

完成后确认 mxd-player 仍为 active。如果运营台健康检查失败，先查看
sudo journalctl -u mxd-sop -n 100 --no-pager，不要删除数据库或使用
git reset --hard。

## 3. 只更新 player 项目

这段命令同样拉取完整 MXDCMD 仓库，但只构建和重启玩家前端/后端。运营台
进程和数据库不会被停止或写入。

~~~bash
(
set -eu
sudo -v
cd /opt/mxd-sop

status=$(sudo -u mxd-sop git -c core.fileMode=false status --porcelain)
if [ -n "$status" ]; then
  echo '服务器工作区有未提交的内容修改，已停止：' >&2
  printf '%s\n' "$status" >&2
  exit 1
fi

sudo /usr/local/sbin/mxd-player-backup
sudo -u mxd-sop git -c core.fileMode=false pull --ff-only origin main

sudo -u mxd-sop bash -lc '
  set -eu
  cd /opt/mxd-sop/mxd-player/frontend-player
  if [ -f package-lock.json ]; then npm ci --package-lock=false; else npm install --no-package-lock; fi
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
  "$GO_BIN" build -trimpath -ldflags="-s -w" \
    -o /opt/mxd-player/bin/mxd-player.new ./cmd/mxd-player
'
sudo mv /opt/mxd-player/bin/mxd-player.new /opt/mxd-player/bin/mxd-player
sudo chown mxd-sop:mxd-sop /opt/mxd-player/bin/mxd-player
sudo chmod 755 /opt/mxd-player/bin/mxd-player

sudo systemctl restart mxd-player
sudo systemctl is-active --quiet mxd-player
ok=0
for attempt in $(seq 1 15); do
  if curl -fsS http://127.0.0.1:26906/health; then ok=1; printf '\n'; break; fi
  sleep 1
done
test "$ok" -eq 1
sudo nginx -t
sudo systemctl reload nginx
curl -fsS --max-time 20 https://mxd-teams.5202345.xyz/health
)
~~~

## 4. 更新失败排查

先确认两个服务和端口，不要覆盖 env 或 SQLite：

~~~bash
sudo systemctl status mxd-sop mxd-player --no-pager -l
sudo journalctl -u mxd-sop -n 100 --no-pager
sudo journalctl -u mxd-player -n 100 --no-pager
sudo ss -ltnp | grep -E ':26902\b|:26906\b' || true
curl -v http://127.0.0.1:26902/health
curl -v http://127.0.0.1:26906/health
sudo nginx -t
~~~

如果 Git 状态只有服务器工具生成的缓存或意外的锁文件，先保存差异再处理，
不要直接清空工作区：

~~~bash
sudo install -d -o mxd-sop -g mxd-sop -m 700 /var/backups/mxd-sop
sudo -u mxd-sop git -C /opt/mxd-sop diff \
  > /var/backups/mxd-sop/worktree-before-update.patch
sudo -u mxd-sop git -C /opt/mxd-sop status --short
~~~

确认没有业务内容修改后，再重新执行对应的“只更新”流程。若两个项目都要
更新，先执行第 2 节，再执行第 3 节；每一节仍然只重启自己的服务，两个备份
文件也必须都成功生成。
