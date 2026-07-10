# Git 提交代码审查报告

**审查范围**：最近 20 笔提交（2026-07-08 ~ 2026-07-09）  
**审查工具**：Code Reviewer 专家  
**审查重点**：正确性、安全性、可维护性、性能

---

## 总览

本次审查覆盖了 20 笔提交，按功能可分为三大类：

1. **CI/CD 工作流搭建与修复**（11 笔）— GitHub Actions 从零到正常运行，踩了不少坑
2. **核心功能开发**（7 笔）— Project 重构、终端管理系统、连通性诊断、ServerURLs、目录浏览
3. **小修小补**（2 笔）— Go 版本对齐、IPC 清理

**总体评价**：代码质量整体良好，尤其是 N+1 查询少、错误处理基本到位。但发现了 1 个**严重安全漏洞**（命令注入）和 2 个**逻辑缺陷**。

---

## 提交逐项审查（按时间顺序）

### 1. a85cd24 — CI/CD 工作流初始提交

**摘要**：新增 `.github/workflows/ci.yml` 和 `.github/workflows/release.yml`，集成自动更新功能。

**变更分析**：
- CI 流程三步走：Go 检查 → 前端构建 → 跨平台编译验证，结构合理
- Release 流程三步走：编译 Go 全平台二进制 → 构建前端 → Electron 打包发布

**发现问题**：
🟡 **Node.js 版本锁定 20 过旧** — 后续提交用 8 笔才修复了 Node 20 EOL 引发的各种兼容问题。这是 CI 初始设计欠考虑的典型例子。

---

### 2-11. 8bc16b3 ~ b29f8ae — CI 修复 8 连发

**摘要**：8 笔提交持续修理 CI，涵盖 Node.js 版本升级、artifact 版本兼容、cache 选项、go:embed 编译顺序、gitignore 误排除、npm postinstall 等问题。

**变更分析**：
| 提交 | 修复内容 | 评价 |
|------|---------|------|
| 8bc16b3 | actions 版本升级 | ✅ 必要 |
| d6f403b | Node 20→22, artifact v3→v4 | ✅ 必要 |
| dc85a89 | Node 22→24 | 💭 可以合并到上一提交 |
| 0312b2f | 去掉 cache、分步编译 | 🔧 修复了 setup-node cache 不支持的 bug |
| 986ae65 | 移除 `cache: false` | 🔧 setup-node v4 不支持此配置 |
| e98a5bd | 用 working-directory 替代 cd | ✅ 更简洁 |
| 07544ba | 调试输出 | 💭 本轮调试痕迹应清理 |
| d1534b6 | .gitignore + electron-builder | 🔧 关键修复——.gitignore 误杀了 `cmd/server` |
| fe090ea | Go:embed 编译顺序 | 🔧 前端构建需先于 Go |
| b29f8ae | permissions + Go 安装 | 🔧 必要 |

**发现问题**：
💭 **调试输出残留** — 07544ba 的调试日志在后续提交中未见清理，建议确认 `ci.yml` 中是否有残留的 `echo`/`cat` 调试语句。

---

### 12. f53fe47 — ProjectList + 连通性诊断 + 节点初始化

**摘要**：Template → Project 重命名落地 + 新增 connectivity 诊断包 + nodeinit 引擎 + auth 安全优化。

**变更分析**：
- 新增 72 个文件，6701 行新增，645 行删除
- 核心：`project_handler.go`、`init_handler.go`、`nodeinit/engine.go`、`connectivity/` 全套诊断
- `auth.go` 新增 `writeSecureFile` 双重 chmod 保证 0600

**发现问题**：

🔴 **PATCH 接口逻辑缺陷**
`project_handler.go:98` — `Patch` 方法直接委托给 `Update`，而 `Update` 使用 `CreateProjectRequest`（含 `binding:"required"` 标签）来 `ShouldBindJSON`。Gin 的 `required` 标签会在 JSON 缺少字段时返回验证错误，导致部分更新的 PATCH 请求失败。注释声称"会忽略缺失字段"是错误的。

**解决方案**：PATCH 应使用独立的、所有字段均为 `omitempty` 的请求结构体，或改用 `map[string]interface{}` + 手动字段判断。

🟡 **nodeinit 回滚是"伪回滚"**
`nodeinit/engine.go:275` — `rollback()` 函数只写了日志"已回滚"，没有执行任何真正的回滚操作（如卸载已安装的包、删除已创建的文件）。如果中间步骤失败，已经安装的 Docker、Node.js 等不会被清理。

**解决方案**：要么实现真正的回滚命令，要么将函数名改为 `logRollback` 以反映真实行为。

