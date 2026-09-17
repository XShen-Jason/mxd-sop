# 心跳功能快速指南

## ✅ 状态：已完成并启用

心跳功能已根据pcap抓包分析完成实现并启用。

## 配置位置

**文件**: `backend-auto-process/config/servers.json`

```json
"heartbeat": {
  "enabled": true,
  "interval_seconds": 20,
  "operation": 19
}
```

## 工作原理

1. **触发时机**: 用户在前端点击 **"Enter game"** 按钮后
2. **自动启动**: 后端 `EnterGame()` 方法成功后自动调用 `startHeartbeatLocked()`
3. **发送频率**: 每 20 秒发送一次
4. **消息格式**: `{"t":"op","op":19}`

## 技术细节

### 实现位置

- **启动**: `backend-auto-process/internal/gamesession/session.go:119` - `EnterGame()` 调用 `startHeartbeatLocked()`
- **核心逻辑**: `backend-auto-process/internal/gamesession/chat.go:106-136` - 心跳goroutine实现
- **配置**: `backend-auto-process/config/servers.json:19-23` - 心跳参数配置

### 代码流程

```go
// 1. 用户点击前端按钮 -> API调用
POST /api/v1/sessions/{id}/enter

// 2. 后端EnterGame成功后
s.startHeartbeatLocked()  // 启动心跳

// 3. 后台goroutine每20秒执行
ticker := time.NewTicker(interval)  // 20秒
transport.Send(ctx, gameprotocol.NewOperation(19))  // 发送op=19
```

### 生命周期

- **开始**: 进入游戏后（状态变为 `StateReady`）
- **运行**: 每20秒发送一次，只要会话状态为 `StateReady`
- **停止**: 
  - 会话关闭时（调用 `Close()`）
  - 心跳发送失败时
  - 会话状态不再是 `StateReady` 时

## 数据来源

心跳参数基于以下pcap文件分析得出：

| 文件 | 相关文档 |
|------|---------|
| `PCAPdroid_09_9月_15_12_22.pcap` | `docs/PCAP_REQUESTS_15_12_22.md` |
| `PCAPdroid_09_9月_16_46_18.pcap` | `docs/PCAP_COMMAND_RESULTS_16_46_18.md` |
| `PCAPdroid_09_9月_15_29_16.pcap` | `docs/PCAP_CHAT_REQUESTS_15_29_16.md` |

**关键发现**:
- 文档确认客户端发送 `op=19` 作为心跳
- 文档提到心跳在整个会话期间持续发送
- 20秒间隔是合理的默认值（在0-3600秒范围内）

## 前端界面

前端交互位于 `frontend-auto-process/src/`，构建产物位于 `backend-auto-process/internal/operatorapi/assets/`。

```html
<button id="enter" class="button" type="button" disabled>Enter game</button>
```

点击后调用后端 API：

```javascript
async function enterGame() {
  showProgress("entering_map");
  const session = await request(`/api/v1/sessions/${state.session.id}/enter`, 
    { method: "POST", body: "{}" });
  showSession(session);
}
```

## 验证方法

### 方法1: 日志验证（开发环境）

在 `backend-auto-process/internal/gamesession/chat.go` 的心跳发送处添加日志：

```go
err := transport.Send(heartbeatCtx, gameprotocol.NewOperation(operation))
cancel()
if err != nil {
    log.Printf("❌ Heartbeat failed: %v", err)
    s.markHeartbeatFailed(err)
    return
} else {
    log.Printf("✓ Heartbeat sent (op=%d)", operation)
}
```

### 方法2: 抓包验证

1. 启动应用: `start.bat`
2. 打开浏览器，访问 operator UI
3. 完成登录并点击"Enter game"
4. 使用 Wireshark/Fiddler/Charles 抓包
5. 过滤 `45.117.11.230:12660` 的流量
6. 应该每20秒看到一个 `{"t":"op","op":19}` 消息

### 方法3: 代码检查

```bash
# 确认配置已启用
cat backend-auto-process/config/servers.json | grep -A 3 heartbeat

# 确认实现存在
grep -n "startHeartbeatLocked" backend-auto-process/internal/gamesession/*.go
```

## 性能影响

- **消息大小**: ~30字节
- **频率**: 每20秒一次 = 3次/分钟
- **带宽消耗**: ~90字节/分钟 ≈ 可忽略
- **CPU/内存**: 单个goroutine，minimal overhead

## 故障排查

### 心跳未启动？

检查：
1. `backend-auto-process/config/servers.json` 中 `"enabled": true`
2. 成功进入游戏（状态为 `StateReady`）
3. `HeartbeatInterval > 0`

### 心跳失败？

症状：会话状态变为 `StateFailed`

原因：
- 网络连接断开
- 服务器不接受op=19消息
- 发送超时（超过 interval/2 或 5秒）

解决：检查网络连接和服务器日志

## 参考文档

- **完整实现说明**: `docs/HEARTBEAT_IMPLEMENTATION.md`
- **PCAP分析**: `docs/PCAP_REQUESTS_15_12_22.md`
- **抽奖请求文档**: `docs/FAIRYLAND_LOTTERY_REQUEST.md` (第209-220行)
- **性能文档**: `docs/PERFORMANCE.md`

---

**总结**: 心跳功能已完全实现。在前端点击"Enter game"后，系统会自动每20秒发送一次op=19心跳消息以保持连接。✅
