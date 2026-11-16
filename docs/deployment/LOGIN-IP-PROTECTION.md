# SOP 与 auto 登录 IP 防护发布

本次用户要求：SOP 与 auto 都拒绝 IPv6，IPv4 保留 5 分钟 10 次请求、第 5 次失败锁定
20 分钟，并在累计第 21 次实际凭据失败后永久封禁。两个服务各自计数，互不访问数据库。
完整规则分别由 [auth](../contracts/auth.md) 和
[operator-api.v1](../../mxd-auto-process/backend-auto-process/contracts/operator-api-v1.yaml) 定义。
累计从安装新版本起开始；历史内存状态及 Nginx 日志不迁移成累计失败。

## 实际边界

- Nginx 拒绝两个站点的 IPv6 页面/资源/API，覆盖 CF 原始 IPv6 和 Pseudo IPv4 情况。
- 后端按可信真实地址拒绝 IPv6；IPv4 映射 IPv6 归一到 IPv4。永久封禁拒绝所有新业务
  请求，即使有正确密码、现有 cookie 或服务令牌。已开始的操作/SSE 不强制终止。
- SOP 的公开静态登录壳由 Nginx 提供，永久封禁不阻止下载该壳，但所有业务 API 都拒绝。
  auto 的嵌入静态资源也由其后端封禁入口保护。
- 持久计数只存 IP 和累计失败数，最多 100000 地址，饱和 21。成功、等待和重启不清除。
  临时内存计数重启清零；永久记录依赖原 SQLite 数据文件，删除/还原数据库会改变它。
- SSH、Fail2ban、防火墙、player、系统 IPv6 配置不修改。

## 联合更新

使用 `deploy/update-login-security.py <完整提交号>`，不要再用仅更新 SOP 的旧脚本部署本次变更。
服务器需先抓取 origin/main，然后从目标提交的 `deploy/` 归档运行脚本（避免先改变运行中的源码）。
它要求已有 HK-MXD 安装及干净 main 工作区，核对现有 Nginx 片段与旧提交一致后才继续。
不自动 stash，也不强制 reset；未知修改或部署路径差异会在切换前停止。

若旧测试留下未跟踪的 `.local/share/vitest/.vitest-secret-token`，新版预检只兼容
这个确切普通文件：目标提交必须有精确忽略规则且没有跟踪该 token。文件保留原位，
不读取/打印/上传内容，不 stash 或删除；快进后由新 `.gitignore` 接管。其他 `.local/`
文件、符号链接、已暂存或已跟踪修改仍会停止。后续 auto 的 npm 命令设置
`XDG_DATA_HOME=<临时构建目录>/user-data`，Vitest token 不再落入服务器仓库。

当前 Debian 部署以 [同机更新手册](../DEPLOYMENT-UPDATE.md) 第 4 节为准：
Go 从 `/opt/mxd-auto-process/toolchain.env` 的 `GO_BIN` 读取，不要求固定安装路径。
脚本只解析一个字面量绝对路径，不执行该配置中的 shell 内容；以 `mxd-sop` 检查可执行性
及目标提交 `go.mod` 所需版本，再把同一个编译器传给构建。仅当该配置文件不存在时，
兼容另一份 Ubuntu 手册使用的 `/opt/mxd-auto-process/toolchain/bin/go`。
配置存在但无效时停止，不换用其他工具链，也不自动下载或改写系统 Go。
Debian 初次部署的 env 不含 `AUTO_DOMAIN`，公网检查默认使用手册中的
`mxd-auto-process.5202345.xyz`；已有显式 `AUTO_DOMAIN` 时仍使用它。

Auto 从目标提交导出到 `/var/tmp/mxd-auto-security-*` 后，依次构建前端和 Go；
嵌入资源、依赖和 Go 缓存都留在该临时目录，不向服务器仓库回写构建资产。
`GOTOOLCHAIN=local` 保证检测和构建使用同一编译器，不隐式下载其他版本。
二进制明确输出为临时根目录的 `mxd-auto-process.new`；`mxd-auto-process/` 是导出的
源码目录，不能作为 `go build -o` 的文件名，否则 Go 会把二进制放到该目录内部。