🟡 **connectivity diagnoser SSH 连接泄漏**
`diagnoser.go:91-92` — D4 步骤创建 SSH 客户端后赋值给 `sshClient`，但 D4 失败的场景下，`sshClient` 可能仍持有未关闭的连接。最后的 `if sshClient != nil && authErr == nil` 只在认证成功时才关闭，认证失败时 D4 内部创建的 client 不会被关闭。

---

### 13. 77e4676 — Go 版本降级 + 依赖项更新

**摘要**：Go 1.25.0 → 1.22，`golang.org/x/sync v0.22.0` → v0.8.0。

**变更分析**：仅 2 个文件各 2 行变更，纯粹是版本对齐。

🟡 **为什么降级？** — 提交信息未说明原因。可能是 1.25 未正式发布或依赖兼容性问题。`golang.org/x/crypto v0.27.0` 保留了，与 Go 1.22 的兼容性需确认。

---

### 14. 12e296e — 版本号更新 + 配置清理

**摘要**：版本号更新至 1.1.1，移除不必要的构建配置。

**变更分析**：`release.yml` 精简 41 行，`package.json` 简化 98 行。

💭 **CHANGELOG 同步** — 版本号更新但 CHANGELOG.md 没有对应记录。建议每次版本号变更同步更新 CHANGELOG。

---

### 15. 965a4bc — ServerNodeList 重构 + 密码解密下沉

**摘要**：移除初始化按钮 + 密码解密逻辑集中到 `from_node.go` + 私钥自动提取公钥。

**变更分析**：
- `from_node.go` 的 `NewClientFromNode` 变为统一入口，自动处理密码解密
- `key_service.go` 的 `ImportKeyRequest.PublicKey` 改为 `omitempty`，支持从 PEM 私钥自动提取公钥

✅ **正面评价**：密码解密逻辑统一到 `from_node.go` 是好的重构——消除了三处散落的重复解密逻辑，用了"先尝试解密、失败用原值"的优雅回退策略。

🟡 **ProjectForm.tsx 大幅重写** — 1458 行变更（+/- 对半），重构了表单提交逻辑和参数顺序。涉及参数顺序的调整若前端已调用但未同时部署，可能导致运行时错误。建议检查前后端部署版本是否对齐。

---

### 16. fd35ede — 版本号更新至 1.1.2

💭 单纯版本号 bump，无代码变更。

---

### 17. 4b3c5af — 大功能：终端 + ServerURLs + InlineBrowser + ConfirmDialog

**摘要**：25 个文件，2176 行新增。核心功能：
- SSH 终端 WebSocket（PTY + resize + 会话管理）
- ServerURLs CRUD（服务器网址管理）
- InlineBrowser（内嵌 iframe 浏览器）
- ConfirmDialog 通用确认弹窗
- 加密密钥持久化到文件

**变更分析**：

🔴 **加密密钥持久化存在竞态条件**
`crypto.go` — `WipeKey()` 清空内存密钥后删除持久化文件。但如果密钥轮换期间 `WipeKey()` 被调用（如进程退出），而新密钥尚未生成，所有已加密的数据将永久无法解密。虽然当前只在进程退出前调用，但该函数的命名和注释未明确说明使用限制。

**解决方案**：在 `WipeKey()` 前确认不再需要旧密钥，或在文档中强调"仅进程退出前调用"的限制。

🟡 **Terminal stderr 写入可能阻塞/死锁**
`terminal_handler.go:164-176` — stderr 转发协程在写入 WebSocket 失败时静默返回，但未通知主循环。如果 WebSocket 已关闭，stdout 转发协程可能阻塞在 `ws.WriteMessage()` 上，导致 goroutine 泄漏。

**问题代码**：
```go
if writeErr := ws.WriteMessage(websocket.TextMessage, msg); writeErr != nil {
    return  // 静默退出，不通知主循环
}
```

**解决方案**：使用 `errChan` 或 `context` 统一通知所有 goroutine 退出。

🟡 **ServerURL Update 无法将 SortOrder 重置为 0**
`serverurl_handler.go` — `UpdateServerURLRequest.SortOrder` 用 `*int` 指针来区分"未传"和"传了 0"是合理的。但 `Create` 请求用 `int` 而非 `*int`，导致前端无法通过 Create 创建 SortOrder=0 的 URL（Go 的零值会覆盖）。这在实际使用中影响不大，算是接口一致性问题。

💭 **electron-builder 自动更新配置膨胀** — `package.json` 中 electron-builder 配置（~80 行）包含了 publish 配置，但 12e296e 提交已大幅简化。建议最终确定 publish 策略后清理冗余配置。

---

### 18. 7eb8b03 — 移除 IPC 处理器

