# fairyland-lottery.draw

Owner: `fairyland-lottery`  
Version: `v1`（基于抓包观测，非官方公开 API）  
Consumers: 后续自动抽奖程序  
Source: `datacj/PCAPdroid_09_9月_18_41_52.pcap`  

## Purpose

本文档定义“仙境/转蛋”单次抽奖的网络请求、连接前置条件、响应解析和
结果判定规则。后续程序可以按本文档构造请求并读取服务端事件，不需要
手动进入游戏点击抽奖。

抓包中的角色为 `REF`，角色 ID 为 `265`。账号、登录 token 和会话字段
均属于敏感信息，本文档不记录真实值。

## Protocol

### Endpoint

- Transport: TCP
- Server: `45.117.11.230:12660`
- Client local port: 动态分配，不能写死
- Main game connection: 抽奖请求和奖励事件均在同一条主连接上

抓包中另有一条只承载心跳的辅助连接。程序只需要维护主游戏连接，不应
按本次抓包的本地端口或 TCP 序列号识别会话。

### Frame format

每个应用层消息使用以下格式：

```text
uint32 big-endian body_length + UTF-8 JSON body
```

`body_length` 只计算 JSON body 的字节数，不包含 4 字节长度前缀。TCP
读取必须使用缓冲区，因为一次 `recv` 可能得到半个消息、多个消息或一个
消息的一部分。

编码示例：

```text
body = compact_json.encode("utf-8")
frame = len(body).to_bytes(4, "big") + body
```

## Session prerequisites

抽奖请求依赖已登录、已选角色并已进入游戏地图的会话。抓包中观察到的
最小稳定顺序如下：

1. 建立 TCP 主连接。
2. 发送登录 `op=0`，等待 `resp op=0 rc=0`。
3. 发送角色选择 `op=6`，等待 `resp op=6 rc=0`。
4. 发送地图进入 `op=7`，地图 ID 为 `211000000`，等待 `resp op=7 rc=0`。
5. 等待地图进入成功和必要的地图初始化事件后，发送抽奖 `op=61`。

### Login request

真实账号和 token 必须从运行时安全配置读取，不要从 PCAP 固化到源码：

```json
{"t":"op","op":0,"p":[[0,"<account>"],[1,"<login-token>"],[35,"1.0.2"]]}
```

成功响应至少需要确认：

```text
t=resp, op=0, rc=0
```

### Select character request

```json
{"t":"op","op":6,"p":[[10,"<character-id>"],[81,"<opaque-session-value>"]]}
```

字段 `[81]` 是角色选择阶段使用的 opaque 值，不能用登录响应中的
server key 替代，除非后续抓包证明协议发生变化。

### Enter map request

```json
{"t":"op","op":7,"p":[[16,"211000000"]]}
```

空地图 ID 的 `op=7` 只在部分旧流程中出现，不是普遍必需步骤。程序应
以实际地图进入成功响应为准，而不是强制发送空地图请求。

本次抓包中，`resp op=7 rc=0` 后紧跟 `evt=2`（`MapPlayerList`）和
`evt=64`（地图标识 `211000000:ch1`）等初始化事件。它们是本次会话的
就绪证据，但没有观察到一个可跨版本保证的独立 ready 消息；程序至少要
确认 `resp op=7 rc=0`，并按实际收到的地图初始化事件完成状态切换。

## Draw request

### Request body

五次点击发送的 body 完全相同，每个请求代表一次单抽：

```json
{
  "t": "op",
  "op": 61,
  "p": [
    [65, "BuyFairylandSupplyRequest"],
    [34, {"$i32": 1}]
  ]
}
```

使用紧凑 JSON 序列化时，body 长度为 `73` 字节。

```text
Frame hex:
000000497b2274223a226f70222c226f70223a36312c2270223a5b5b36352c2242757946616972796c616e64537570706c7952657175657374225d2c5b33342c7b2224693332223a317d5d5d7d

Frame base64:
AAAASXsidCI6Im9wIiwib3AiOjYxLCJwIjpbWzY1LCJCdXlGYWlyeWxhbmRTdXBwbHlSZXF1ZXN0Il0sWzM0LHsiJGkzMiI6MX1dXX0=
```

