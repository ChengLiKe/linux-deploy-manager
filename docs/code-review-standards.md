# Linux Deploy Manager — 代码审查标准与流程

> 版本: v1.0 | 生效日期: 2026-07-08
>
> 本文档定义了项目的代码审查规范，所有 Pull Request 必须通过审查方可合并。

---

## 目录

1. [核心理念](#1-核心理念)
2. [审查流程](#2-审查流程)
3. [审查人职责](#3-审查人职责)
4. [严重等级定义](#4-严重等级定义)
5. [Go 后端审查清单](#5-go-后端审查清单)
6. [React 前端审查清单](#6-react-前端审查清单)
7. [Electron 桌面端审查清单](#7-electron-桌面端审查清单)
8. [构建与部署脚本审查清单](#8-构建与部署脚本审查清单)
9. [自动化检查](#9-自动化检查)
10. [测试要求](#10-测试要求)
11. [特殊场景审查](#11-特殊场景审查)
12. [附录](#12-附录)

---

## 1. 核心理念

### 1.1 为什么做 Code Review

代码审查不是"找茬"，而是团队知识传递、质量兜底和设计共识的关键环节。好的审查：

- **发现缺陷** — 在进入生产前拦截 bug 和安全漏洞
- **知识共享** — 让团队成员了解代码变化，减少"只有一个人懂"的知识孤岛
- **统一风格** — 渐进式地让代码库保持一致的风格和架构
- **培养习惯** — 每次审查都是最佳实践的强化训练

### 1.2 基本原则

| 原则 | 说明 |
|------|------|
| **审查代码，不审查人** | 对事不对人，建设性地指出问题 |
| **自动化优先** | 能用工具检查的，绝不靠人工（lint、格式化、类型检查） |
| **小 PR 原则** | 单个 PR 不超过 400 行变更，超出应拆分为多个独立 PR |
| **审查不过夜** | 收到审查请求后，**24 小时内**给出首轮反馈 |
| **作者负责到底** | PR 作者有责任解答疑问、按反馈修改，直到合并或关闭 |
| **双人审查** | 至少一名非作者的团队成员审查后方可合并（紧急 hotfix 可例外） |

### 1.3 审查的三个层次

```
第一层：自动化检查（CI 强制通过）
  ├── go vet / golangci-lint
  ├── 前端构建
  ├── Go 编译
  ├── 单元测试通过
  └── go mod tidy 检查

第二层：人工审查（审查人执行）
  ├── 正确性与逻辑
  ├── 安全性
  ├── 架构与设计
  ├── 可维护性
  ├── 性能
  └── 测试覆盖

第三层：最终验证（作者 / 审查人执行）
  ├── 本地构建验证
  ├── 功能自测
  └── 确认所有 resolved conversation
```

---

## 2. 审查流程

### 2.1 流程图

```
提交 PR
  │
  ▼
[CI 自动化检查] ── 失败 ──→ 修复后重新推送
  │ 通过
  ▼
[指定审查人] ──→ 第一轮审查
  │                      │
  │ 无问题                │ 发现问题
  │                      ▼
  │               [作者修改 / 回复]
  │                      │
  │                      ▼
  │               [审查人重新审查]
  │                      │
  └────────── 循环 ──────┘
        │ 通过
        ▼
    [最终检查]
        │
        ▼
    [合并到目标分支]
```

### 2.2 详细步骤

#### 步骤 1：创建 PR

- 分支命名：`{type}/{short-description}`，如 `feat/deploy-rollback`、`fix/ssh-timeout`、`refactor/handler-error-handling`
- type 遵循 [Conventional Commits](https://www.conventionalcommits.org/)：`feat`、`fix`、`refactor`、`test`、`docs`、`chore`、`perf`、`style`
- PR 标题格式：`{type}({scope}): {简短描述}`，如 `feat(deployer): add rollback support for failed deployments`
- PR 描述必须使用模板填写（详见 [PR 模板](./pull-request-template.md)）
- 将关联的 Issue 链接到 PR

#### 步骤 2：自动化检查（必须全部通过）

| 检查项 | 命令 / 配置 | 说明 |
|--------|-------------|------|
| Go 编译 | `CGO_ENABLED=0 go build ./cmd/server` | 确保编译通过 |
| Go lint | `golangci-lint run ./...` | 12 个 linter 全部通过 |
| Go 测试 | `go test -race -count=1 ./...` | 所有测试通过，无 race condition |
| 前端构建 | `cd web && npm run build` | TypeScript 编译 + Vite 打包 |
| 代码格式化 | `gofmt -d .` | Go 代码格式一致 |
| go mod 一致性 | `go mod tidy -v` | go.mod 与源码一致 |
| 测试覆盖率 | `go test -coverprofile=coverage.out ./...` | 新代码覆盖率 >= 60%（见 [#10 测试要求](#10-测试要求)） |

#### 步骤 3：人工审查

1. 审查人从 **审查清单**（第 5-8 节）逐项检查
2. 在 PR 的 Files Changed 页面逐行评论
3. 使用 [严重等级标签](#4-严重等级定义) 标记每个发现
4. 总体评价后，选择：
   - **Approve** — 代码可合并
   - **Comment** — 有小建议但不阻塞合并
   - **Request Changes** — 存在 🔴 阻塞性问题，必须修改后重新审查

#### 步骤 4：作者响应

- 每个评论必须回复：接受修改 / 解释理由 / 提出替代方案
- 🔴 阻塞性问题必须全部修复
- 🟡 建议性问题至少回应态度（修改或解释原因）
- 💭 非强制性问题可选择性处理

#### 步骤 5：最终合并

- 所有 🔴 阻塞性问题已解决
- 至少一名审查人 **Approve**
- CI 最新一次提交通过
- 分支已 rebase 到目标分支最新提交
- 使用 **Squash Merge** 合并（保持主线整洁）

### 2.3 紧急 Hotfix 流程

当生产环境出现严重问题时，可走加速通道：

1. 在 PR 标题加 `[HOTFIX]` 前缀
2. 单名审查人即可批准
3. 修复上线 24 小时内补开 Issue 跟踪根因
4. Hotfix 仅限 🔴 严重等级问题，不得夹带其他变更

---

## 3. 审查人职责

### 3.1 审查人资格

- **正式审查人**：至少参与过 3 次代码审查的团队成员
- **实习审查人**：新成员在前 3 次审查中以"观察员"身份参与（评论但不做最终批准）
- **Owner LGTM**：涉及架构变更、数据库迁移、认证系统修改时，需要项目 Owner 或 Tech Lead 的额外批准

### 3.2 审查人 checklist（自检）

- [ ] 我理解了 PR 的上下文和业务目标
- [ ] 我读了所有变更文件，没有跳过任何文件
- [ ] 我重点关注了逻辑正确性，不只是格式和命名
- [ ] 我对每个评论都标注了严重等级
- [ ] 我确认所有测试覆盖了关键路径
- [ ] 我考虑了安全影响
- [ ] 我留下了积极反馈（如果代码有亮点）

### 3.3 禁止行为

- ❌ 仅看标题不看代码就 Approve
- ❌ 要求"改成我喜欢的写法"（那是风格偏好，不是代码问题）
- ❌ 一次性在最后提出大量未在审查过程中提及的问题
- ❌ 在未了解 PR 上下文的情况下下结论

---

## 4. 严重等级定义

### 🔴 阻塞 (Blocker)

必须修复，否则不能合并。

| 类别 | 示例 |
|------|------|
| **安全漏洞** | SQL 注入、XSS、CSRF token 缺失、硬编码密钥、越权访问 |
| **数据风险** | 数据丢失、数据损坏、事务处理不当导致脏数据 |
| **功能破坏** | 核心功能不可用、API 接口不兼容、破坏现有行为 |
| **并发问题** | 竞态条件、死锁、共享变量未加锁 |
| **架构违规** | 跳过 Service 层直接从 Handler 操作 Repository、循环依赖 |
| **测试缺失** | 关键逻辑无任何测试（核心路径、安全校验） |

### 🟡 建议 (Suggestion)

建议修复，但如果作者有合理理由可协商。

| 类别 | 示例 |
|------|------|
| **输入验证** | 用户输入缺少参数校验、边界条件未处理 |
| **可维护性** | 命名不清晰、魔法数字、函数过长（>50 行）、重复代码 |
| **错误处理** | 错误被静默忽略、错误信息不明确、未使用错误包装 |
| **性能** | N+1 查询、不必要的内存分配、未使用连接池 |
| **日志** | 缺少关键日志、过度的调试日志进入生产代码 |
| **文档** | 公开 API 缺少注释、复杂逻辑缺少说明 |
| **测试不足** | 已有测试但覆盖率不够、缺少边界测试、未测试错误路径 |

### 💭 非强制 (Nitpick)

可修复可不修复，尊重作者选择。

| 类别 | 示例 |
|------|------|
| **格式** | `linter` 未覆盖的缩进/空格问题 |
| **命名偏好** | 变量名 `s` vs `server`（不影响理解的情况下） |
| **替代方案** | 提供另一种实现思路但不要求修改 |
| **注释** | 注释风格、多了一个空行等小问题 |

---

## 5. Go 后端审查清单

### 5.1 安全

- [ ] **SQL 注入** — 所有 SQL 必须使用参数化查询（GORM 自动参数化，但原生 SQL 需人工检查）
- [ ] **认证/授权** — 每个需要鉴权的路由是否都经过了 `AuthMiddleware`？
- [ ] **JWT 安全** — Token 是否设置了过期时间？签名密钥是否来自安全存储？
- [ ] **SSH 密钥管理** — SSH 私钥是否在内存中正确清理？是否使用了 `defer` 关闭连接？
- [ ] **路径穿越** — 文件操作路径是否使用 `path.Join` / `filepath.Join` 处理？是否有路径穿越风险？
- [ ] **输入验证** — 用户输入（API 参数、WebSocket 消息）是否经过了长度/格式/类型校验？
- [ ] **XSS** — API 返回的数据中，包含用户输入的部分是否在前端进行了转义？

### 5.2 架构与分层

```
router (路由注册)
   │
   ▼
handler (请求解析、参数校验、响应组装)
   │
   ▼
service (业务逻辑、事务管理)
   │
   ▼
repository (数据访问)
   │
   ▼
model (数据模型、数据库交互)
```

- [ ] **层间调用规范**：Handler 只调用 Service 层，不直接调用 Repository；Service 层可跨依赖调用其他 Service
- [ ] **依赖方向**：只允许上层依赖下层，不允许下层依赖上层
- [ ] **DTO 分离**：Model 不应直接暴露给 Handler 层序列化 — 使用 response/request DTO 结构体
- [ ] **循环依赖**：新增的包引入是否产生了循环依赖？使用 `go mod graph` 检查

### 5.3 错误处理

- [ ] **错误传递**：错误是否使用了 `fmt.Errorf("context: %w", err)` 包装？是否可以追溯到根因？
- [ ] **错误吞没**：是否有 `_ = doSomething()` 或 `err` 被赋值为 `nil` 后忽略？
- [ ] **Panic 处理**：goroutine 中是否有 `recover` 保护？Gin 中间件是否有 Recovery？
- [ ] **HTTP 错误码**：错误场景是否返回了语义正确 HTTP 状态码（4xx vs 5xx）？
- [ ] **错误信息泄露**：返回给客户端的错误信息是否泄露了内部实现细节（如 SQL 语句、文件路径）？

### 5.4 并发与资源管理

- [ ] **Goroutine 泄露**：启动的 goroutine 是否有退出机制（context cancellation 或 closed channel）？
- [ ] **读写锁**：读多写少的共享变量是否使用了 `sync.RWMutex`？
- [ ] **HTTP Client 复用**：是否复用了 `http.Client`？SSH 连接池是否合理配置？
- [ ] **连接关闭**：`defer` 是否覆盖了所有退出路径？数据库、SSH、WebSocket 连接是否正确关闭？
- [ ] **Context 传递**：所有携带超时的操作（HTTP 请求、数据库查询）是否传递了 `context.Context`？

### 5.5 Go 代码规范

- [ ] **导出标识符**：所有导出的函数、类型、常量是否有 godoc 注释？
- [ ] **未导出错误**：避免导出自定义错误类型；优先使用标准库 `errors.New` 或 `fmt.Errorf` 创建未导出 sentinel error
- [ ] **接口大小**：接口应小（1-3 个方法），避免大接口（interface pollution）
- [ ] **指针 vs 值**：注意 receiver 类型选择。修改状态/包含 `sync.Mutex` 的结构体必须用指针 receiver
- [ ] **零值可用**：优先利用 Go 的零值语义（如 `sync.Mutex` 无需显式初始化）
- [ ] **defer 使用**：资源获取后立即 `defer` 释放，而非在函数末尾自行管理
- [ ] **goroutine 闭包**：goroutine 的闭包中正确捕获循环变量（Go 1.22+ 已修复，但 Go 1.21 及以下需 `:=` 复制）

### 5.6 配置文件与常量

- [ ] **魔法字符串**：配置键名、路由路径、错误消息是否定义为常量？
- [ ] **敏感信息**：密码、Token、密钥是否被硬编码？必须通过环境变量或配置文件注入
- [ ] **配置校验**：启动时是否对关键配置项进行了校验？

---

## 6. React 前端审查清单

### 6.1 安全

- [ ] **XSS 防护**：用户输入渲染是否使用了 `{data}` 而非 `dangerouslySetInnerHTML`？
- [ ] **API Token**：Token 是否安全存储（localStorage vs httpOnly cookie），是否有 CSRF 防护？
- [ ] **敏感数据显示**：密码/密钥等敏感数据是否在 UI 中脱敏展示？

### 6.2 组件设计

- [ ] **组件粒度**：组件职责是否单一？巨型组件是否可拆分为子组件？
- [ ] **状态管理**：组件本地状态 vs 全局状态（Zustand store）边界是否清晰？不应将一切放入全局 store
- [ ] **Props 设计**：boolean props 是否命名清晰（如 `isLoading`、`isDisabled`）？props drilling 是否过深？
- [ ] **副作用管理**：`useEffect` 是否有关联的 cleanup 函数？依赖数组是否正确？
- [ ] **自定义 Hook**：可复用的逻辑是否抽取为自定义 Hook？

### 6.3 性能

- [ ] **不必要的重渲染**：大列表组件是否使用了 `React.memo` 或 `useMemo`？
- [ ] **React Query 使用**：API 调用是否通过 `@tanstack/react-query` 管理缓存而非手动 `useState` + `useEffect`？
- [ ] **图片优化**：大图是否使用懒加载？
- [ ] **debounce/throttle**：搜索输入等高频触发场景是否做了防抖/节流？

### 6.4 TypeScript 类型

- [ ] **any 禁止**：除极少数特殊情况外，禁止使用 `any`。优先使用 `unknown` 后进行类型收窄
- [ ] **API 响应类型**：所有 API 调用是否定义了返回类型？是否在 `web/src/types/index.ts` 中维护类型定义？
- [ ] **Props 类型**：每个组件是否定义了 `Props` 类型？
- [ ] **非空断言**：避免滥用 `!` 非空断言，优先使用类型守卫

### 6.5 代码质量

- [ ] **错误边界**：关键区域是否有 `ErrorBoundary` 包裹？
- [ ] **加载态**：数据加载中是否有 loading spinner 或 skeleton？
- [ ] **空态**：无数据时是否展示了空状态提示，而非白屏？
- [ ] **错误态**：API 失败时是否有用户友好的错误提示？是否区分了网络错误和业务错误？
- [ ] **表单验证**：表单是否在提交前做了完整校验？错误提示是否准确？

---

## 7. Electron 桌面端审查清单

### 7.1 主进程 (electron/main.js)

- [ ] **IPC 安全**：`ipcMain.handle` 是否校验了 `event.senderFrame` 的 origin？是否对渲染进程的输入做了校验？
- [ ] **权限最小化**：`BrowserWindow` 是否禁用了不必要的特性（如 `nodeIntegration: false`、`contextIsolation: true`）？
- [ ] **自动更新**：`electron-updater` 的更新逻辑是否正确处理了下载失败、安装失败等异常？
- [ ] **生命周期**：应用的启动、退出、系统托盘处理是否考虑了所有退出路径？
- [ ] **文件访问**：写文件操作是否使用了 `app.getPath()` 系列方法（而非硬编码路径）？

### 7.2 预加载脚本 (electron/preload.js)

- [ ] **API 暴露最小化**：`contextBridge.exposeInMainWorld` 是否只暴露了必要的 API？
- [ ] **参数校验**：预加载脚本中转发的调用是否做了参数类型校验？

### 7.3 打包配置 (package.json)

- [ ] **文件包含**：`electron-builder` 的 `files` 配置是否只包含了必要的文件？是否不小心包含了 `node_modules` 中的开发依赖？
- [ ] **跨平台**：NSIS（Windows）、DMG（macOS）、deb/AppImage（Linux）的配置是否正确？
- [ ] **后安装脚本**：`afterInstall.sh` / `afterRemove.sh` 是否考虑了系统兼容性？

---

## 8. 构建与部署脚本审查清单

### 8.1 Go 构建脚本 (Makefile)

- [ ] **跨平台兼容**：`go build` 命令是否正确设置了 `GOOS`/`GOARCH`/`CGO_ENABLED`？
- [ ] **依赖顺序**：`build-web` → `copy-web` → `build` 的依赖链是否正确？
- [ ] **延迟变量**：Shell 变量的 `$` 在 Makefile 中是否需要 `$$` 转义？

### 8.2 Windows PowerShell 构建脚本 (build.ps1)

- [ ] **路径格式**：是否使用了正确的 Windows 路径分隔符？
- [ ] **错误处理**：是否使用 `$ErrorActionPreference = 'Stop'`？是否检查了每一步的退出状态？

### 8.3 部署脚本 (deploy.sh / deploy-localhost.sh)

- [ ] **幂等性**：多次运行脚本是否产生相同结果？
- [ ] **错误处理**：是否设置了 `set -e` 或 `set -o pipefail`？关键步骤失败后脚本是否继续执行？
- [ ] **输入清理**：用户输入的变量是否被 Shell 注入？（警惕 `eval`、`$(...)`）

### 8.4 CI/CD (GitHub Actions)

- [ ] **矩阵构建**：跨平台构建矩阵是否覆盖了所有目标平台？
- [ ] **产物传递**：Job 间的产物传递（upload-artifact / download-artifact）是否正确？
- [ ] **密钥管理**：CI 中是否正确使用了 GitHub Secrets？避免日志中打印环境变量值

---

## 9. 自动化检查

### 9.1 CI 检查（必须通过）

以下检查已在 CI 流程中配置，PR 必须全部通过：

```yaml
# 当前 CI 配置可以参考 ci.yml，需补充以下检查：
# 1. golangci-lint run ./...      — 现有
# 2. go test -race ./...          — 现有
# 3. go vet ./...                 — 添加到 CI
# 4. go mod tidy -v && git diff --exit-code  — 确保 go.mod 一致性
# 5. cd web && npm run lint       — 需要配置 ESLint
# 6. cd web && npm run build      — 现有
# 7. CGO_ENABLED=0 go build ./cmd/server  — 现有
```

### 9.2 建议本地运行（commit 前）

```bash
# Go
golangci-lint run ./...
go test -race -count=1 ./...

# 前端
cd web && npm run lint
cd web && npm run type-check  # TypeScript 类型检查

# 通用
git diff --check  # 检查空白字符问题
```

### 9.3 需要补充的自动化工具

| 工具 | 用途 | 优先级 |
|------|------|--------|
| **前端 lint** | `web/` 下配置 ESLint + Prettier | 🔴 高 |
| **go vet** CI 步骤 | 补充到 `ci.yml` | 🟡 中 |
| **go mod tidy 检查** | CI 中验证 `go.mod` 一致性 | 🟡 中 |
| **测试覆盖率门禁** | CI 中检查覆盖率是否低于阈值 | 🟡 中 |

---

## 10. 测试要求

### 10.1 总体原则

> **当前测试覆盖率为 0，这是一个需要逐步改善的状态。**
> 新代码必须附带测试，老代码在修改时逐步补测。

### 10.2 测试覆盖目标

| 阶段 | 目标 | 时间线 |
|------|------|--------|
| Phase 0（当前） | 新代码覆盖率 >= 60%，关键路径必须测 | 立即生效 |
| Phase 1 | 整体覆盖率 >= 30% | 1 个月内 |
| Phase 2 | 整体覆盖率 >= 50% | 3 个月内 |
| Phase 3 | 整体覆盖率 >= 70% | 6 个月内 |

### 10.3 测试分层

```
单元测试（占比 ~70%）
  ├── Service 层 === 重点覆盖
  ├── Repository 层
  ├── Handler 层（通过 httptest）
  └── 工具函数

集成测试（占比 ~20%）
  ├── 数据库交互（SQLite in-memory）
  ├── SSH 连接模拟
  └── API 端到端

E2E 测试（占比 ~10%）
  └── 关键用户流程
```

### 10.4 测试审查要求

- [ ] **Happy path** 😊 — 正常流程是否覆盖
- [ ] **Error path** 😱 — 所有可预见的错误路径是否覆盖
- [ ] **Edge cases** — 空值、边界值、超大输入是否覆盖
- [ ] **Table-driven tests** — Go 中是否使用了 table-driven 测试模式减少重复
- [ ] **Mock 使用** — 外部依赖是否通过接口 mock？（推荐使用 `mockgen` 或内联 mock struct）
- [ ] **测试隔离** — 测试之间是否相互独立？（避免共享可变状态）
- [ ] **Race detection** — 涉及并发的测试是否以 `-race` 运行

### 10.5 禁止行为

- ❌ 提交空测试文件（仅有 `package_test` 和 `func Test` 签名）
- ❌ 测试只测了创建不测销毁/清理
- ❌ 测试依赖外部环境（特定端口、网络可达、文件系统权限）
- ❌ 在测试中使用 `time.Sleep` 等待异步操作（应使用等待组或 channel）

---

## 11. 特殊场景审查

### 11.1 数据库迁移

由于项目使用 GORM AutoMigrate（无显式迁移文件），涉及 Model 变更时需审查：

- `AutoMigrate` 是否安全（不会导致数据丢失的列删除或类型变更）？
- 是否有必要提供数据迁移脚本？
- 变更是否向下兼容？

### 11.2 跨平台兼容性

涉及平台特定代码时需审查：

- **平台文件分离**：特定平台的代码是否使用了 `_unix.go` / `_windows.go` 构建标签？
- **SysUtil 包装**：是否通过 `internal/sysutil` 封装了平台差异？避免直接在业务代码中写 `runtime.GOOS` 判断
- **路径处理**：是否使用了 `filepath.Join`（跨平台路径分隔符）而非字符串拼接？
- **行尾处理**：文本处理时是否处理了 Windows 的 `\r\n` vs Linux 的 `\n`？

### 11.3 API 兼容性

- **向后兼容**：修改已有 API 时是否会破坏现有前端调用？
- **版本前缀**：重大变更是否应该使用 `/api/v2/` 新路由？
- **请求/响应结构**：删除或重命名 JSON 字段前是否先废弃（deprecate）再移除？

### 11.4 WebSocket 通信

- **连接生命周期**：客户端断连后服务端是否及时清理了资源？
- **心跳机制**：是否有 ping/pong 检测僵尸连接？
- **消息顺序**：依赖于消息顺序的逻辑是否使用了同步机制？

### 11.5 部署引擎 (deployer/)

这是项目核心模块，需额外关注：

- **超时控制**：部署流程（git clone、预命令、部署命令、后命令）是否有独立超时？
- **进程管理**：后台进程启动后，状态是否正确追踪？SIGTERM → SIGKILL 两级终止是否可靠？
- **Executor 抽象**：`local_executor` 和 `remote_executor` 的行为语义是否一致？
- **日志输出**：部署日志是否完整捕获了 stdout + stderr？是否区分了业务日志和系统日志？

---

## 12. 附录

### 12.1 审查评论格式

每条评论应包含：

```
🔴 **类别：标题**
行号或文件：具体位置

**问题描述：** 为什么这是问题（不要只给结论）

**建议：**
- 方案 1：...
- 方案 2：...

**参考：** （可选）链接到文档或示例代码
```

### 12.2 审查回复模板

作者回复时应表明态度：

```
✅ 已修复 — 已按建议修改 ，请重新审查
💡 有道理，但我选择了另一种方案 — [解释方案]，原因是 [理由]
❓ 这里我没理解，请解释 — [具体疑问]
```

### 12.3 CHANGELOG 约定

每次 PR 合并后，作者应在 `CHANGELOG.md` 中记录变更：

```markdown
## [版本号] - 日期

### Added
- 新功能描述 (#PR编号)

### Changed
- 功能变更描述 (#PR编号)

### Fixed
- Bug 修复描述 (#PR编号)

### Security
- 安全修复描述 (#PR编号)
```

### 12.4 常用 Git 配置

```bash
# 设置 commit 信息模板
git config --local commit.template .gitmessage

# 安装 pre-commit hook（自动化检查）
# .githooks/pre-commit 内容：
#   golangci-lint run ./...
#   go test -race -count=1 ./...
```

### 12.5 参考资源

- [Google's Engineering Practices — Code Review](https://google.github.io/eng-practices/review/)
- [Conventional Commits](https://www.conventionalcommits.org/)
- [Go Code Review Comments](https://github.com/golang/go/wiki/CodeReviewComments)
- [Effective Go](https://go.dev/doc/effective_go)
- [React Code Review Checklist](https://github.com/m3db/react-code-review-checklist)

---

> 本文档是"活文档"，随项目演进持续更新。
> 如有修改建议，请提交 PR 修改本文档。
>
> *最后更新: 2026-07-08 | 维护者: @ChengLiKe*