脚本在 `/var/backups/mxd-sop/security-release-*` 保存 SOP 源码版本、构建产物、数据库快照、
Nginx 片段以及 auto 的旧二进制、数据库快照、配置和密钥。目录 root 专有，证据不进入业务表。
前端依赖、SOP 测试/类型检查/构建、auto 前端测试/构建、Go 测试/vet/构建和隔离 Nginx
测试均通过后，才原子替换 auto 可执行文件并重启 auto、SOP、reload Nginx。
auto 重启会短暂断开游戏连接，后续按现有启用/自动恢复配置处理；脚本不主动发送游戏指令。

线上用保留地址和随机不存在的用户名验证两个服务的请求上限、第 5 次锁定、失败计数确实
写入各自数据库，以及 IPv6 403。每次挑选没有历史计数的保留地址，避免重复发布把探测误判
为已经永久封禁。永久第 21 次、跨重启与并发场景在隔离数据库回归测试中验证，线上不修改
真实账号、伪造计数或等待 80 分钟测试。保留地址的真实失败记录按同一策略正常保留。

本机验证失败恢复旧运行产物和 Nginx 片段，不还原数据库或密钥，不覆盖上线期间业务写入。
新增计数表是兼容的附加表；旧程序不执行永久规则，因此回退后必须处理错误再重新上线。
Git 可能已前进而产物已回退，不能仅用 Git HEAD 判断运行版本。备份和 stash 不删除。

这种失败状态重试时，显式传入失败输出中的备份目录：
`python3 <归档目录>/deploy/update-login-security.py <新提交> --resume-backup /var/backups/mxd-sop/security-release-...`。
脚本要求该目录为固定备份根下的真实目录、`target-head` 等于服务器当前 Git HEAD，
且当前 Nginx 片段同时等于备份快照和备份记录的 Git 版本。任一不符仍停止，不允许借
重试覆盖人工配置。旧备份使用 `before-head` 作为配置来源；新备份另外保存
`nginx-source-head`，使连续失败重试也能保留真正的配置版本。此参数只选择核验基准，
不会恢复旧数据库/密钥或回退 Git；核验通过后照常新建备份、构建并切换。

若失败发布的备份已不存在，但安装的三个 Nginx 片段均能逐项匹配同一个历史提交，
可以显式传入 `--config-source-commit <40位完整历史提交号>`，与 `--resume-backup` 互斥。
这用于源码已前进、配置未切换且原备份缺失的恢复场景，不代表旧运行产物已匹配该提交。
脚本要求该提交是当前服务器 HEAD 的祖先，并逐项校验全部已安装片段；不自动搜索或选择
历史版本，不接受短提交号、分支名或人工配置差异。默认流程仍要求配置等于当前 HEAD。
通过后正常备份现有运行产物、数据库和片段，记录 `nginx-source-head`，再构建和切换；
失败时只回到本次新备份的运行产物，不伪造旧备份，也不恢复数据库或密钥。

公网检查用 `curl --ipv4` 明确验证允许的地址族，保留 TLS 证书校验；失败不回滚已通过本机
验证的服务，结果以 `joint-deployed.json` 和实际错误为准。
最终成功标识：`LOGIN_SECURITY_DEPLOYMENT_OK`。它不证明完整游戏流程或承载能力。

## 人工查看与解封

在服务器仓库目录执行，示例 IP 应替换为确切目标。默认仅查看；显式 `--clear` 才删除
该服务下该 IPv4 的累计记录，不修改其他 IP、会话、账号或 SSH。输出可保存为库外操作记录。

```bash
sudo python3 deploy/ip-ban-admin.py sop 192.0.2.10
sudo python3 deploy/ip-ban-admin.py sop 192.0.2.10 --clear
sudo python3 deploy/ip-ban-admin.py auto 192.0.2.10 --clear
```

永久表无缓存，删除后下一次请求立即重新检查；残留临时 20 分钟锁仍需到期。
IPv6 由全局策略拒绝，不能用单个 IP 解封命令放行。
