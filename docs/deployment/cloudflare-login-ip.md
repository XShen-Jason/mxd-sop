# Cloudflare 橙云与 SOP 登录限流

适用链路：访客 → Cloudflare 橙云 → 本机 Nginx → `127.0.0.1:26902` 的 SOP 后端。
后端只信任直接相连的本机代理，不自动跳过任意数量的代理。

未配置真实 IP 时，Nginx 向 `X-Forwarded-For` 末尾追加 Cloudflare 节点地址，
后端会按节点计数，可能合并不同用户的额度。Nginx 必须先使用 realip 模块恢复访客 IP。

## 配置来源与信任边界

唯一网段配置为 `deploy/security/mxd-cloudflare-realip.conf`，按
[Cloudflare IPv4](https://www.cloudflare.com/ips-v4) 和
[Cloudflare IPv6](https://www.cloudflare.com/ips-v6) 官方列表核对。
它只信任这些网段的直接网络连接，使用 `real_ip_header CF-Connecting-IP`。
规则由 [Nginx realip 模块](https://nginx.org/en/docs/http/ngx_http_realip_module.html) 执行。
不要把 `set_real_ip_from` 改成所有地址，也不要在后端无条件读取该请求头。

Nginx 恢复后的 `$remote_addr` 是访客地址；本项目单机部署使用
`proxy_set_header X-Forwarded-For $remote_addr`，覆盖外部传入的转发链，
只向后端提供已验证的地址。直连源站的非 Cloudflare 请求，其伪造头不会改变 `$remote_addr`。
官方网段变化时更新仓库片段、重新安装并执行 `nginx -t` 后重载，不在每次请求时联网查询。

## 已有服务器补装

先按项目更新手册把包含此文件的提交拉到服务器。以下以 `/opt/mxd-sop` 为仓库目录；
Debian 通用模板部署使用 `/opt/ops-desk`。安装片段不会自动修改任何站点：

```bash
sudo install -d -m 755 /etc/nginx/snippets
sudo install -m 644 /opt/mxd-sop/deploy/security/mxd-cloudflare-realip.conf /etc/nginx/snippets/mxd-cloudflare-realip.conf
sudoedit /etc/nginx/sites-available/mxd-sop.conf
```

在 SOP 的 HTTPS `server { ... }` 内添加一次：

```nginx
include /etc/nginx/snippets/mxd-cloudflare-realip.conf;
```

在转发到本机 SOP 的位置将 `X-Forwarded-For` 设置为上述 `$remote_addr`，其余转发配置保留。
若站点已经设置 `real_ip_header` 或包含其他真实 IP 片段，
先合并该站点的配置，避免同一作用域重复定义；不要覆盖整个站点或修改其他项目。然后执行：

```bash
sudo nginx -t && sudo systemctl reload nginx
```

此步骤只重载 Nginx。后端登录保护代码仍须按 SOP 更新手册部署。
Cloudflare SSL/TLS 使用 Full (strict) 与源站 HTTPS 配合；不要启用移除访客 IP 的 Managed Transform。
若开启 Pseudo IPv4，使用 Off 或 Add Header，避免 Overwrite Headers 将真实 IPv6 替换为伪 IPv4。
这是普通橙云链路配置；额外 Worker、Tunnel 或负载均衡器需按实际代理链另行验证。
相关头部行为见 [Cloudflare 官方说明](https://developers.cloudflare.com/fundamentals/reference/http-headers/)。

## 验证

仓库提供真实 Nginx 的隔离回归测试，不修改系统配置，不重载线上服务：

```bash
python3 deploy/tests/cloudflare-realip.test.py
```

默认调用 PATH 中的 `nginx`，也可设置 `NGINX_BINARY` 为待测二进制绝对路径。
测试仅在临时配置中用 `127.0.0.2` 模拟 Cloudflare 来源，验证两名访客分离、
不可信连接伪造头被忽略、IPv6 及缺失/非法头回退；生产片段不会加入回环信任。
同一测试还加载仓库的前置限流片段，验证 SOP 两个登录地址共用 10 次突发额度，
auto 原有突发额度不变，普通 API 不占登录额度。

上线后用两个不同公网出口验证：A 在 5 分钟内发起第 11 次登录被拒绝时，B 仍可登录；
请求额度测试应使用正确凭据，避免提前触发密码错误锁定。另行验证第 5 次密码错误
立即锁定 20 分钟及到期恢复。不要用两个同 Wi-Fi 设备代替两个出口。
仓库本地测试通过只证明配置行为，不能代替线上真实链路验证。

## 已安装 Nginx 登录前置限流的站点

SOP 的两个登录地址在 Nginx 共用独立的 `mxd_sop_login_ip` 桶，持续速率 `2r/m`、
`burst=9` 允许瞬间到达的 10 次请求。后端执行严格滚动窗口和认证失败锁定，
Nginx 漏桶不能替代后端规则。auto 仍使用原先独立的 `5r/m`、`burst=5`；
两个站点各自的总量保护仍为 `2r/s`、`burst=10`。

已有 `mxd-login-guard.conf` / `mxd-login-server.conf` 保护的服务器需同时更新这两个
已安装文件，先备份、确认没有本地定制冲突，再执行 `nginx -t` 后 reload。只更新后端
会保留旧的前置突发上限，可能提前拦截 SOP 请求。这不表示本地修改已部署到线上。

HK-MXD 的入口限流、身份头清理和部署记录见
[2026-11-15 安全加固记录](HK-MXD-SECURITY-20261115.md)。