字段含义：

| 字段 | 值 | 含义 |
| --- | --- | --- |
| `t` | `op` | 客户端操作消息 |
| `op` | `61` | 仙境供应/转蛋购买操作 |
| `p[0]` | `[65, "BuyFairylandSupplyRequest"]` | 操作名称 |
| `p[1]` | `[34, {"$i32": 1}]` | 单抽数量；抓包只证明 `1` |

没有观察到批量抽奖参数。后续程序不要把 `1` 改成更大数量并假设服务端
会执行批量抽奖。

## Response and result handling

### No direct `resp op=61`

抓包中没有 `resp op=61`。TCP ACK、请求 frame 已写入、连接未断开，都
不能单独证明抽奖成功。程序必须继续读取主连接上的完整应用层消息。

一次抽奖的成功证据由以下事件组合组成：

1. `ev=25`：库存数量更新。
2. `ev=40`：物品获得通知。
3. `ev=63` 且字段 `[65]` 为 `DomainRewardRemind`：本次抽奖的主奖励。

### Inventory update: `ev=25`

示例：

```json
{
  "t": "evt",
  "ev": 25,
  "p": [
    [27, "{\"2\":\"100000069\",\"2_amount\":\"999\"}"],
    [38, "Consume"]
  ]
}
```

字段 `[27]` 是再次 JSON 编码的库存对象，`*_amount` 表示更新后的库存
数量，不是本次变化量。例如快乐百宝券从 `1000` 变成 `999` 表示消耗
一张。字段 `[38]` 是库存分类，例如 `Consume` 或 `Material`。

### Item acquisition: `ev=40`

```json
{
  "t": "evt",
  "ev": 40,
  "p": [
    [47, "02340000"],
    [43, {"$i64": "1"}]
  ]
}
```

- `[47]`: 物品代码，必须按字符串保留前导零
- `[43]`: 本次物品获得数量；本抓包中均为 `1`

每次抽奖都会先看到一个 `02539001` 的物品获得事件，然后才是主奖励
物品的获得事件。不能把第一个 `ev=40` 直接当成主奖励。

### Primary reward: `DomainRewardRemind`

```json
{
  "t": "evt",
  "ev": 63,
  "p": [
    [27, "[{\"id\":\"02340000\",\"amount\":1}]"],
    [28, "[]"],
    [65, "DomainRewardRemind"]
  ]
}
```

当 `[65]` 等于 `DomainRewardRemind` 时，解析 `[27]` 中的 JSON 数组作为
本次主奖励。数组语义应按列表实现，不能假设未来永远只有一个元素。

### Rare-item broadcast: `ev=20`

`ev=20`、字段 `[65]` 为 `Event`、字段 `[36]` 为文字时，表示转蛋播报。
它是可选展示事件，不作为唯一成功判据。抓包中第 1 次和第 5 次出现了
稀有物品播报。

### Heartbeats and unrelated events

以下消息不能当作抽奖结果：

```json
{"t":"ping"}
{"t":"pong"}
{"t":"evt","ev":18,"p":[]}
```

抓包还观察到客户端 `op=19` 心跳/控制消息。程序需要按实际服务端协议
维护连接，但不应把心跳数量、TCP 包数量或 `op=19` 当作抽奖次数。

## Ordering, timeout, and retry

- 同一条连接最多保持一个未完成的抽奖请求；等待当前请求的终端结果后
  再发送下一次。
- 协议没有请求 ID，不能依赖响应中的 request ID 做关联。
- 终端结果以 `DomainRewardRemind` 为边界；其前后的同一批库存和获得
  事件应归入当前请求。
- timeout 必须是可配置值。本次抓包从请求到首个服务端库存更新约为
  `23-27 ms`，这不是服务端承诺的超时 SLA。
- 发送后超时或断线时，结果是 `unknown`，不能直接自动重发；抽奖是
  非幂等操作，重发可能造成重复消费。程序应先重连、重新读取角色库存
  或其他可验证状态，再决定是否继续。
- `rc != 0`、明确业务错误、连接关闭且未收到终端奖励事件，都不能标记
  为成功。

## Item mapping

