# HK-MXD 安全加固记录（2026-11-15）

本记录时间统一为北京时间 UTC+8。范围是 Tabby 的 HK-MXD 上的 SOP 与 auto 入口、
SOP 认证边界，以及仓库内 auto 的认证初始化。证据、部署备份留在服务器文件系统，
没有将调查记录、物理路径或来源写入业务数据库。本文件不含密码、令牌或会话值。

本文阈值和验证结果为当次上线的历史快照。之后仓库已调整 SOP 登录规则，当前定义见
[auth 契约](../contracts/auth.md)，前置限流更新见
[Cloudflare 登录来源说明](cloudflare-login-ip.md)。本记录不证明后续规则已经部署。

## 已确认的事实与限制

- SSH 的 root 授权文件有 3 把不同的 ED25519 公钥；用户已确认这些密钥和所询问的
  成功登录来源正常。本次没有删除密钥、修改 SSH 配置或踢出现有 SSH 连接。
- 调查时当天记录约 30,860 次 SOP 登录 401、680 次 SSH 密码失败；这些是截至调查
  快照的尝试次数，不能据此认定入侵成功。SSH 的 fail2ban 保护已在运行。
- 首次汇总发现 11 次 SOP 成功登录；加固后仍有正常形态的成功登录。旧 Nginx 日志只保存
  Cloudflare 节点地址，不能追溯这些请求的真实访客 IP，也不能断言所有成功登录均获授权。
- 调查时 64 次 auto HTTP 自动执行请求全部能按 execution_id 对应到 SOP 工单。
  没有发现脱离工单的自动执行请求；这不证明每个发起人的凭据都没有泄露。
- `auto-process` 是 SOP 内部自动执行/审计身份，不是可登录的后台账户。
  其字符串本身不能认证。真实游戏账户 `autoprocess` 与该审计身份是不同概念。
- 另有 20:38:58 一次、21:17:05 / 07 / 11 三次成功删除用户请求，及 19:34 的
  superadmin 登录，已单独请用户确认。不能用 SSH 来源已获确认来替代这项核验。

## 已上线的保护

### Nginx：仅 SOP 和 auto 的 HTTPS 站点

| 仓库配置 | 服务器安装位置 | 用途 |
| --- | --- | --- |
| `deploy/security/mxd-login-guard.conf` | `/etc/nginx/conf.d/mxd-login-guard.conf` | HTTP 作用域限流区、登录地址映射、安全日志格式 |
| `deploy/security/mxd-login-server.conf` | `/etc/nginx/snippets/mxd-login-server.conf` | 两个 HTTPS server 的限流与日志 |
| `deploy/security/mxd-cloudflare-realip.conf` | `/etc/nginx/snippets/mxd-cloudflare-realip.conf` | 只信任官方 Cloudflare 网段提供的访客 IP |

两个站点的 HTTPS `server` 各包含后两个 snippet 一次；HTTP 作用域加载第一个文件一次。
安装前备份现有站点，合并已有 realip/日志设置，不重复定义。`nginx -t` 通过后仅 reload。
不要把这些 server 级保护自动加到其他项目。

登录入口按站点和可信访客 IP 采用 5 次/分钟的漏桶速率，允许 burst=5 的短时突发；
站点总量另设 2 次/秒、burst=10，超出返回 429。这里的 Nginx 漏桶不等同于后端的
严格滚动窗口：SOP 后端仍独立执行下述 60 秒最多 5 次。

在所有转发到对应本机服务的位置明确配置：

```nginx
proxy_set_header X-Forwarded-For $remote_addr;
proxy_set_header X-User-Id "";
proxy_set_header X-User-Role "";
proxy_set_header X-Display-Name "";
proxy_set_header X-Ops-Actor-Id "";
proxy_set_header X-Ops-Actor-Name "";
```

**仅公网 auto 站点**另加 `proxy_set_header Authorization "";`。本机 SOP 直接访问
`127.0.0.1:26909`，正常服务令牌认证不经过公网入口；auto 网页仍使用操作者 cookie。
SOP 入口不清除 Authorization。异机 SOP 或其他远程集成需先设计独立受控入口，
不能直接照搬这个同机部署配置。

