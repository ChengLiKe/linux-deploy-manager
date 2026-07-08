# Linux Deploy Manager — 全面代码审查报告

> **审查日期**: 2026-07-08
> **审查范围**: 全部 Go 后端（64 文件/7.9K 行）+ React 前端（30 文件/5.5K 行）+ Electron + 构建脚本
> **审查人**: CodeReviewAgent 👁️
> **代码健康度评分**: **72/100** 🔶（基础框架扎实，安全和测试是主要短板）

---

## 目录

1. [总体评估](#1-总体评估)
2. [🔴 高风险问题](#2-高风险问题)
3. [🟡 中风险问题](#3-中风险问题)
4. [💭 低风险 / 改进建议](#4-低风险--改进建议)
5. [模块评分](#5-模块评分)
6. [优先修复事项](#6-优先修复事项)

---

## 1. 总体评估

### 1.1 亮点

- **架构清晰**：Handler → Service → Repository → Model 分层严格，纵向依赖规范，无明显循环依赖或跨层调用
- **跨平台意识强**：`internal/sysutil` 封装平台差异、`proc_unix.go/proc_windows.go` 分离实现、`launch_unix.go/launch_windows.go` 分离实现，Windows 适配考虑全面
- **部署引擎设计良好**：`Executor` 接口抽象了本地/远程执行，`LogBuffer` 实现实时日志推送，WebSocket 集成优雅
- **安全性基础不错**：JWT 签名方法校验（`HMAC`）、bcrypt 密码存储、Token 过期机制都到位
- **SSH 连接池**：`Pool` 有 TTL、清理循环、连接复用合理
- **错误信息不泄露底层细节**：Handler 层只返回通用错误消息，不暴露 SQL/路径细节

### 1.2 主要短板

| 维度 | 状况 | 影响 |
|------|------|------|
| **测试覆盖** | **0%** — 没有任何测试文件 | 🚨 所有代码无任何防护网 |
| **前端 lint** | 无 ESLint/Prettier 配置 | 前端代码质量全靠人工 |
| **密码存储** | SSH 密码明文存 SQLite | 🔴 严重安全隐患 |
| **已废弃代码** | `runCommandLegacy` 286 行死代码 | 混淆逻辑，浪费维护精力 |
| **并发风险** | goroutine 启动后无等待机制 | 主 goroutine 可能提前退出 |
| **代码重复** | `createSSHClient` 在 3 处实现 | 维护成本翻倍 |

---

## 2. 🔴 高风险问题

### 2.1 SSH 密码明文存储

| 字段 | 详情 |
|------|------|
| **位置** | `internal/model/models.go:14` `ServerNode.Password` 字段标记 `json:"-"` 不返回前端，但存入 SQLite 是明文 |
| **相关** | `internal/service/server_node_service.go:55-57` 创建节点时 `node.Password = req.Password` |
| **原因** | 数据库文件（`db.sqlite`）默认权限 `0644`（`main.go:59` AutoMigrate），部分场景可能暴露 |

**建议**：
- 使用 `crypto/aes` 或 `golang.org/x/crypto/nacl/secretbox` 加密存储密码
- 加密密钥从环境变量 `LDM_ENCRYPTION_KEY` 或系统 keyring 读取
- Task service 中已有 `// TODO: 密码解密` 注释（`task_service.go:182`），说明团队已意识到此问题但未实施

**严重程度**: 🔴 高 — 密码泄露直接导致服务器被远程登录

---

### 2.2 WebSocket 无认证鉴权

| 字段 | 详情 |
|------|------|
| **位置** | `cmd/server/main.go:193-194` — WebSocket 路由未通过 `JWTAuth` 中间件 |
| **原因** | `/ws/deploy/:task_id` 和 `/ws/instance-logs/:project_id` 注册在 `r` 而非 `authorized` Group 下，任何人都可连接 |

**建议**：
- 检测 URL 中的 token query 参数
- 或通过 Authorization header 在 Upgrade 时校验
- 实例日志 WebSocket 可泄露项目运行状态和日志内容

**严重程度**: 🔴 高 — 部署日志含 git URL、命令输出等敏感信息

---

### 2.3 CORS 配置过于宽松

| 字段 | 详情 |
|------|------|
| **位置** | `internal/middleware/middleware.go:23-26` — `Access-Control-Allow-Origin` 设置为请求的 Origin，无条件反射 |
| **相关** | `internal/websocket/manager.go:33-35` — `CheckOrigin` 始终返回 `true` |
| **原因** | 开发阶段允许所有来源，但生产环境未加限制 |

**建议**：
- 生产模式设置白名单 `allowedOrigins` 列表
- WebSocket 的 `CheckOrigin` 同源检查

**严重程度**: 🔴 高 — CSRF 攻击可跨站调用 API

---

### 2.4 密码文件权限控制不完整

| 字段 | 详情 |
|------|------|
| **位置** | `internal/auth/auth.go:42` — `os.WriteFile(..., 0600)` 创建时权限正确 |
| **问题** | 但 `main.go:38` `os.MkdirAll(cfg.DataDir, 0750)` 父目录权限是 0750，实际文件权限受 umask 影响：Windows 上完全忽略 0600，Linux 上 umask 0022 → 实际 0644 |

**建议**：
- 创建后 `os.Chmod` 显式设置
- 密码文件（`admin.hash`）和 JWT 密钥文件（`jwt.key`）启动时检查权限

**严重程度**: 🔴 高 — 密码 hash 和 JWT 签名密钥可被同系统其他用户读取

---

### 2.5 goroutine 异步部署无错误传播

| 字段 | 详情 |
|------|------|
| **位置** | `internal/handler/project_handler.go:204-211` — `go func()` 异步执行部署，错误仅更新数据库 |
| **原因** | 异步 goroutine 中的 panic 不会被 Gin 的 Recovery 中间件捕获（不同 goroutine） |

**建议**：
- goroutine 内部添加 `defer recover()` 保护
- 使用 `errgroup` 或 channel 传播错误到主流程
- 或使用结构化的工作队列（推荐：后续可演进为任务队列）

**严重程度**: 🔴 中 — 如果部署逻辑中 panic，整个 goroutine 静默崩溃，用户无感知

---

### 2.6 Shell 注入风险 — 用户输入直接拼接命令

| 字段 | 详情 |
|------|------|
| **位置** | `internal/deployer/deployer.go:790` — `echo '%s' | base64 -d > %s` 中，`remotePath` 和 `content` 直接拼接 |
| **相关** | `internal/deployer/deployer.go:477` — `kill -15 %d` 等命令中的 PID 值 |
| **相关** | `internal/service/server_node_service.go:231` — `echo '%s' | base64 -d > %s` 同样拼接命令 |

**问题**：`content` 字段如果包含 `'`（单引号），会破坏 shell 语法结构。`remotePath` 如果被人为构造（如 `; rm -rf /`），可执行任意命令。

**建议**：
- 使用 `shellquote` 包（`github.com/kballard/go-shellquote`）对参数做 shell 转义
- 或改用 `os/exec` 的参数切片形式（但 SSH 远程执行只能拼字符串，需转义）
- 对 `remotePath` 做路径白名单校验

**严重程度**: 🔴 中 — 攻击面在文件上传/远程文件写入场景

---

### 2.7 `runCommandLegacy` 死代码 + 并发 bug

| 字段 | 详情 |
|------|------|
| **位置** | `internal/deployer/deployer.go:278-360` — 标注为 `Deprecated` 的 `runCommandLegacy` |
| **问题** | 1. 死代码：当前代码库中无任何调用方<br>2. goroutine 泄漏：stdout/stderr 读取 goroutine 在 `cmd.Wait()` 返回后才停止（但无同步机制）<br>3. 环境变量注入 bug：`cmd.Env = append(os.Environ(), ...)` 每次都从 os.Environ 重建，覆盖之前设置的环境变量 |
| **建议** | 删除此函数（已有 `runCommand` 替代），或在 Git 历史中保留 |

**严重程度**: 🔴 中 — 虽未调用，但代码存在会误导维护者使用

---

## 3. 🟡 中风险问题

### 3.1 零测试覆盖

| 字段 | 详情 |
|------|------|
| **位置** | 全局 — 0 个 `_test.go` 文件 |
| **影响** | CI 的 `go test ./...` 步骤运行 0 个测试，每次都是绿色通过，产生虚假安全感 |
| **建议** | 参考 `docs/code-review-standards.md#10-测试要求` 中的路线图，优先从 Service 层开始补测 |

**严重程度**: 🟡 高 — 无测试 = 无重构保障

---

### 3.2 已废弃代码 `GetLogBuffer()`

| 字段 | 详情 |
|------|------|
| **位置** | `internal/deployer/deployer.go:240-243` |
| **问题** | 返回 `nil` 的存根函数，仅用于"兼容旧调用"，但实际仍有调用方 |

**严重程度**: 🟡 低 — 函数存在但无害

---

### 3.3 SSH 连接池 `GetOrCreate` 存在竞态窗口

| 字段 | 详情 |
|------|------|
| **位置** | `internal/remote/sshclient/pool.go:46-75` |
| **问题** | 读锁检查后到写锁创建之间，多个 goroutine 可能同时调用 `factory()` 创建多个连接，然后覆盖彼此 |
| **建议** | 使用 `sync.Map` 或 `singleflight.Group`（`golang.org/x/sync/singleflight`）防止惊群效应 |

**严重程度**: 🟡 中 — 高并发下可能导致多次 SSH 握手

---

### 3.4 日志缓冲区无限增长

| 字段 | 详情 |
|------|------|
| **位置** | `internal/deployer/log_buffer.go` — 未看到大小限制代码 |
| **问题** | 如果部署任务日志量巨大（如 `npm build` 输出数千行），`LogBuffer` 在内存中无限累积 |
| **建议** | 设置最大行数阈值（如 10000 行），超出后截断早期日志 |

**严重程度**: 🟡 中 — 长时间运行可能内存占用过高

---

### 3.5 前端类型定义不完整

| 字段 | 详情 |
|------|------|
| **位置** | `web/src/utils/api.ts:66-75` — `ProjectItem.project` 被声明为 `any` |
| **相关** | `web/src/utils/api.ts:81,83,84` — `create`, `update`, `patch` 使用 `object` 而非具体类型 |
| **问题** | `any` 导致类型检查失效；API 请求体类型不严谨 |
| **建议** | 定义 `CreateProjectRequest` 等具体请求类型，替换 `any`/`object` |

**严重程度**: 🟡 中 — 前端代码易出类型错误

---

### 3.6 `createSSHClient` 代码重复

| 字段 | 详情 |
|------|------|
| **位置** | 三处几乎完全相同的实现：<br>1. `internal/service/server_node_service.go:242-277`<br>2. `internal/service/task_service.go:159-195`<br>3. `internal/connectivity/diagnoser.go:202-240` |
| **问题** | 核心 SSH 客户端创建逻辑重复 3 次，任何修改（如加密、超时调整）都需要三处同步 |
| **建议** | 抽取到 `internal/remote/sshclient` 包作为 `NewClientFromNode(node) (*Client, error)` 公共函数 |

**严重程度**: 🟡 中 — 维护成本高

---

### 3.7 环境变量一致性风险（远程执行时 set + env 混合）

| 字段 | 详情 |
|------|------|
| **位置** | `internal/deployer/remote_executor.go:46` — `wrapRemoteEnv` 通过 `export K=v && cmd` 注入变量 |
| **相关** | `internal/deployer/deployer.go:298-300` — `cmd.Env = append(os.Environ(), ...)` 虽然只在 `runCommandLegacy` 中使用 |
| **问题** | 远程模式下通过 export 注入环境变量，会与本地 `os.Environ()` + `cmd.Env` 不一致，行为差异可能导致部署问题 |
| **建议** | 统一环境变量注入方式：远程用 export，本地用 os.Environ + 追加 |

**严重程度**: 🟡 低 — 仅当命令依赖宿主环境变量时触发

---

### 3.8 前端请求在非 Electron 模式下 `ensureBackendReady` 无意义异步

| 字段 | 详情 |
|------|------|
| **位置** | `web/src/utils/api.ts:14-21` |
| **问题** | `ensureBackendReady` 每次 HTTP 请求都进入拦截器，即使非 Electron 模式也调用 `isElectron()` 和 `Promise.resolve()`，产生微小但可累积的开销 |
| **建议** | 在应用启动时只执行一次 Electron 端口检测，而非每次请求 |

**严重程度**: 💭 低 — 性能影响微乎其微

---

### 3.9 前端代码风格不统一

| 字段 | 详情 |
|------|------|
| **位置** | 多个前端文件 |
| **问题** | 无 ESLint/Prettier 配置，代码风格参差不齐：<br>- `api.ts` 使用 `function` 声明（传统函数）<br>- `DeployModal.tsx` 使用 const 箭头函数<br>- 引号不统一（单引号 vs 双引号）<br>- imports 排序随意 |

**严重程度**: 🟡 低 — 无自动化约束，纯靠人工

---

### 3.10 `nvm`/`conda` 环境创建通过 Shell 执行，无错误处理

| 字段 | 详情 |
|------|------|
| **位置** | `internal/envman/service.go:64-68` — `createNVMEnv` 执行 `nvm install` 但错误写入 `os.Stdout`/`os.Stderr`，而非返回给调用方 |
| **相关** | `createCondaEnv` 和 `createPyenvEnv` 同样问题 |
| **问题** | 错误日志直接打到服务端控制台，客户端无法感知安装失败 |
| **建议** | 改用 `cmd.CombinedOutput()` 捕获输出，返回错误信息给 Handler 层 |

**严重程度**: 🟡 中 — 用户交互体验差

---

### 3.11 前端路由 SPA fallback 潜在的 404 问题

| 字段 | 详情 |
|------|------|
| **位置** | `internal/middleware/middleware.go:68-83` — `ServeEmbed` 中间件 |
| **问题** | 对于 `/api/auth/login` 这类非静态文件请求，`fs.Open(path)` 会失败（因为 `fs` 只包含 `web/dist` 的内容），然后 fallback 到 `index.html`。但 API 路由应该已经在 Gin 路由中匹配到了。不过如果用户输入错误的 API 路径，会得到 HTML 而非 JSON |

**严重程度**: 💭 低 — SPA 常见做法，非严重问题

---

## 4. 💭 低风险 / 改进建议

### 4.1 日志文件永不轮转

```go
// main.go:237-245
func initLogger(logDir string) {
    logFile := filepath.Join(logDir, "app.log")
    f, err := os.OpenFile(logFile, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0644)
    ...
}
```
**问题**: `app.log` 永不轮转，长期运行会无限增长。
**建议**: 使用 `gopkg.in/natefinch/lumberjack.v2` 实现日志自动轮转。

---

### 4.2 前端不处理 WebSocket 连接中断重连

`web/src/hooks/useWebSocket.ts` 和 `useInstanceLogSocket.ts` 中使用 WebSocket，但未看到断线自动重连逻辑。部署日志推送中断后用户需要手动刷新页面。

---

### 4.3 设置 API 不限制 key 值

`PUT /api/v1/settings` 接受任意 `key`/`value`。如果前端通过控制台调用，可以覆盖任意系统配置项（如 sudo 密码等）。建议加一个 `allowedKeys` 白名单。

---

### 4.4 `hashRouter` 的路由重复

`internal/middleware/middleware.go` 中的 SPA 回退逻辑只处理了 `/index.html`，但未处理 `hashRouter` 模式下的路径（如 `/index.html#/login`）。当前前端使用了 hash router 模式，所以不会真正 404，但静态文件直接访问路径时可能出问题。

---

### 4.5 前端 `axios` 请求未捕获网络错误

`api.ts` 的响应拦截器只处理了 `401` 状态码。建议增加对网络错误（`error.code === 'ERR_NETWORK'`）的 Toast 提示。

---

### 4.6 Electron 进程未设置 `process.exit` 清理

`electron/main.js:237-239` — `before-quit` 事件中 kill Go 进程，但如果 Go 进程卡死，`app.exit()` 不会等待它结束。

---

### 4.7 前端 `DeployModal.tsx` 巨组件

`web/src/pages/ProjectForm.tsx` 达 1371 行，是项目最大文件。建议拆分：
- `ProjectForm.tsx` — 表单主体
- 部署配置 → 独立组件
- 环境变量编辑 → 独立组件

---

### 4.8 Go 版本不一致

| 声明位置 | 版本 |
|---------|------|
| `go.mod` | 1.22 |
| `README.md` | 1.23 |
| `CHANGELOG.md` | 1.23 |

统一为 `go.mod` 实际使用的版本（1.22）。

---

### 4.9 Git commit SHA 被静默忽略

```go
// deployer.go:129
commitSHA, _ := gitService.GetCommitSHA(actualCodeDir)
```
错误被静默忽略，`commitSHA` 为空字符串。丢失重要部署溯源信息。

---

### 4.10 前端 Import 路径规则不统一

部分用了相对路径 `../utils/api`，部分用 `./Component`。建议使用 Vite 的 `@/` alias 统一。

---

## 5. 模块评分

| 模块 | 评分 | 关键短板 |
|------|------|----------|
| **认证模块** (`auth/`) | 75/100 🔶 | 密码/JWT 文件权限检查缺失 |
| **配置管理** (`config/`) | 85/100 ✅ | 干净、清晰 |
| **中间件** (`middleware/`) | 70/100 🔶 | CORS 太宽松，无限流 |
| **数据模型** (`model/`) | 80/100 ✅ | 设计合理，但密码明文 |
| **仓库层** (`repository/`) | 90/100 ✅ | 简洁，单一职责 |
| **服务层** (`service/`) | 75/100 🔶 | createSSHClient 重复，测试缺失 |
| **处理器** (`handler/`) | 80/100 ✅ | 异步部署无 recover |
| **部署引擎** (`deployer/`) | 78/100 🔶 | Shell 注入风险，死代码 |
| **SSH 连接池** (`remote/`) | 75/100 🔶 | 竞态条件，InsecureIgnoreHostKey |
| **连通性诊断** (`connectivity/`) | 85/100 ✅ | 设计良好，智能跳过 |
| **WebSocket** (websocket/) | 75/100 🔶 | 无认证，通道容量随意 |
| **环境管理器** (`envman/`) | 70/100 🔶 | 错误输出直接到 stdout |
| **SysUtil** (`sysutil/`) | 85/100 ✅ | 跨平台设计优秀 |
| **Electron** (`electron/`) | 80/100 ✅ | IPC 安全，preload 最小化 |
| **前端代码** (`web/src/`) | 70/100 🔶 | 无 lint/类型不严谨/巨组件 |
| **构建脚本** | 80/100 ✅ | 完整度好 |
| **CI/CD** | 75/100 🔶 | 缺少 lint 步骤和测试覆盖率门禁 |

### 全局总分: **72/100** 🔶

---

## 6. 优先修复事项

### 🔴 第 1 优先级（立即修复 — 安全底线）

| # | 问题 | 预计工时 | 影响模块 |
|---|------|----------|----------|
| 1 | SSH 密码加密存储 | 4h | model, service |
| 2 | WebSocket 添加 JWT 鉴权 | 2h | main.go, websocket, instance_log_handler |
| 3 | CORS 生产环境白名单 | 1h | middleware |
| 4 | JWT/密码文件权限检查 | 1h | auth, main.go |
| 5 | async deploy goroutine 添加 recover | 0.5h | project_handler.go |
| 6 | 远程文件写入 Shell 注入防护 | 1h | deployer, server_node_service |

### 🟡 第 2 优先级（应该修复 — 质量提升）

| # | 问题 | 预计工时 | 影响模块 |
|---|------|----------|----------|
| 7 | Service 层编写第一轮单元测试 | 3d | service/ |
| 8 | 抽取公共 `createSSHClient` | 1h | remote/sshclient |
| 9 | 配置 ESLint + Prettier | 1h | web/ |
| 10 | SSH 连接池 `singleflight` 防惊群 | 1h | remote/sshclient |
| 11 | LogBuffer 设置大小上限 | 0.5h | deployer |
| 12 | envman 错误返回优化 | 1h | envman |
| 13 | 删除 `runCommandLegacy` 死代码 | 0.5h | deployer |

### 💭 第 3 优先级（有空再做）

| # | 问题 | 预计工时 |
|---|------|----------|
| 14 | 日志轮转 | 1h |
| 15 | `ProjectForm.tsx` 拆分为子组件 | 3h |
| 16 | 前端类型定义补充 | 2h |
| 17 | WebSocket 断线重连 | 2h |
| 18 | 统一 Go 版本号（1.22） | 0.5h |
| 19 | `GetLogBuffer()` 空存根清理 | 0.5h |
| 20 | Fetch `GetCommitSHA` 错误处理 | 0.5h |

---

## 总结

**项目基础框架质量不错** — 架构分层清晰、跨平台适配到位、部署引擎设计有想法。主要风险集中在 **安全和测试** 两个维度：

1. **安全方面**：6 个 🔴 问题中有 3 个涉及凭据泄露（密码明文、文件权限、无认证 WebSocket），属于在上线前必须修复的底线问题
2. **测试方面**：0% 覆盖率是最痛的点。建议从 Service 层开始，"新代码必须测 + 改旧代码补测"渐进改善
3. **代码质量**：设计模式（interface 抽象）、并发控制（读写锁使用正确）、错误包装（fmt.Errorf %w）都在线。主要扣分在死代码和代码重复

建议按上述优先级从 🔴 开始逐项处理。先把安全底线守住，然后集中精力在 Service 层写出第一批测试——这是最能快速提升信心的投入。

---

> *本报告由 CodeReviewAgent 自动生成，综合了静态分析、代码审查和质量评估。*
> *建议每个修复项创建独立 Issue，并在修复过程中遵循 `docs/code-review-standards.md` 的审查流程。*
