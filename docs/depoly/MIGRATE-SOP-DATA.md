# 用 SQL 文件将 SOP 数据从旧服务器迁到新服务器

旧服务器用 SQLite 的 `.dump` 生成 `sop.sql`，把文件传到新服务器后用
`sqlite3 < sop.sql` 导入。SQL 包含全部 SOP 账号（含原系统超管）、密码摘要、权限、
待完成及常规操作记录、活动配置和它们的关联。旧登录会话及旧服务器的 player/auto
连接开关会在导出快照中清空；新服务器使用自己的环境配置。`mxd-player` 和
`mxd-auto-process` 的独立数据库不在本流程中。SOP 库内的玩家目录和组队视图
也会一并保留。

运行时道具目录是数据库外的 `item-catalog.csv`，必须随 SQL 文件一起传输；
否则已配置活动和历史记录中的道具可能无法正确对应。以下命令只处理 SOP。
SQL 文件含账号密码摘要及业务数据，文件和接收目录均限制为 root 可读。

新服务器须先按 [SOP 部署文档](DEPLOY-SOP-UBUNTU24.md)完成首次启动。
导入只接受目标库中**仅有一个初始超管、没有业务数据**的情况；如果新服务器
已有正式账号或记录，命令会停止，不能直接用整库 SQL 合并。
不要对正在使用的 `/var/lib/mxd-sop/ops.sqlite` 直接执行 `sqlite3 < sop.sql`：
目标库已有表和初始超管，会产生冲突。下方命令先导入空的临时库，再备份并替换。
以下每段 Linux 命令都在相应服务器的 **root SSH 终端**执行。

## 1. 新服务器：准备接收目录

```bash
install -d -o root -g root -m 700 /var/tmp/mxd-sop-sql-incoming
```

## 2. 旧服务器：导出 SQL 和道具目录

复制整段执行。它读取 `mxd-sop` 实际使用的环境文件中的 `DATABASE_PATH`，
停止旧 SOP 后对数据库做一致性快照，所以未合并的 WAL 数据也会进入 SQL。
成功后旧 SOP 保持停止，避免两台服务器同时接收新记录。若导出失败，原本
正在运行的旧 SOP 会尝试重新启动。

```bash
(
set -eu
umask 077
env_file=/etc/mxd-sop/mxd-sop.env
systemctl cat mxd-sop >/dev/null
systemctl show mxd-sop --property=EnvironmentFiles --value | grep -Fq "$env_file"
db=$(sed -n 's/^DATABASE_PATH=//p' "$env_file" | tail -n 1)
case "$db" in /*) ;; *) echo 'DATABASE_PATH 必须是绝对路径' >&2; exit 1;; esac
catalog=$(sed -n 's/^ITEM_CATALOG_PATH=//p' "$env_file" | tail -n 1)
if [ -z "$catalog" ]; then catalog=$(dirname "$db")/item-catalog.csv; fi
case "$catalog" in *.csv) ;; *) echo '运行时道具目录不是 CSV，请先核对实际配置' >&2; exit 1;; esac
test -f "$db" && test -f "$catalog"
test "$(sqlite3 -batch "$db" 'PRAGMA integrity_check;')" = ok
out=/var/tmp/mxd-sop-sql-export
install -d -o root -g root -m 700 "$out"
was_active=0
if systemctl is-active --quiet mxd-sop; then was_active=1; fi
work=
cleanup() {
  rc=$?
  trap - EXIT
  if [ -n "$work" ]; then
    rm -f "$work/ops.sqlite" "$work/ops.sqlite-wal" "$work/ops.sqlite-shm" \
      "$work/ops.sqlite-journal" "$work/sop.sql" "$work/item-catalog.csv"
    rmdir "$work" 2>/dev/null || true
  fi
  if [ "$rc" -ne 0 ] && [ "$was_active" -eq 1 ]; then systemctl start mxd-sop || true; fi
  exit "$rc"
}
trap cleanup EXIT
printf '正在导出数据库：%s\n' "$db"
systemctl stop mxd-sop
work=$(mktemp -d "$out/work.XXXXXX")
snapshot=$work/ops.sqlite
sqlite3 "$db" ".backup '$snapshot'"
for table in sessions player_integration_state auto_integration_state; do
  if [ "$(sqlite3 -batch "$snapshot" "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='$table';")" = 1 ]; then
    sqlite3 -batch -bail "$snapshot" "DELETE FROM $table;"
  fi
done
test "$(sqlite3 -batch "$snapshot" 'PRAGMA integrity_check;')" = ok
test -z "$(sqlite3 -batch "$snapshot" 'PRAGMA foreign_key_check;')"
test "$(sqlite3 -batch "$snapshot" "SELECT COUNT(*) FROM users WHERE role='super_admin' AND active=1;")" -ge 1
sqlite3 -batch -bail "$snapshot" '.dump' > "$work/sop.sql"
sqlite3 -batch -bail :memory: < "$work/sop.sql"
cp -- "$catalog" "$work/item-catalog.csv"
chmod 600 "$work/sop.sql" "$work/item-catalog.csv"
mv -f "$work/sop.sql" "$out/sop.sql"
mv -f "$work/item-catalog.csv" "$out/item-catalog.csv"
(cd "$out" && sha256sum sop.sql item-catalog.csv > SHA256SUMS)
chmod 600 "$out/SHA256SUMS"
printf '导出完成：%s/sop.sql 和 %s/item-catalog.csv\n' "$out" "$out"
sqlite3 -batch "$snapshot" "
SELECT 'users=' || COUNT(*) FROM users;
SELECT 'operation_groups=' || COUNT(*) FROM operation_groups;
SELECT 'activities=' || COUNT(*) FROM activities;
"
)
```

