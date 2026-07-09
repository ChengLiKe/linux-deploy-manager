# 终端功能修复方案

> 基于 2026-07-09 代码审查结果，逐一给出根本原因、修改方案、影响范围及实施步骤。

---

## 目录

- [P0 — 必须立即修复](#p0--必须立即修复)
- [P1 — 强烈建议修复](#p1--强烈建议修复)
- [P2 — 值得优化](#p2--值得优化)
- [实施路线图](#实施路线图)

---

## P0 — 必须立即修复

---

### 🔴 P0-1. SSH 主机密钥验证被禁用（MITM 漏洞）

| 项目 | 内容 |
|------|------|
| **根本原因** | `internal/remote/sshclient/client.go:35,47` 使用 `ssh.InsecureIgnoreHostKey()`，完全跳过主机密钥验证。任何能拦截网络流量的人都可以伪装成目标服务器。 |
| **影响范围** | **安全漏洞**。所有通过终端功能连接的 SSH 会话都暴露在 MITM 攻击下。攻击者可窃取/篡改所有终端输入输出。 |

**修改方案：添加 known_hosts 验证支持**

**文件：** `internal/remote/sshclient/client.go`

修改 `NewClientWithKey` 和 `NewClientWithPassword`，优先读取 `~/.ssh/known_hosts`，失败时至少记录警告：

```go
// 新增：创建 HostKeyCallback
func knownHostsCallback() (ssh.HostKeyCallback, error) {
    home, err := os.UserHomeDir()
    if err != nil {
        // 回退：第一次连接时信任，但记录警告
        slog.Warn("cannot determine home dir, falling back to InsecureIgnoreHostKey")
        return ssh.InsecureIgnoreHostKey(), nil
    }
    knownHosts := filepath.Join(home, ".ssh", "known_hosts")
    if _, err := os.Stat(knownHosts); err != nil {
        slog.Warn("known_hosts not found, falling back to InsecureIgnoreHostKey", "path", knownHosts)
        return ssh.InsecureIgnoreHostKey(), nil
    }
    callback, err := ssh.NewKnownHosts(knownHosts)
    if err != nil {
        slog.Warn("failed to parse known_hosts, falling back to InsecureIgnoreHostKey", "error", err)
        return ssh.InsecureIgnoreHostKey(), nil
    }
    return callback, nil
}
```

使用方式：

```go
// 改前 (client.go:35)
HostKeyCallback: ssh.InsecureIgnoreHostKey(),

// 改后
HostKeyCallback: func(hostname string, remote net.Addr, key ssh.PublicKey) error {
    callback, err := knownHostsCallback()
    if err != nil {
        return nil // 允许连接但会记录日志
    }
    return callback(hostname, remote, key)
},
```

**验证方式：**
1. 连接一个从未连接过的 SSH 服务器，终端应正常打开（首次连接默认信任）
2. 单元测试：mock 一个 SSH 服务器，验证 `knownHostsCallback` 返回有效 callback
3. 手动验证：修改目标服务器的 host key 后重连，预期连接被拒绝

---

### 🔴 P0-2. sessionId 被错误赋值给 nodeName（终端标签显示错误）

| 项目 | 内容 |
|------|------|
| **根本原因** | `web/src/stores/terminalStore.ts:102` 将 `msg.session_id` 赋给了 `entry.nodeName`。同时 `terminal_handler.go:134` 的 info 消息中没有包含 `node_name` 字段。 |
| **影响范围** | 所有 `TerminalPage` 顶部栏和 `TerminalManage` 的节点名称显示异常，显示的是乱码般的会话 ID。 |

**修改方案：前端 + 后端协同修复**

**文件 1：** `internal/handler/terminal_handler.go:134`

```go
// 改前
ws.WriteJSON(gin.H{"type": "info", "session_id": sessionID, "message": "终端连接已建立"})

// 改后
ws.WriteJSON(gin.H{
    "type": "info",
    "session_id": sessionID,
    "node_name": node.Name,
    "message": "终端连接已建立",
})
```

**文件 2：** `web/src/stores/terminalStore.ts:99-105`

```typescript
// 改前
if (msg.type === 'info') {
  const entry = sessions.get(nodeId)
  if (entry) {
    entry.nodeName = msg.session_id || ''   // ❌ 把 session_id 给了 nodeName
    entry.sessionId = msg.session_id || ''
  }
  writeFn(`\x1b[32m[连接已建立]\x1b[0m ${msg.message || ''}\n`)
  return
}

// 改后
if (msg.type === 'info') {
  const entry = sessions.get(nodeId)
  if (entry) {
    entry.nodeName = msg.node_name || ''     // ✅ 正确的字段
    entry.sessionId = msg.session_id || ''
  }
  writeFn(`\x1b[32m[连接已建立]\x1b[0m ${msg.message || ''}\n`)
  return
}
```

**验证方式：**
1. 打开任意 SSH 终端，顶部栏应显示正确的节点名称
2. `TerminalManage` 页面列表中的节点名称应正确
3. 切换页面再返回，名称不应改变

---

### 🔴 P0-3. 新终端不使用 SSH 连接池（资源浪费）

| 项目 | 内容 |
|------|------|
| **根本原因** | `TerminalHandler` 结构体没有持有 `sshPool` 引用。虽然 `main.go:84` 初始化了 `sshclient.NewPool()`，但 `terminal_handler.go:112` 直接调用了 `NewClientFromNode()`，每次都创建全新 SSH 连接。 |
| **影响范围** | 同服务器打开 N 个终端 = N 个独立 TCP+SSH 连接，浪费连接数、增加延迟、不能复用 keepalive。 |

**修改方案：将连接池注入 TerminalHandler**

**文件 1：** `internal/handler/terminal_handler.go:38-44`

```go
// 改前
type TerminalHandler struct {
    svc         *service.Service
    termManager *terminal.Manager
    serverNode  repository.ServerNodeRepository
    keyRepo     repository.KeyRepository
    upgrader    websocket.Upgrader
}

// 改后
type TerminalHandler struct {
    svc         *service.Service
    termManager *terminal.Manager
    serverNode  repository.ServerNodeRepository
    keyRepo     repository.KeyRepository
    sshPool     *sshclient.Pool        // 新增
    upgrader    websocket.Upgrader
}
```

**文件 2：** `internal/handler/terminal_handler.go:47`

```go
// 改前
func NewTerminalHandler(..., allowedOrigins []string) *TerminalHandler {
    return &TerminalHandler{...}

// 改后
func NewTerminalHandler(..., sshPool *sshclient.Pool, allowedOrigins []string) *TerminalHandler {
    return &TerminalHandler{
        ...
        sshPool: sshPool,
        ...
    }
```

**文件 3：** `internal/handler/terminal_handler.go:111-118`

```go
// 改前
sshClient, err := sshclient.NewClientFromNode(node, h.keyRepo)
if err != nil {
    ws.WriteJSON(gin.H{"type": "error", ...})
    ws.Close()
    return
}
defer sshClient.Close()

// 改后
factory := func() (*sshclient.Client, error) {
    return sshclient.NewClientFromNode(node, h.keyRepo)
}
sshClient, err := h.sshPool.GetOrCreate(uint(nodeID), factory)
if err != nil {
    ws.WriteJSON(gin.H{"type": "error", ...})
    ws.Close()
    return
}
// 注意：不从 pool 中删除，其他终端会话复用同一连接
```

**⚠️ 注意：** 使用连接池后，终端会话之间共享同一 SSH 连接但各自有独立的 `ShellSession`（通过 `sshClient.NewSession()` 创建）。需要确认 `pool.GetOrCreate` 返回的 client 已被 `Connect()` 调用且连接正常。

**文件 4：** `cmd/server/main.go`（构造函数调用处）

```go
// 改前
termHandler := handler.NewTerminalHandler(svc, termManager, repo.ServerNode, repo.Key, allowedOrigins)

// 改后
termHandler := handler.NewTerminalHandler(svc, termManager, repo.ServerNode, repo.Key, sshPool, allowedOrigins)
```

**验证方式：**
1. 打开终端 A 到节点 X → 检查 `pool.clients` 中应有该节点条目
2. 打开终端 B 到同一节点 X → 再次检查 `pool.clients`，条目数不变（复用）
3. 通过 `ssh -p 2222 localhost` 目标服务器观察连接数不应随终端数线性增长

---

### 🔴 P0-4. stdout/stderr 双 goroutine 竞争写 WebSocket（可能花屏）

| 项目 | 内容 |
|------|------|
| **根本原因** | `terminal_handler.go:138-156`（stdout goroutine）和 `terminal_handler.go:159-174`（stderr goroutine）分别读取 SSH 的两个管道，独立调用 `ws.WriteMessage()`。gorilla/websocket 的 `WriteMessage` 虽然是 goroutine-safe（内部有锁），但两个流的数据在 WebSocket 层面的交错会导致前端 xterm.js 收到乱序的字节块，产生花屏。 |
| **影响范围** | 所有同时产生 stdout 和 stderr 输出的命令（编译、错误日志等）在输出量大时出现渲染错乱。 |

**修改方案：合并为一个 goroutine，使用多路复用写入**

```go
// 改前 ── 两个独立 goroutine

// 管道：WebSocket ← SSH stdout
errChan := make(chan error, 2)
go func() {
    buf := make([]byte, 4096)
    for {
        n, readErr := shell.Stdout().Read(buf)
        if n > 0 {
            data := buf[:n]
            if writeErr := ws.WriteMessage(websocket.TextMessage, data); writeErr != nil {
                errChan <- writeErr
                return
            }
        }
        if readErr != nil {
            if readErr != io.EOF {
                errChan <- readErr
            }
            return
        }
    }
}()

// 管道：WebSocket ← SSH stderr
go func() {
    buf := make([]byte, 4096)
    for {
        n, readErr := shell.Stderr().Read(buf)
        if n > 0 {
            data := buf[:n]
            msg, _ := json.Marshal(gin.H{"type": "stderr", "data": string(data)})
            if writeErr := ws.WriteMessage(websocket.TextMessage, msg); writeErr != nil {
                return
            }
        }
        if readErr != nil {
            return
        }
    }
}()
```

```go
// 改后 ── 单 goroutine + io.MultiWriter 模式 或 select 多路复用
// 方案：用一个 channel 序列化 stdout/stderr 写入

output := make(chan []byte, 256)
errChan := make(chan error, 2)

// stdout reader
go func() {
    buf := make([]byte, 4096)
    for {
        n, err := shell.Stdout().Read(buf)
        if n > 0 {
            data := make([]byte, n)
            copy(data, buf[:n])
            output <- data
        }
        if err != nil {
            if err != io.EOF {
                errChan <- err
            }
            return
        }
    }
}()

// stderr reader（加上 JSON 前缀）
go func() {
    buf := make([]byte, 4096)
    for {
        n, err := shell.Stderr().Read(buf)
        if n > 0 {
            raw := buf[:n]
            // 构造 stderr 前缀字节，避免每次 json.Marshal
            prefix := []byte(`{"type":"stderr","data":"`)
            suffix := []byte(`"}`)
            // 简单方案：仍用 json.Marshal 但写入 output channel
            msg, _ := json.Marshal(gin.H{"type": "stderr", "data": string(raw)})
            output <- msg
        }
        if err != nil {
            return
        }
    }
}()

// 单 goroutine 序列化写入 WS
go func() {
    for data := range output {
        if err := ws.WriteMessage(websocket.TextMessage, data); err != nil {
            errChan <- err
            return
        }
    }
}()
```

**注意：** 这引入了新的问题——`output` channel 关闭时机的处理。更简单的替代方案：让 stdout 和 stderr goroutine 仍然存在，但通过同一个 channel 将数据传递给一个序列化的写入 goroutine。

**验证方式：**
1. 在远程服务器执行 `echo "stdout line"; echo "stderr line" >&2`，持续 100 次，检查终端输出无交错花屏
2. 大量输出场景（如 `make 2>&1 | head -1000`）观察渲染正确
3. Go 竞态检测：`go run -race ./cmd/server` 启动后打开终端，验证无 data race

---

### 🔴 P0-5. 读超时被禁用（无法检测死连接）

| 项目 | 内容 |
|------|------|
| **根本原因** | `terminal_handler.go:177` 调用 `ws.SetReadDeadline(time.Time{})`，Go 中 `time.Time{}`（零值）表示**禁用超时**。同时 `pong handler`（178-181行）也做同样的操作。这导致后端无法检测到客户端连接断开（如浏览器休眠、网络断开）。 |
| **影响范围** | 僵尸会话堆积。SSH 连接、PTY、goroutine 全部无法被回收，直到 TCP 层面超时（通常 10 分钟以上）。 |

**修改方案：设置合理的读超时，ping/pong 重置**

```go
// 改前
ws.SetReadDeadline(time.Time{})
ws.SetPongHandler(func(string) error {
    ws.SetReadDeadline(time.Time{})
    return nil
})

// 改后
const (
    pongWait   = 60 * time.Second // 等待 pong 的最大时间
    pingPeriod = 30 * time.Second // 前端 ping 间隔
)

ws.SetReadDeadline(time.Now().Add(pongWait))
ws.SetPongHandler(func(string) error {
    ws.SetReadDeadline(time.Now().Add(pongWait))
    return nil
})
```

**验证方式：**
1. 打开终端 → 断开客户端网络（如关闭 WiFi）→ 等待 60-70 秒 → 后端应自动关闭该会话并清理资源
2. `slog.Info` 日志中应出现 "ws read error" 和 "i/o timeout" 字样
3. `termManager.Count()` 在断线后应减少

---

## P1 — 强烈建议修复

---

### 🟡 P1-1. GenerateID 潜在会话 ID 碰撞

| 项目 | 内容 |
|------|------|
| **根本原因** | `internal/terminal/manager.go:115` 使用 `time.Now().UnixNano()`，Windows 上实际精度约 100ns，同时打开时 ID 可能相同。 |
| **影响范围** | 极低概率但破坏性大——被覆盖的会话变成孤儿，资源泄漏。 |

**修改方案：引入计数器或 UUID**

```go
// 改前
func GenerateID(nodeID uint) string {
    return fmt.Sprintf("term_%d_%d", nodeID, time.Now().UnixNano())
}

// 改后：引入原子计数器保证唯一性
var idCounter atomic.Uint64

func GenerateID(nodeID uint) string {
    n := idCounter.Add(1)
    // 格式：term_{nodeID}_{时间戳}_{序列号}
    return fmt.Sprintf("term_%d_%d_%d", nodeID, time.Now().UnixNano(), n)
}
```

**验证方式：**
1. 模拟高并发（100 个 goroutine 同时调用 `GenerateID`），验证无重复 ID
2. 单元测试验证格式和唯一性

---

### 🟡 P1-2. 无输入速率控制/粘贴大文本问题

| 项目 | 内容 |
|------|------|
| **根本原因** | 前端 `TerminalPage.tsx:164-168` 每个按键触发独立 WebSocket 消息。粘贴时瞬间生成大量消息。单字符 JSON 开销 50x。 |
| **影响范围** | 弱网环境下粘贴大文本丢帧，高延迟连接下交互卡顿。 |

**修改方案：前端输入批处理**

**文件：** `web/src/pages/TerminalPage.tsx`

```typescript
// 改前
const inputHandler = term.onData((data) => {
  const entry = termStore['getOrCreate'](nodeId)
  if (entry.ws && entry.ws.readyState === WebSocket.OPEN) {
    entry.ws.send(JSON.stringify({ type: 'input', data: { text: data } }))
  }
})

// 改后：加入批处理
let inputBuffer = ''
let inputTimer: ReturnType<typeof setTimeout> | null = null

const flushInput = () => {
  if (inputBuffer) {
    const entry = termStore['getOrCreate'](nodeId)
    if (entry.ws && entry.ws.readyState === WebSocket.OPEN) {
      entry.ws.send(JSON.stringify({ type: 'input', data: { text: inputBuffer } }))
    }
    inputBuffer = ''
  }
  inputTimer = null
}

const inputHandler = term.onData((data) => {
  inputBuffer += data
  if (!inputTimer) {
    inputTimer = setTimeout(flushInput, 20) // 20ms 窗口
  }
})
```

**验证方式：**
1. 快速输入 "hello world"，观察 WebSocket 消息数量应少于 5 条（之前需 11 条）
2. 粘贴 1000 字符文本，消息数应约为 1 条（之前需 1000 条）
3. 慢速交互（逐字输入）仍应保持实时响应（≈20ms 延迟）

---

### 🟡 P1-3. stderr ANSI 包裹导致颜色冲突

| 项目 | 内容 |
|------|------|
| **根本原因** | `terminal_handler.go:165` 在 stderr 字节外包了一层 `\x1b[31m...\x1b[0m`。如果远程 PTY 的 stderr 已有 ANSI 颜色，外层的 `\x1b[0m` 会重置掉内部的颜色设置。 |
| **影响范围** | stderr 的颜色/格式信息丢失，对调试体验有影响。 |

**修改方案：移除外层 ANSI 包裹，改由前端按 stderr 通道渲染**

**文件：** `internal/handler/terminal_handler.go`

```go
// 改前
msg, _ := json.Marshal(gin.H{"type": "stderr", "data": string(data)})

// 改后：发送 stderr JSON 标记，但不在数据中加 ANSI 前缀
// 远程 PTY 已经处理了颜色——原样转发即可
msg, _ := json.Marshal(gin.H{"type": "stderr", "data": string(data)})
// 注意：这里的 data 是原始二进制，不要加 \x1b[31m 包裹
```

**文件：** `web/src/stores/terminalStore.ts:113-115`

```typescript
// 改前
if (msg.type === 'stderr') {
  const text = `\x1b[31m${msg.data}\x1b[0m`
  writeFn(text)
  appendBuffer(nodeId, text)
  return
}

// 改后：模拟终端 app 样式 - stderr 在 xterm.js 中用红色光标/背景标记
// 但不在数据本身添加 ANSI 序列，避免与远程已有的 ANSI 冲突
if (msg.type === 'stderr') {
  writeFn(msg.data)       // 原样写入，远程 PTY 已有颜色
  appendBuffer(nodeId, msg.data)
  return
}
```

**验证方式：**
1. 执行一个 stderr 有颜色的命令（如 `echo -e "\033[32mgreen error\033[0m" >&2`），颜色应正确显示
2. 执行 `ls nonexistent`，错误信息应为默认红色（由远程 shell 或 bash 控制）

---

### 🟡 P1-4. 无会话空闲超时

| 项目 | 内容 |
|------|------|
| **根本原因** | `internal/terminal/manager.go` 的 Session 没有空闲超时机制，存活时间无限。 |
| **影响范围** | 用户打开终端后关闭浏览器 → 会话永远驻留。累积到一定数量后消耗系统资源。 |

**修改方案：添加会话空闲超时**

**文件：** `internal/terminal/manager.go`

新增结构体字段和清理协程：

```go
// 新增：会话配置
type ManagerConfig struct {
    IdleTimeout time.Duration // 0 = 不超时
}

type Manager struct {
    mu       sync.RWMutex
    sessions map[string]*Session
    config   ManagerConfig
}

func NewManager(config ManagerConfig) *Manager {
    m := &Manager{
        sessions: make(map[string]*Session),
        config:   config,
    }
    if config.IdleTimeout > 0 {
        go m.cleanupLoop()
    }
    return m
}

func (m *Manager) cleanupLoop() {
    ticker := time.NewTicker(1 * time.Minute)
    defer ticker.Stop()
    for range ticker.C {
        m.cleanupIdle()
    }
}

func (m *Manager) cleanupIdle() {
    m.mu.Lock()
    defer m.mu.Unlock()
    now := time.Now()
    for id, s := range m.sessions {
        if now.Sub(s.LastActivity) > m.config.IdleTimeout {
            if s.shell != nil {
                s.shell.Close()
            }
            close(s.cancel)
            delete(m.sessions, id)
            slog.Info("idle terminal session closed", "session_id", id, "idle", m.config.IdleTimeout)
        }
    }
}
```

**文件：** `cmd/server/main.go` 初始化处：

```go
// 改前
termManager := terminal.NewManager()

// 改后
termManager := terminal.NewManager(terminal.ManagerConfig{
    IdleTimeout: 30 * time.Minute, // 30 分钟空闲超时
})
```

**验证方式：**
1. 打开终端 → 停止操作 → 等待超时时间 → 会话应自动关闭
2. `termManager.Count()` 在超时后减少

---

### 🟡 P1-5. DisconnectSession 不关闭 WebSocket

| 项目 | 内容 |
|------|------|
| **根本原因** | `terminal_handler.go:241-249` 中 `DisconnectSession` 关闭 Shell 但不主动关闭 WebSocket。依赖于 goroutine 链式传播错误来触发 `ws.Close()`，延迟不确定且不可靠。 |
| **影响范围** | 通过 API 断开会话后，浏览器端要等 WebSocket 检测到连接关闭才能感知（可能数秒）。 |

**修改方案：在 Unregister 中加入关闭 WS 的机制**

最简洁的方案是在 `Manager.Unregister` 中关闭 shell 后，通过 `cancel` channel 通知 handle goroutine：

```go
// 改前
func (h *TerminalHandler) DisconnectSession(c *gin.Context) {
    sessionID := c.Param("session_id")
    if s, ok := h.termManager.Get(sessionID); ok {
        _ = s.Shell().Close()
        h.termManager.Unregister(sessionID)
        c.JSON(http.StatusOK, gin.H{"code": 0, "message": "会话已断开"})
    } else {
        c.JSON(http.StatusNotFound, gin.H{"code": 404002, "message": "会话不存在"})
    }
}

// 改后
func (h *TerminalHandler) DisconnectSession(c *gin.Context) {
    sessionID := c.Param("session_id")
    if s, ok := h.termManager.Get(sessionID); ok {
        _ = s.Shell().Close()                    // 关闭 SSH -> 触发 stdout/stderr goroutine 退出
        h.termManager.Unregister(sessionID)      // 关闭 cancel chan -> 主读循环应监听此信号
        c.JSON(http.StatusOK, gin.H{"code": 0, "message": "会话已断开"})
    } else {
        c.JSON(http.StatusNotFound, gin.H{"code": 404002, "message": "会话不存在"})
    }
}
```

主循环需要监听 cancel 信号：

```go
// 主循环改前
for {
    _, msgBytes, err := ws.ReadMessage()
    if err != nil {
        break
    }
    // ...
}

// 主循环改后
readDone := make(chan struct{})
go func() {
    defer close(readDone)
    for {
        _, msgBytes, err := ws.ReadMessage()
        if err != nil {
            return
        }
        // ... 处理消息
    }
}()

select {
case <-readDone:
case <-session.CancelChan(): // 收到取消信号
}
// 此时 ws 会被关闭
```

**验证方式：**
1. 打开终端 → 通过 TerminalManage 页面断开 → 浏览器端应立刻收到 "连接已断开"
2. 观察后端日志，确认清理流程即时完成

---

## P2 — 值得优化

---

### 💭 P2-1. 单字符 JSON 开销大（与 P1-2 输入批处理同步修复）

已在 P1-2 的输入批处理方案中同步解决。批处理后单次发送包含多个字符，JSON 开销占比从 50x 降到接近 1x。

---

### 💭 P2-2. stdout 4KB 固定缓冲区效率

| 项目 | 内容 |
|------|------|
| **根本原因** | `terminal_handler.go:139` 固定 4096 字节缓冲区。大输出时产生大量小 WebSocket 消息。 |
| **影响范围** | 大输出时 WebSocket 帧数多，带宽效率低。 |

**修改方案：增大缓冲区 + 对输出做退避合并**

```go
// 改前
buf := make([]byte, 4096)

// 改后：使用 32KB 缓冲区
buf := make([]byte, 32768)
```

更大的缓冲区意味着每次能从 SSH stdout 管道读取更多数据，减少 WebSocket 消息数量。

**验证方式：**
1. 执行 `dd if=/dev/zero bs=1M count=10`，对比修改前后的 WebSocket 消息数量（预期减少约 8 倍）
2. 验证实时性未受影响（增大缓冲区不增加延迟，因为是 Read 的块大小上限而非最小值）

---

### 💭 P2-3. 日志通道满时静默丢消息

| 项目 | 内容 |
|------|------|
| **根本原因** | `internal/websocket/manager.go:96` Send channel 256 条上限。`manager.go:167-169` 的 `select default` 在满时静默丢弃。 |
| **影响范围** | 部署任务日志不完整。 |

**修改方案：增大 channel + 增加超时**

```go
// 改前
client.Send = make(chan []byte, 256)

// 改后：增大缓冲区
client.Send = make(chan []byte, 4096)
```

同时将 `SendToTask` 从 `select default` 改为等待一小段时间：

```go
// 改前
select {
case client.Send <- data:
default:
}

// 改后
select {
case client.Send <- data:
case <-time.After(100 * time.Millisecond): // 等待 100ms，仍失败则丢弃
    slog.Warn("dropped log message due to slow consumer", "task_id", taskID)
}
```

**验证方式：**
1. 模拟慢消费者（后端限速），观察日志丢失率下降
2. 修改后的 `time.After` 日志应在超时发生时正确记录

---

### 💭 P2-4. scrollback 10000 行不够

| 项目 | 内容 |
|------|------|
| **根本原因** | `TerminalPage.tsx:81` 设置 `scrollback: 10000` |
| **影响范围** | 长时间构建/大输出时，旧输出被丢弃。 |

```typescript
// 改前
scrollback: 10000,

// 改后：提升到 50000
scrollback: 50000,
```

或从 localStorage 读取用户配置：

```typescript
const savedScrollback = parseInt(localStorage.getItem('terminal.scrollback') || '50000', 10)
scrollback: savedScrollback,
```

**验证方式：**
1. 打开终端，执行 `for i in $(seq 1 20000); do echo $i; done`
2. 向上滚动应看到 1-20000 完整输出

---

### 💭 P2-5. 前端 buffer.splice O(n) 操作

| 项目 | 内容 |
|------|------|
| **根本原因** | `terminalStore.ts:62` 使用 `splice` 在数组头部移除元素，JS 引擎需移动后续所有元素。 |
| **影响范围** | buffer 频繁溢出时有微小的 GC 和 CPU 开销。 |

**修改方案：使用固定长度数组 + 移动指针（环形缓冲区）**

```typescript
// 改前
entry.buffer.push(text)
if (entry.buffer.length > bufferSize) {
  entry.buffer.splice(0, entry.buffer.length - bufferSize)
}

// 改后：环形缓冲区
class RingBuffer {
  private buffer: string[]
  private head = 0
  private count = 0
  private capacity: number

  constructor(capacity: number) {
    this.buffer = new Array(capacity)
    this.capacity = capacity
  }

  push(text: string) {
    this.buffer[(this.head + this.count) % this.capacity] = text
    if (this.count < this.capacity) {
      this.count++
    } else {
      this.head = (this.head + 1) % this.capacity
    }
  }

  toArray(): string[] {
    const result: string[] = []
    for (let i = 0; i < this.count; i++) {
      result.push(this.buffer[(this.head + i) % this.capacity])
    }
    return result
  }

  forEach(fn: (text: string) => void) {
    for (let i = 0; i < this.count; i++) {
      fn(this.buffer[(this.head + i) % this.capacity])
    }
  }

  get length() { return this.count }
}
```

**验证方式：**
1. 性能测试：模拟 50000 次 buffer 写入，对比 splice 和 RingBuffer 的执行时间
2. 功能验证：replayBuffer 在两种实现下输出顺序一致

---

### 💭 P2-6. 切换主题后失去焦点

| 项目 | 内容 |
|------|------|
| **根本原因** | `TerminalPage.tsx:209-216` 的 `switchTheme` 未调用 `term.focus()`。 |
| **影响范围** | 每次切换主题后需要手动点击终端才能继续输入。 |

```typescript
// 改前
const switchTheme = useCallback((name: ThemeName) => {
  setThemeName(name)
  if (xtermRef.current) {
    xtermRef.current.options.theme = THEMES[name]
    xtermRef.current.refresh(0, xtermRef.current.rows - 1)
  }
  setShowThemePicker(false)
}, [])

// 改后
const switchTheme = useCallback((name: ThemeName) => {
  setThemeName(name)
  if (xtermRef.current) {
    xtermRef.current.options.theme = THEMES[name]
    xtermRef.current.refresh(0, xtermRef.current.rows - 1)
    xtermRef.current.focus()  // ✅ 恢复焦点
  }
  setShowThemePicker(false)
}, [])
```

**验证方式：**
1. 在终端中输入 "hello" → 切换到 Dracula 主题 → 直接按回车，应能看到空行（注意不要先点击终端）

---

## 实施路线图

### Phase 1 — 安全与正确性（预计 1-2 天）

| 序号 | 问题 | 依赖 | 验证方式 |
|------|------|------|----------|
| 1 | P0-1 SSH 主机密钥验证 | 无 | 单元测试 + MITM 场景手动验证 |
| 2 | P0-2 sessionId → nodeName | 无 | 打开终端检查顶部栏 |
| 3 | P0-5 读超时修复 | 无 | 断开网络等待 60s 检查清理 |
| 4 | P1-1 GenerateID 碰撞 | 无 | 单元测试 |

### Phase 2 — 核心架构修复（预计 2-3 天）

| 序号 | 问题 | 依赖 | 验证方式 |
|------|------|------|----------|
| 5 | P0-3 连接池集成 | P0-4 之后的 shell 复用需确认 | `pool.Count()` 对比终端数 |
| 6 | P0-4 stdout/stderr 合并 | 需重构 `Handle` 方法 | `go run -race` + 花屏测试 |
| 7 | P1-5 DisconnectSession 关闭 WS | P0-4（需理解新的 goroutine 结构） | API 调用后浏览器即时感知 |

### Phase 3 — 体验优化（预计 1-2 天）

| 序号 | 问题 | 依赖 | 验证方式 |
|------|------|------|----------|
| 8 | P1-2 输入批处理 | 无 | WebSocket 消息计数 |
| 9 | P1-3 stderr ANSI 冲突 | 无 | 执行带颜色的 stderr 命令 |
| 10 | P1-4 空闲超时 | 无 | 等待超时时间后检查会话数 |

### Phase 4 — 性能打磨（预计 1 天）

| 序号 | 问题 | 依赖 | 验证方式 |
|------|------|------|----------|
| 11 | P2-2 增大缓冲区 | 无 | 大输出场景消息数对比 |
| 12 | P2-3 日志通道优化 | 无 | 模拟慢消费者 |
| 13 | P2-4 scrollback | 无 | 20000 行输出滚动测试 |
| 14 | P2-5 环形缓冲区 | 无 | 性能基准对比 |
| 15 | P2-6 焦点恢复 | 无 | 主题切换后回车可用 |

---

## 附录：当前终端架构数据流图（标注问题点）

```
┌─ 浏览器 ─────────────────────────────────────────────────────┐
│                                                               │
│  xterm.js (TerminalPage)                                      │
│    │ onData() → ❌ [P1-2] 无批处理，逐字符发送                │
│    │ term.write()                                              │
│    │ ❌ [P2-6] 主题切换失焦                                   │
│    └─ terminalStore ── WS ──┐                                 │
│       ❌ [P0-2] nodeName 错  │                                 │
│       ❌ [P2-5] splice O(n)  │                                 │
└──────────────────────────────┼─────────────────────────────────┘
                               │ WebSocket TextMessage
                               │ JSON: type=input|resize|ping
┌─ Go 后端 ────────────────────┼─────────────────────────────────┐
│                               │                                 │
│  terminal_handler.go Handle()                                   │
│    │ ❌ [P0-3] 不用连接池    │ ❌ [P0-5] 读超时=0              │
│    │ ❌ [P0-1] HostKey跳过   │                                 │
│    └─ sshClient (pool?) ── SSH ── 远程服务器                   │
│       ├─ stdout goroutine ───┐                                 │
│       ├─ stderr goroutine ───┤ ❌ [P0-4] 双 goroutine 竞争     │
│       └─ main read loop ─────┘                                 │
│                                                               │
│  termManager (manager.go)                                      │
│    ❌ [P1-1] ID 碰撞风险                                       │
│    ❌ [P1-4] 无空闲超时                                       │
│                                                               │
│  DisconnectSession API                                        │
│    ❌ [P1-5] 不关 WS                                          │
└───────────────────────────────────────────────────────────────┘
```

---

*文档生成日期：2026-07-09*
*基于代码审查报告 v1.0*
