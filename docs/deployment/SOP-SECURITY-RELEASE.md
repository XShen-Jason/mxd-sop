# SOP 安全规则发布与旧源码对齐

用于 HK-MXD 的 `/opt/mxd-sop`，最初处理 `476b904` 加直接部署安全补丁的工作区。
用户确认保留现有 SSH 防护，不调整 SSH、Fail2ban、防火墙、Docker 或 Tailscale。
本次只切换 SOP 后端和前端构建产物，并更新三个已有 Nginx 安全片段；auto/player
源码随仓库同步，但其二进制和进程不会更新，不把 Git 同步称为它们运行版本已经升级。

## 脚本边界

`deploy/update-sop-security.py` 必须由 root 运行，参数为已抓取的完整 `origin/main` 提交号。
它使用现有 `mxd-sop` 账号访问 GitHub、安装依赖、测试和构建，不需要提供新凭据。

1. 检查分支、快进关系、SOP 工作目录/启动路径、服务状态、Nginx 配置及已安装片段。
2. 只接受用户报告的十个源码路径；内容必须等于目标提交，或是有确定 SHA-256 的旧版
   登录限制实现。未知修改、暂存修改、删除、重命名和符号链接都会在任何覆盖前停止。
3. 在 `/var/backups/mxd-sop/security-release-*` 保存旧源码补丁/文件、构建产物、
   Nginx 片段、SQLite 一致性快照和上传目录表。该目录 root 专有，不进入业务数据库。
4. 把确认过的旧源码保存在 Git stash，记录 stash ID，然后快进到固定提交。
   这是对通用更新手册“脏工作区停止”规则的限定例外，不使用 `git reset --hard`，不丢弃 stash。
5. 显式安装开发依赖、运行测试/类型检查/构建和隔离 Nginx 回归；构建目录原地生成，
   失败恢复原构建产物。依赖锁文件不改写，构建失败不重启 SOP。
6. 更新三个 Nginx 片段并检查配置；重启 SOP，验证健康和真实 HTTP 登录边界，再重载 Nginx。
   切换失败时恢复旧构建产物和片段，必要时重启旧 SOP；不回滚业务数据库。
7. 核对部署配置 SHA-256、目标提交、SOP PID 及未变化的 auto/player PID，保存
   `deployed.json`；最后检查公网健康。公网失败不自动撤回已通过本机验证的部署。

登录探测使用保留测试 IP 和随机不存在的账号，不接触真实用户密码/会话，不发送游戏指令。
成功行是 `SOP_DEPLOYMENT_OK`。健康和登录验证不代表完整游戏流程已测试。

若已输出 `deployed.json` 对应的提交/配置摘要和 `LOGIN_LIMIT_OK`，仅在最后公网检查失败，
则 SOP 和 Nginx 已更新且未回滚。`4dc8aa4` 的旧脚本遇到非 JSON 响应会报
`JSONDecodeError`；这不能判断具体 HTTP 状态，也不能据此认定 Cloudflare 拦截或服务宕机。
本次本地复核发现：普通 curl 和项目探测标识返回 200 JSON；同一 curl 使用
`Python-urllib/3.13` 标识时返回 403。具体边缘规则尚未从管理端确认。
新脚本使用明确的 `User-Agent: mxd-sop-release-check/1.0` 和 `Accept: application/json`，
并报告 HTTP 状态、Content-Type、Server、CF-Ray 和 CF-Mitigated，不输出响应正文。
公网检查失败仍返回非零退出码，不把失败当作成功；不重跑整个发布即可独立检查：

```bash
python3 deploy/update-sop-security.py --check-public-health
```

该模式只发送一次公网 GET，不需要 root，不修改 Git、数据、配置或进程。

若脚本因内容差异停止，保留输出中指出的文件并核对，不强制清空工作区。若在构建后失败，
Git 可能已前进而运行产物已恢复旧版；此时以备份和错误为准，不能宣称版本一致。
重试前确认没有新增服务端修改，修复实际错误后重新执行；原备份和 stash 保留。

## 本地验证

```bash
python3 deploy/tests/sop-release.test.py
python3 deploy/tests/cloudflare-realip.test.py
```

前者通过临时 Git 仓库验证安全对齐、旧文件保留、未知修改拒绝和仅构建产物回滚；
后者在隔离 Nginx 中验证可信 IP 与登录限流。线上最终结果须由执行输出确认。