**摘要**：删除 `electron/main.js` 中未使用的 `get-backend-port` IPC handler。

✅ **正面评价**：清理死代码，好的实践。

---

### 19. aa5e73c — ServerURL 路由修复 + stderr 诊断

**摘要**：修复 ServerURL 路由参数名不匹配（`node_id` → `id`）+ Electron 捕获 Go stderr + 自动迁移包含 ServerURL 模型。

**变更分析**：
- 路由参数统一为 `:id` 匹配 Gin 的获取方式
- Electron 侧新增 `goStderr` 捕获，有助于诊断 Go 后端启动失败

✅ **正面评价**：Go stderr 捕获是极好的运维改进——之前 Go 后端静默崩溃时 Electron 只能看到"端口文件未就绪"。

---

### 20. fdcb256 — 本地终端 + Shell 抽象 + 目录浏览

**摘要**：29 个文件，3317 行新增，394 行删除。核心变更：
- 新增 `localshell` 包，支持本地 shell 进程
- `terminal.Shell` 接口抽象，统一 SSH/Local shell
- `LocalTerminalHandler` 本地终端 WebSocket
- `DirBrowser` 目录选择器（远程/本地）
- `terminalStore` 终端缓存机制
- `ListRemoteDir` 服务端目录浏览 API
- SSH 支持回环地址自动降级为本地 shell

**变更分析**：

🟡 **`ListRemoteDir` — 命令注入漏洞**
`server_node_handler.go:181` — 用户输入的 `Path` 直接拼接到 shell 命令中：
```go
cmd := fmt.Sprintf("ls -d %s/*/ 2>/dev/null || echo '__NO_DIRS__'", strings.TrimRight(req.Path, "/"))
```
虽然 `ls -d` 本身是只读操作，但用户提供的路径可能包含 `;`、`|`、`$(...)` 等 shell 特殊字符，导致任意命令执行。例如 `Path= "/tmp; cat /etc/shadow"` 将执行 `ls -d /tmp; cat /etc/shadow/*/ 2>/dev/null || echo '__NO_DIRS__'`。

**解决方案**：
- 使用 `exec.Command("ls", "-d", path)` 避免 shell 解释
- 或使用 `path.Clean()` + 正则校验限制路径字符集（仅允许 `[a-zA-Z0-9_./-]`）
- 或使用 Go 的 `os/exec.Command` + 参数传递

🟡 **本地终端无 PTY 支持**
`localshell/shell.go` — `New()` 创建的是普通 `exec.Cmd` 进程，没有申请 PTY，因此没有行编辑、Tab 补全、信号处理等交互式 shell 体验。而 SSH shell 是通过 `RequestPty` 申请的。

**影响**：本地终端体验显著差于 SSH 终端。建议在 `localshell` 中用 `github.com/creack/pty`（Unix）或 Win32 API（Windows）申请 PTY。

🟡 **`TerminalHandler` 的 SSH 连接泄漏风险**
`terminal_handler.go:152-155` — 重构后 `openShell()` 对 SSH shell 和本地 shell 统一管理。但本地 shell 在 `Close()` 时只调用 `cmd.Process.Kill()`，不处理子进程（如用户 Shell 中启动的 `top`、`vim` 等）。在 Unix 上，这可能导致僵尸进程。

**解决方案**：Unix 上使用进程组管理 `cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}`，Kill 时连子进程一起终止。

💭 **`buildWsUrl` 异步解析的影响**
`TerminalPage.tsx` — `buildWsUrl()` 是异步函数，在 useEffect 中 `await` 后创建 WebSocket。如果 `buildWsUrl` 实现有阻塞或依赖 Electron IPC，终端连接可能出现初始化延迟。建议确认 Electron 环境下 `buildWsUrl` 的实现是否同步可用。

---

## 综合统计

| 严重程度 | 数量 | 关键示例 |
|---------|------|---------|
| 🔴 阻断 | 2 | PATCH 接口缺陷、命令注入漏洞 |
| 🟡 建议 | 8 | 伪回滚、密钥竞态、SSH 连接泄漏等 |
| 💭 小建议 | 5 | 调试残留、CHANGELOG 同步、本地终端 PTY 等 |

## 后续建议

1. **立即修复** `ListRemoteDir` 的命令注入漏洞（最高优先级）
2. **修复** Project PATCH 接口的逻辑缺陷
3. **考虑** 为 `localshell` 增加 PTY 支持以改善本地终端体验
4. **添加测试** — 本次审查范围内未见新增单元测试覆盖终端、诊断等关键链路
5. **文档** — `WipeKey()` 的调用限制应在函数注释中明确指出