真实 IP 配置的权威网段来源、代理信任与更新方式见
[Cloudflare 登录来源说明](cloudflare-login-ip.md)。限流语义见
[Nginx limit_req 官方文档](https://nginx.org/en/docs/http/ngx_http_limit_req_module.html)。

新增 `/var/log/nginx/mxd-security.log` 记录可信访客 IP、代理 IP、站点、方法、路径、
响应状态、限流结果和请求 ID，不记录 query、请求体、cookie、密码或令牌。
原访问日志仍保留。Debian 现有 Nginx 日志轮转规则覆盖该 `.log` 文件。

### SOP 后端

- 登录别名共用每 IP 的严格 60 秒 5 次额度；第 11 次累计认证失败暂停该 IP 10 分钟。
  已有会话不受影响。确切错误、重置和容量语义由 [auth 契约](../contracts/auth.md) 定义。
- 后端只信任直接相连的回环代理；外部伪造转发头不能选择限流身份。
- 非测试环境禁用旧的演示身份头，即使显式设置 allowLegacyHeaders 也不能开启。
  工单接口无认证服务时不再接受生产环境的裸身份头。
- SOP→auto 要求显式有效服务令牌，不再使用共享默认值；服务状态和错误不暴露令牌。
  审计身份与认证令牌的边界由 [auto-integration 契约](../contracts/auto-integration.md) 定义。

首次服务器构建因只安装生产依赖、缺少 tsc 失败，已恢复原文件，没有以旧构建冒充新代码。
随后上传本地通过测试、编译的 10 份源文件和对应 10 份 JavaScript，逐项核对 SHA-256、
执行 `node --check`，在 21:42:24 仅重启 mxd-sop 并检查健康接口。
新 SOP PID 为 3834912（部署时记录，不是永久进程标识）。

auto 始终保留原进程 PID 932237、2026-10-18 的启动时间；未重启 auto 的游戏连接。
SOP 重启后原 4 个有效会话保留，21:45 又有新的经理会话成功建立。

## 本地完成、尚未发布到 auto 的改动

Go auto 已移除共享服务令牌/初始化密码默认值及 LegacyUnauthenticated 绕过，
新数据库必须显式配置合规初始化密码；已有数据库不会因缺少初始化密码被重置。
同时已补充远端游戏拒绝的安全诊断信息。Go 测试和构建通过，但本次没有替换 auto 二进制。

线上现有服务令牌已经是显式配置的 64 字符值，初始化密码也不是已知旧默认值；
公网服务令牌入口限制已经生效。因此这些待发布的 Go 改动主要固化后续安装/升级的默认行为。
不能将“本地测试通过”表述为“线上 auto 已运行新版本”。

潜能登录的游戏拒绝曾出现 op=0、rc=1；目前没有足够协议证据解释 rc=1 的具体含义，
不能断定为密码错误或入侵，也未验证该游戏登录问题已解决。

## 验证结果

- SOP 后端：24 个测试文件、194 项测试通过，TypeScript 构建通过。
- Go auto：`go test ./...` 和 `go build ./...` 通过。
- 使用服务器 Nginx 在临时目录启动独立测试实例，3 项真实 IP 测试通过，覆盖可信代理、
  不可信来源伪造头、IPv6 和缺失/非法头回退；未更改系统 Nginx 或占用业务端口。
- Nginx：配置检查通过；12 次交替登录别名、轮换伪造来源头的探测得到 6 次 401、
  6 次 429；安全日志仍将其识别为实际回环来源。
- SOP 直接后端探测：共享来源的第 6 次请求返回 429、`login-rate-limited`、Retry-After。
- 伪造 auto-process / super-admin / demo-super-admin 访问账户接口均返回 401。
- 同一真实服务令牌访问本机 auto 概览返回 200，经过公网 auto 虚拟主机返回 401。
  探测未发送游戏命令，也未输出令牌。
- SOP 页面、SOP 健康接口、auto 页面均为 200；nginx、mxd-sop、mxd-auto-process、
  mxd-player 均为 active。仅健康检查不代表所有业务流程均已验证。

## 证据与回滚边界

服务器目录 `/root/mxd-security-20261115-213116` 为 root 专有备份，包含原站点配置、
变更前访问日志和 SSH 日志，以及以下清单：

- `manifest.json`：Nginx 目标路径及旧文件映射；null 表示本次新增片段。
- `sop-release-manifest.json`：最终上传源文件和 JavaScript 的校验和、原先不存在的文件清单。
- `sop-artifacts-before/`：按仓库相对路径保存的原 SOP 源文件和构建产物。
- `sop-dist-before.tgz`、`sop-source-before/`：首次尝试前的补充备份。

回滚时先确认是上述部署、且目标文件之后没有其他发布。Nginx 按 manifest 恢复两个旧站点，
移除仅本次新增且已无引用的三个片段，先 `nginx -t` 再 reload；不要覆盖其他站点。
SOP 按 release manifest 从 `sop-artifacts-before/` 恢复原有文件，移除本次新增文件，
保留 mxd-sop 所有权；只重启 mxd-sop 并验证 `http://127.0.0.1:26902/health`。
不恢复业务数据库、不回滚会话、不重启 auto。回滚会撤去本次相应保护，应限于排障所需范围。

后续若确认存在未经授权的成功登录，应按实际影响撤销对应会话并更换受影响凭据。
仅看到账户或审计名称，不构成凭据泄露证据；本次没有因名称可见而盲目轮换 SSH 密钥。
