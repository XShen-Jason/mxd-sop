# 心跳功能实现说明

## 概述

心跳功能已从pcap抓包分析中提取并实现到项目中。当前端点击"Enter game"按钮进入游戏后，系统会自动启动心跳机制以保持与服务器的连接。

## 心跳参数

根据pcap文件分析（参考 `docs/PCAP_REQUESTS_15_12_22.md` 和 `docs/FAIRYLAND_LOTTERY_REQUEST.md`），确认的心跳参数为：

- **操作码**: `op=19`
- **发送间隔**: 20秒
- **消息格式**: `{"t":"op","op":19}`

## 配置

心跳功能在 `backend-auto-process/config/servers.json` 中配置：

```json
"heartbeat": {
  "enabled": true,
  "interval_seconds": 20,
  "operation": 19
}
```

### 配置参数说明

- `enabled`: 是否启用心跳（已设置为 `true`）
- `interval_seconds`: 心跳间隔（秒），取值范围 0-3600
- `operation`: 心跳操作码（19）

## 实现细节

### 代码位置

1. **配置定义**: `backend-auto-process/internal/servercatalog/catalog.go`
   - `HeartbeatSettings` 结构体

2. **Session配置**: `backend-auto-process/internal/gamesession/types.go`
   - `HeartbeatInterval` 和 `HeartbeatOperation` 字段

3. **心跳启动**: `backend-auto-process/internal/gamesession/session.go`
   - `EnterGame()` 方法在进入游戏后调用 `startHeartbeatLocked()`

4. **心跳实现**: `backend-auto-process/internal/gamesession/chat.go`
   - `startHeartbeatLocked()`: 启动心跳goroutine
   - `heartbeatActive()`: 检查会话是否处于活跃状态
   - `markHeartbeatFailed()`: 标记心跳失败

### 工作流程

1. 用户在前端点击"Enter game"按钮
2. 前端调用 `/api/v1/sessions/{id}/enter` 接口
3. 后端执行 `Session.EnterGame()`
4. EnterGame成功后，调用 `startHeartbeatLocked()`
5. 启动一个goroutine，使用 `time.Ticker` 每20秒发送一次心跳
6. 心跳消息通过 `gameprotocol.NewOperation(19)` 构造并发送
7. 如果心跳发送失败，会话状态被标记为 `StateFailed`

### 心跳生命周期

- **启动时机**: 进入游戏（`EnterGame`）成功后
- **停止时机**: 
  - 会话关闭（`Close()`）时关闭 `heartbeatStop` channel
  - 心跳发送失败时自动停止
  - 会话状态不是 `StateReady` 时停止

### 错误处理

心跳发送失败会触发：
```go
func (s *Session) markHeartbeatFailed(err error) {
    s.mu.Lock()
    defer s.mu.Unlock()
    if s.state != StateClosed {
        s.state = StateFailed
        s.lastError = ErrorCode(err)
        s.touchLocked()
    }
}
```

会话状态变为 `StateFailed`，前端会显示失败状态。

## 前端交互

前端按钮启用逻辑由 `frontend-auto-process/src/` 管理，构建产物位于 `backend-auto-process/internal/operatorapi/assets/`：

```javascript
async function enterGame() {
  showProgress("entering_map");
  const session = await request(`/api/v1/sessions/${state.session.id}/enter`, { 
    method: "POST", 
    body: "{}" 
  });
  showSession(session);
}
```

点击"Enter game"按钮后：
1. 按钮变为禁用状态
2. 显示"ENTERING"进度
3. 调用后端API
4. 进入成功后状态变为"READY"
5. **心跳在此时自动启动**（在后端）

## 验证方法

要验证心跳是否正常工作，可以：

1. 启动服务器: `start.bat`
2. 打开浏览器访问 operator UI
3. 选择服务器并登录
4. 选择角色
5. 点击"Enter game"
6. 使用Wireshark或tcpdump抓包，应该能看到每20秒发送的 `{"t":"op","op":19}` 消息

或者在代码中添加日志：

```go
// 在 chat.go 的 startHeartbeatLocked() 中
err := transport.Send(heartbeatCtx, gameprotocol.NewOperation(operation))
if err != nil {
    log.Printf("Heartbeat failed: %v", err)
} else {
    log.Printf("Heartbeat sent successfully (op=%d)", operation)
}
```

## 性能影响

根据 `docs/PERFORMANCE.md`：

> Heartbeats are disabled unless a server definition explicitly enables the
> heartbeat interval.

心跳现已启用，每20秒发送一次小型消息（约30字节），对性能影响极小。

## PCAP数据源

心跳参数来自以下抓包文件的分析：

- `datacj/PCAPdroid_09_9月_15_12_22.pcap`
- `datacj/PCAPdroid_09_9月_16_46_18.pcap`
- `datacj/PCAPdroid_09_9月_18_41_52.pcap`

文档记录：
- `docs/PCAP_REQUESTS_15_12_22.md`: 确认了 `op=19` 心跳消息
- `docs/FAIRYLAND_LOTTERY_REQUEST.md`: 说明心跳不应作为业务逻辑的一部分

## 总结

✅ 心跳功能已完全实现并启用  
✅ 参数来自实际pcap抓包分析  
✅ 在前端点击"Enter game"后自动启动  
✅ 使用operation 19，间隔20秒  
✅ 包含完整的错误处理和生命周期管理