如果旧服务的环境文件不在 `/etc/mxd-sop/mxd-sop.env`，先按
`systemctl cat mxd-sop` 显示的 `EnvironmentFile` 路径修改上面的 `env_file` 一行。
导出完成后只需传输 `sop.sql`、`item-catalog.csv`、`SHA256SUMS` 三个文件。

## 3. 传输三个文件

在**旧服务器**执行以下命令，输入新服务器 IP。第一次连接时核对新服务器的
SSH 主机指纹；如需查看指纹，可在新服务器运行
`ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub`。

```bash
(
set -eu
printf '新服务器 IP: '; read -r NEW_IP
test -n "$NEW_IP"
scp -p /var/tmp/mxd-sop-sql-export/sop.sql \
  /var/tmp/mxd-sop-sql-export/item-catalog.csv \
  /var/tmp/mxd-sop-sql-export/SHA256SUMS \
  "root@$NEW_IP:/var/tmp/mxd-sop-sql-incoming/"
)
```

也可以用 SFTP 把这三个文件从旧服务器下载到本机，再上传到新服务器的
`/var/tmp/mxd-sop-sql-incoming/`。请保持文件名不变，传完删除本机副本。
不建议把大段 SQL 复制粘贴进终端：容易截断，也会暴露账号和业务数据。

## 4. 新服务器：执行 SQL 导入

复制整段执行。它先校验三个文件，将 SQL 导入临时数据库并检查完整性；确认
目标库仍为空后才停止新 SOP，备份目标原文件、安装迁移数据并启动服务。
启动失败会尝试恢复原文件；目标的 `/etc/mxd-sop/mxd-sop.env` 不会被覆盖。

