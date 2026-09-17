# 自动重连功能设计文档

## 需求分析

根据用户描述，需要实现以下功能：

1. **检测被挤下线**：识别服务器发送的踢出信号
2. **自动重连**：无需完整登录流程，快速恢复到可发送聊天的状态
3. **保持会话状态**：重连后应该在游戏中，可以直接发聊天消息

## 被踢下线的可能信号

基于常见游戏协议模式，被踢下线可能通过以下方式通知：

### 1. 错误响应码
```json
{"t":"resp","op":11,"p":[{"id":1,"v":"1001"}]}  // rc != 0
```

### 2. 特殊事件
```json
{"t":"evt","ev":99,"p":[{"id":65,"v":"AccountLoginElsewhere"}]}
{"t":"evt","ev":100,"p":[{"id":36,"v":"您的账号在其他地方登录"}]}
```

### 3. 连接断开
- TCP连接异常关闭
- 心跳超时无响应

## 重连策略

### 方案A：完整重连（需要重新登录）
```
检测到被踢 → 重新连接TCP → op=0登录 → op=6选角色 → op=7进入地图 → 可用
```
**缺点**：流程长，需要保存密码

### 方案B：快速重连（基于session保持）
```
检测到被踢 → 重新连接TCP → 发送特殊恢复操作 → 可用
```
**需要**：服务器支持基于token的快速恢复

### 方案C：混合方案（当前推荐）
```
1. 检测断连/被踢
2. 尝试重新建立TCP连接
3. 如果服务器支持，发送op=0（使用已保存的token）快速登录
4. 如果已经保存了角色信息，重新op=6 + op=7
5. 恢复到Ready状态
```

## 实现设计

### 1. 断连检测

在`gamesession/session.go`中添加断连检测：

```go
// 监听可能的踢出事件
func (s *Session) handleServerEvent(message gameprotocol.Message) error {
    if message.IsEvent(99) || message.IsEvent(100) {
        // 检查是否是踢出事件
        for _, param := range message.Params {
            if param.ID == 65 || param.ID == 36 {
                val := strings.ToLower(param.Value)
                if strings.Contains(val, "elsewhere") || 
                   strings.Contains(val, "其他地方") ||
                   strings.Contains(val, "duplicate") {
                    return ErrKickedOut
                }
            }
        }
    }
    return nil
}
```

### 2. 自动重连器

创建`gamesession/reconnect.go`：

```go
type ReconnectConfig struct {
    Enabled        bool
    MaxAttempts    int
    RetryDelay     time.Duration
    QuickReconnect bool  // 是否尝试快速重连
}

type Reconnector struct {
    session     *Session
    config      ReconnectConfig
    credentials Credentials
    characterID string
    mapID       string
    
    mu              sync.Mutex
    reconnecting    bool
    lastDisconnect  time.Time
}

func (r *Reconnector) Start() {
    // 监听断连事件
    // 触发重连逻辑
}

func (r *Reconnector) reconnect(ctx context.Context) error {
    // 1. 重新建立TCP连接
    // 2. 尝试op=0登录
    // 3. op=6选择角色
    // 4. op=7进入地图
    // 5. 恢复到Ready状态
}
```

### 3. 会话状态保存

修改`Session`结构：

```go
type Session struct {
    // ... 现有字段 ...
    
    // 重连支持
    reconnector      *Reconnector
    lastCredentials  Credentials
    
    // 用于快速重连
    savedCharacterID string
    savedMapID       string
    savedOpaque      string
}
```

## 配置

在`backend-auto-process/config/servers.json`中添加重连配置：

```json
{
  "reconnect": {
    "enabled": true,
    "max_attempts": 3,
    "retry_delay_seconds": 2,
    "quick_reconnect": true
  }
}
```

## 工作流程

### 正常流程
```
用户登录 → 保存凭证 → 选择角色 → 保存角色信息 → 进入游戏 → Ready
```

### 被踢后自动重连
```
检测到断连/踢出事件
  ↓
标记状态为 Reconnecting
  ↓
延迟2秒（避免立即重连失败）
  ↓
使用保存的凭证重新登录
  ↓
使用保存的角色信息选择角色
  ↓
进入地图
  ↓
恢复到 Ready 状态
  ↓
通知前端/继续操作
```

## 心跳处理

### 决定：**禁用心跳**

根据分析，心跳功能（op=19）主要用于：
- 保持TCP连接活跃
- 检测连接是否存活

**问题**：
1. 增加网络流量（虽然很小）
2. 如果被踢下线，心跳无法防止
3. 重连机制已经可以处理断连

**建议**：
- 如果服务器会主动踢出空闲连接 → 保留心跳
- 如果被踢主要因为多地登录 → 心跳无用，可以禁用

## 前端支持

前端需要显示重连状态：

```javascript
const flowSteps = {
  // ... 现有状态 ...
  reconnecting: { 
    badge: "RECONNECTING", 
    description: "检测到断连，正在自动重连...", 
    tone: "working" 
  },
};
```

## 错误代码

新增错误类型：

```go
var (
    ErrKickedOut        = errors.New("kicked out by server")
    ErrReconnectFailed  = errors.New("reconnect failed")
    ErrReconnecting     = errors.New("reconnection in progress")
)
```

## 测试场景

1. **模拟被踢**：同一账号在另一设备登录
2. **网络中断**：断开TCP连接
3. **心跳失败**：服务器无响应
4. **快速重连**：重连后直接发送聊天

## 后续步骤

1. ✅ 设计文档（本文档）
2. ⬜ 实现断连检测
3. ⬜ 实现重连器
4. ⬜ 添加配置选项
5. ⬜ 更新前端UI
6. ⬜ 测试和验证

---

**注意**：具体的被踢事件码（evt=?）和错误码（rc=?）需要根据实际pcap抓包数据确定。
