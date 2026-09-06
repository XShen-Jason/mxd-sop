# 同机部署更新手册

本文是 `/opt/mxd-sop` 同一台服务器同时运行运营台和 `mxd-player` 时的长期更新流程。
两个服务共用 Git 仓库，但使用独立进程、端口和 SQLite 数据库。

不要再分别执行两份旧的“后续升级”命令。每次代码发布只执行本文第 3 节一次。
运营台部署文档的第 14 节和 player 部署文档的第 11 节是同一套流程的现场说明。

## 1. 本地提交并推送

在开发机项目根目录执行。不要使用 `git add .`，避免把数据库、令牌或本地运行文件提交到 Git。

```bash
git status --short
git diff --check
git add -u
# 本次首次打通功能的新增源码和文档需要显式加入：
git add backend/src/modules/player-directory backend/src/modules/player-integration \
  backend/src/modules/team-view backend/tests/player-directory.test.ts \
  backend/tests/player-integration.test.ts backend/tests/team-view.test.ts \
  docs/contracts/player-directory.md docs/contracts/player-integration.md \
  docs/contracts/team-view.md docs/modules/player-directory.md \
  docs/modules/player-integration.md docs/modules/team-view.md \
  frontend/src/modules/player-directory frontend/src/modules/player-integration \
  frontend/src/modules/team-view frontend/src/styles-player-directory.css \
  frontend/src/styles-player-integration.css frontend/src/styles-team-view.css \
  mxd-player/backend-player/cmd mxd-player/backend-player/internal \
  mxd-player/backend-player/.env.example mxd-player/frontend-player/src/features \
  mxd-player/frontend-player/src/styles-layout.css mxd-player/frontend-player/README.md \
  mxd-player/start-player.ps1 docs/DEPLOYMENT-UPDATE.md
git diff --cached --name-status
git diff --cached --check
git commit -m "更新 player 与运营台部署流程"
git push origin main
```

推送完成后，确认 GitHub 的 `main` 分支已经包含本次提交，再登录服务器。

## 2. 只修改令牌或环境变量

已有部署不要执行 `sudo cp /opt/mxd-sop/.env.example /etc/mxd-sop/mxd-sop.env`。
这会覆盖现有生产配置，可能改变数据库路径、Cookie 配置和初始化密码占位值。
代码不变时，不需要拉取仓库或重新构建；只备份并编辑已有 env 文件，两个配置文件必须使用同一个令牌。
令牌建议使用 `openssl rand -hex 32` 生成的 64 个十六进制字符；只替换等号后的值，不加引号。

`INITIAL_ADMIN_PASSWORD` 只在数据库的 `users` 表为空时用于创建第一个超级管理员。
已有用户和密码不会因为修改 env 或重启而改变；请保留现有值，不要用 `.env.example`
中的占位值覆盖它。如果初始密码已经按部署文档删除，也不要重新添加占位值。

```bash
(
set -eu
sudo -v
sudo cp -a /etc/mxd-sop/mxd-sop.env /etc/mxd-sop/mxd-sop.env.before-player-integration
sudo cp -a /etc/mxd-player/mxd-player.env /etc/mxd-player/mxd-player.env.before-player-integration
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

## 3. 代码更新（运营台 + mxd-player）

代码推送到 GitHub 后，在服务器 `/opt/mxd-sop` 执行下面整段命令。它只拉取一次代码，先备份两个数据库，构建和测试全部成功后才替换 player 二进制并重启服务。

```bash
(
set -eu
sudo -v
cd /opt/mxd-sop

if [ -n "$(sudo -u mxd-sop git status --porcelain)" ]; then
  echo '工作区有未提交修改，已停止；请先保存或提交后再更新' >&2
  exit 1
fi

sudo env DATABASE_PATH=/var/lib/mxd-sop/ops.sqlite \
  /opt/mxd-sop/deploy/backup-sqlite.sh /var/backups/mxd-sop
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

# 令牌通常不变；这里无输出确认两个 env 文件仍然一致。
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

## 4. 更新失败时

`set -eu` 会在第一处失败时停止，已经创建的数据库备份不会被删除。先查看服务日志，不要使用 `git reset --hard`：

```bash
sudo systemctl status mxd-player mxd-sop --no-pager -l
sudo journalctl -u mxd-player -n 100 --no-pager
sudo journalctl -u mxd-sop -n 100 --no-pager
sudo curl -v http://127.0.0.1:26906/health
sudo curl -v http://127.0.0.1:26902/health
sudo nginx -t
```

如果是 Git 工作区有未提交修改，先确认这些修改属于谁，再保存或提交后重新执行第 3 节。不要覆盖服务器上的 env 文件或 SQLite 数据库。

## 5. 相关部署文档

- [运营台部署文档](DEPLOYMENT-MXD-SOP-26901.md)
- [mxd-player 部署文档](../mxd-player/DEPLOYMENT.md)