```bash
(
set -eu
umask 077
incoming=/var/tmp/mxd-sop-sql-incoming
data_dir=/var/lib/mxd-sop
db=$data_dir/ops.sqlite
catalog=$data_dir/item-catalog.csv
systemctl cat mxd-sop >/dev/null
id mxd-sop >/dev/null
test -f "$incoming/sop.sql" && test -f "$incoming/item-catalog.csv"
(cd "$incoming" && sha256sum -c SHA256SUMS)
test -f "$db"
test "$(sed -n 's/^DATABASE_PATH=//p' /etc/mxd-sop/mxd-sop.env | tail -n 1)" = "$db"
configured_catalog=$(sed -n 's/^ITEM_CATALOG_PATH=//p' /etc/mxd-sop/mxd-sop.env | tail -n 1)
test -z "$configured_catalog" || test "$configured_catalog" = "$catalog"
check_target() {
  state=$(sqlite3 -batch "$db" "
SELECT (SELECT COUNT(*) FROM users),
       (SELECT COUNT(*) FROM users WHERE role='super_admin' AND active=1 AND created_by_json IS NULL),
       (SELECT COUNT(*) FROM operation_groups),
       (SELECT COUNT(*) FROM activities),
       (SELECT COUNT(*) FROM player_directory),
       (SELECT COUNT(*) FROM team_view_clears),
       (SELECT COUNT(*) FROM team_view_snapshots),
       (SELECT COUNT(*) FROM player_integration_state),
       (SELECT COUNT(*) FROM auto_integration_state);
")
  test "$state" = '1|1|0|0|0|0|0|0|0' || { echo "目标库已有数据：$state" >&2; return 1; }
}
check_target
stage=$(mktemp "$data_dir/ops.import.XXXXXX.sqlite")
backup_dir=; stopped=0; swapped=0; was_active=0
if systemctl is-active --quiet mxd-sop; then was_active=1; fi
finish() {
  rc=$?
  trap - EXIT
  if [ "$rc" -ne 0 ] && [ "$stopped" -eq 1 ]; then
    systemctl stop mxd-sop >/dev/null 2>&1 || true
    if ! systemctl is-active --quiet mxd-sop; then
      if [ "$swapped" -eq 1 ]; then
        for name in ops.sqlite ops.sqlite-wal ops.sqlite-shm item-catalog.csv; do
          if [ -e "$data_dir/$name" ]; then mv "$data_dir/$name" "$backup_dir/failed-$name" || true; fi
          if [ -e "$backup_dir/original-$name" ]; then mv "$backup_dir/original-$name" "$data_dir/$name" || true; fi
        done
      fi
      if [ "$was_active" -eq 1 ]; then systemctl start mxd-sop || true; fi
    fi
    printf '导入失败；已尝试恢复。检查备份目录：%s\n' "$backup_dir" >&2
  fi
  rm -f "$stage" "$stage-wal" "$stage-shm" "$stage-journal"
  exit "$rc"
}
trap finish EXIT
sqlite3 -batch -bail "$stage" < "$incoming/sop.sql"
test "$(sqlite3 -batch "$stage" 'PRAGMA integrity_check;')" = ok
test -z "$(sqlite3 -batch "$stage" 'PRAGMA foreign_key_check;')"
test "$(sqlite3 -batch "$stage" "SELECT COUNT(*) FROM users WHERE role='super_admin' AND active=1;")" -ge 1
for table in sessions player_integration_state auto_integration_state; do
  if [ "$(sqlite3 -batch "$stage" "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='$table';")" = 1 ]; then
    test "$(sqlite3 -batch "$stage" "SELECT COUNT(*) FROM $table;")" = 0
  fi
done
systemctl stop mxd-sop
stopped=1
check_target
install -d -o root -g root -m 700 /var/backups/mxd-sop
backup_dir=$(mktemp -d /var/backups/mxd-sop/pre-sql-migration.XXXXXX)
sqlite3 "$db" ".backup '$backup_dir/ops.snapshot.sqlite'"
swapped=1
for name in ops.sqlite ops.sqlite-wal ops.sqlite-shm item-catalog.csv; do
  if [ -e "$data_dir/$name" ]; then mv "$data_dir/$name" "$backup_dir/original-$name"; fi
done
install -o mxd-sop -g mxd-sop -m 600 "$stage" "$db"
install -o mxd-sop -g mxd-sop -m 600 "$incoming/item-catalog.csv" "$catalog"
systemctl start mxd-sop
healthy=0
for attempt in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
  if systemctl is-active --quiet mxd-sop && curl -fsS http://127.0.0.1:26902/health >/dev/null 2>&1; then healthy=1; break; fi
  sleep 1
done
test "$healthy" = 1
printf '迁移成功；旧目标库备份：%s\n' "$backup_dir"
sqlite3 -batch "$db" "
SELECT 'users=' || COUNT(*) FROM users;
SELECT 'operation_groups=' || COUNT(*) FROM operation_groups;
SELECT 'activities=' || COUNT(*) FROM activities;
"
)
```

用**旧服务器原有账号和密码**登录新 SOP，核对待完成记录、常规操作记录与活动。
如果导入失败并决定暂时放弃迁移，可在**旧服务器**执行
`systemctl start mxd-sop` 恢复旧站；旧站一旦新增数据，后续必须重新导出 SQL。
迁移成功后不要再让旧 SOP 接收写入，否则两边数据会分叉。