以下名称来自本项目上层主目录的道具表
`../data/item-catalog/source/道具表-9-5.csv`。程序内部仍应以代码为主，
名称只用于展示。

| Item code | Class | Name | Role in observed draw |
| --- | --- | --- | --- |
| `100000069` | `consume` | 快乐百宝券 | 每次消耗 1 张 |
| `02539001` | `consume` | 奖池晶石 | 每次固定增加 1 枚；第 4 次主奖励也为它 |
| `02340000` | `consume` | 祝福卷轴 | 第 1 次主奖励 |
| `04310100` | `material` | 金条 | 第 2 次主奖励 |
| `04009453` | `material` | 副本碎片 | 第 3 次主奖励 |
| `02535001` | `consume` | 宠物帽子药水20% | 第 5 次主奖励 |

注意：第 1 次返回的是 `02340000`，不是已有库存中的绑定变体
`02340000_1`，代码不能合并处理。

## Observed five-draw fixture

以下数据可作为后续程序的解析回归样例。时间为抓包本地时间，packet 是
PCAP 全局包号，不是应用层协议字段。

| Draw | Request packet/time | First result packet/time | Primary reward | Fixed crystal update | Rare broadcast |
| ---: | --- | --- | --- | --- | --- |
| 1 | `273 / 18:42:11.718` | `278 / 18:42:11.744` | `02340000` 祝福卷轴 ×1 | `02539001` ×1 | 是，播报“祝福” |
| 2 | `324 / 18:42:14.640` | `326 / 18:42:14.663` | `04310100` 金条 ×1 | `02539001` ×1 | 否 |
| 3 | `368 / 18:42:16.833` | `370 / 18:42:16.857` | `04009453` 副本碎片 ×1 | `02539001` ×1 | 否 |
| 4 | `402 / 18:42:18.563` | `405 / 18:42:18.589` | `02539001` 奖池晶石 ×1 | 另有固定 `02539001` ×1，本次共 ×2 | 否 |
| 5 | `450 / 18:42:21.619` | `452 / 18:42:21.642` | `02535001` 宠物帽子药水20% ×1 | `02539001` ×1 | 是 |

对应的 `DomainRewardRemind` 数据包为 `280、327、372、406、453`。

初始库存事件显示：

- `100000069`: `1000`
- `04310100`: `77`
- `04009453`: `13`
- `02340000_1`: `30`

五次完成后，抓包观察到的净变化为：快乐百宝券 `-5`，祝福卷轴 `+1`，
金条 `+1`，副本碎片 `+1`，奖池晶石 `+6`，宠物帽子药水20% `+1`。

## Language-neutral flow

```text
connect(server, port)
send_frame(login(runtime_credentials))
await resp(op=0, rc=0)

send_frame(select_character(runtime_character_id, runtime_opaque_value))
await resp(op=6, rc=0)

send_frame(enter_map("211000000"))
await resp(op=7, rc=0)
await map_initialization_or_ready_state()

for each single draw:
    send_frame(BuyFairylandSupplyRequest, i32=1)
    events = receive_complete_frames_until(DomainRewardRemind)
    validate_inventory_change(events, ticket_delta=-1)
    validate_item_acquisition(events)
    reward = parse_primary_reward(events)
    persist_success(reward, events)
```

`receive_complete_frames_until` 必须处理 TCP 粘包、拆包和无关心跳。若在
超时前没有得到有效的 `DomainRewardRemind`，只能保存为 `unknown/timeout`，
不能保存为成功。

## Security and compatibility

- 不要把 PCAP 中的账号、登录 token、角色选择 opaque 值、完整 frame 或
  Base64 凭证写入源码、日志、测试快照或提交记录。
- 登录材料应由运行时安全配置注入，并在日志中脱敏。
- 端口、角色 ID、版本号和 map ID 应配置化；本次抓包只能证明当前服务端
  使用的值。
- Item code 必须使用字符串，保留前导零。
- 本文档只描述已观察到的明文 TCP 协议。若服务端增加加密、修改字段
  编号或改用其他 endpoint，程序必须重新抓包并升级协议版本。
- 后续实现应先用上述五次 fixture 做离线解析测试，再进行真实账号的
  小规模在线验证。
