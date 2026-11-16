# SOP 登录输入账号记录

生产默认在 `DATABASE_PATH` 所在目录写入 `login-attempts.log`。
HK-MXD 对应 `/var/lib/mxd-sop/login-attempts.log`，现有 systemd 的 ReadWritePaths 已允许
此目录，不需要开放新目录、修改 Nginx 或增加数据库字段。日志由 `mxd-sop` 创建，权限 0600。

```bash
sudo tail -n 50 /var/lib/mxd-sop/login-attempts.log
sudo tail -F /var/lib/mxd-sop/login-attempts.log
```

第一条显示最近记录，第二条持续跟随文件（按 Ctrl+C 结束）。首个登录请求完成前文件可能
尚不存在。每行是一个 JSON 对象，账号字段是 `username`，IP 为可信转发链归一后的 `ip`，
`time` 为 UTC，`status` / `result` 为响应结果。提交了错误密码或不存在账号也会记录。
账号不做 trim/大小写变换；超过 128 个 UTF-16 单元只保留前段并标记 `truncated`。
字段及所有状态的权威定义见 [auth.login-audit](../contracts/auth.md#authlogin-audit)。

不会记录密码、Cookie、令牌、请求正文、响应正文或查询字符串。该输入账号是未验证声明，
不能据此判断攻击者身份、账户存在或登录已成功。换行和控制字符使用 JSON 转义。
被后端提前限流/封禁的请求只记录 IP 和结果，账号为 null；Nginx 提前拒绝的请求只存在
于原有 `/var/log/nginx/mxd-security.log`，本日志无法补取未读取的账号。

文件达到 5 MiB 前轮转为 `.1`，旧归档依次成为 `.2` 至 `.4`，只保留当前文件及四份归档，
总预算 25 MiB。`.1` 是最新归档；重启会继续追加现有文件。无需额外 logrotate 配置，
不要同时让另一轮转程序操作这些文件。历史请求不回填。

磁盘满或权限错误不会改变原登录结果；使用下面命令查日志写入诊断：

```bash
sudo journalctl -u mxd-sop --since today --no-pager | grep auth.login.audit_error
```

修复目录/磁盘问题后下一次请求会重新尝试写入。记录不与认证事务原子提交，异常退出时
不能把日志缺失当作“没有发生登录”。更新脚本不会删除或回滚此运行时文件。
