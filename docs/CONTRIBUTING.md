# 贡献指南

> 欢迎贡献代码、报告问题或提出改进建议！

## 📖 目录

1. [行为准则](#1-行为准则)
2. [开始之前](#2-开始之前)
3. [开发环境搭建](#3-开发环境搭建)
4. [代码规范](#4-代码规范)
5. [分支策略](#5-分支策略)
6. [Commit 规范](#6-commit-规范)
7. [提交 PR](#7-提交-pr)
8. [代码审查流程](#8-代码审查流程)
9. [测试要求](#9-测试要求)
10. [文档要求](#10-文档要求)

---

## 1. 行为准则

- **互尊互重**：对事不对人，讨论技术而非人身
- **开放心态**：接受他人的建设性意见
- **知识共享**：乐于分享经验和最佳实践
- **精益求精**：追求代码质量，但也要务实

## 2. 开始之前

### 报告 Bug

- 先搜索已有 Issue 是否已报告
- 使用 Issue 模板，包含：环境信息、复现步骤、期望行为、实际行为
- 如果可以，提供最小复现示例

### 功能建议

- 先开 Issue 讨论，获得维护者反馈后再开始编码
- 说明功能的使用场景和预期收益

## 3. 开发环境搭建

```bash
# 前置要求
# - Go 1.22+
# - Node.js 18+
# - （可选）Docker

# 1. 克隆仓库
git clone https://github.com/ChengLiKe/linux-deploy-manager.git
cd linux-deploy-manager

# 2. 启动后端（支持热重载）
go run ./cmd/server --mode debug --port 8080

# 3. 另一个终端启动前端
cd web && npm install && npm run dev

# 4. 浏览器访问 http://localhost:3000
```

## 4. 代码规范

### Go 后端

- **Go 版本**：1.22+（使用 go.mod 中指定版本）
- **格式化**：`gofmt`（已集成到 `.golangci.yml`）
- **Lint**：`golangci-lint`（12 个 linter），提交前运行：
  ```bash
  golangci-lint run ./...
  ```
- **架构分层**：Handler → Service → Repository → Model
  - Handler：请求参数解析、调用 Service、组装响应
  - Service：业务逻辑、事务管理
  - Repository：数据访问（GORM）
  - Model：数据库模型定义
- **错误处理**：
  - 使用 `fmt.Errorf("context: %w", err)` 包装错误
  - 不要吞没错误
  - 不要向客户端泄露内部错误细节（SQL、文件路径等）
- **并发**：
  - 使用 `context.Context` 传递超时和取消信号
  - goroutine 必须有退出机制
  - 资源获取后立即 `defer` 释放

### 前端

- **类型检查**：TypeScript strict mode
  ```bash
  cd web && npm run type-check
  ```
- **格式化 & Lint**：ESLint + Prettier（需配置，参见 TODO）
- **组件规范**：
  - 每个组件有明确的单一职责
  - 自定义 Hook 封装可复用逻辑
  - API 调用通过 `@tanstack/react-query` 管理
  - 类型定义统一在 `web/src/types/index.ts`
- **禁止**：`any` 类型（极少数例外须加注释）

### 通用

- 提交信息遵循 [Conventional Commits](https://www.conventionalcommits.org/)
- 避免大 PR（单次变更 <= 400 行）
- 涉及跨平台代码，使用 `filepath` 而非路径字符串拼接

## 5. 分支策略

```text
main ———— 稳定版本，只从 develop 合并
   │
develop ——— 开发主线，功能分支从此创建
   │
   ├── feat/my-feature     — 新功能
   ├── fix/bug-description — Bug 修复
   ├── refactor/xxx        — 重构
   ├── test/xxx            — 测试补充
   ├── docs/xxx            — 文档更新
   └── chore/xxx           — 杂项（构建、CI 等）
```

- **`main`**：只接受从 `develop` 的合并。每次合并对应一个版本发布
- **`develop`**：日常开发分支。功能分支完成后合并到此
- **功能分支**：从 `develop` 创建，合并回 `develop`

## 6. Commit 规范

### 格式

```text
<type>(<scope>): <subject>

<body>（可选）

<footer>（可选）
```

### Type 类型

| Type | 说明 | 示例 |
|------|------|------|
| `feat` | 新功能 | `feat(deployer): add rollback support` |
| `fix` | Bug 修复 | `fix(ssh): fix connection timeout` |
| `refactor` | 重构 | `refactor(handler): extract middleware` |
| `test` | 补充测试 | `test(service): add unit tests for deploy` |
| `docs` | 文档 | `docs: add code review standards` |
| `chore` | 杂项 | `chore(ci): add golangci-lint step` |
| `perf` | 性能优化 | `perf(db): add index on status column` |
| `style` | 代码风格 | `style: reformat with gofmt` |

### Scope（可选）

`handler`、`service`、`deployer`、`ssh`、`web`、`electron`、`ci`、`docs`...

### 示例

```
feat(deployer): add support for rollback on deploy failure

When a deployment fails, automatically restore the previous working
version and send a notification via WebSocket.

Closes #42
```

## 7. 提交 PR

### 准备工作

1. 确保分支基于最新的 `develop`：
   ```bash
   git fetch origin
   git rebase origin/develop
   ```

2. 本地验证：
   ```bash
   make lint
   make test
   make build
   ```

3. 尽量压缩成逻辑清晰的 commit（使用 `git rebase -i` 整理）

### 创建 PR

1. 推送到远程：`git push origin feat/my-feature`
2. 创建 Pull Request（使用 [PR 模板](../.github/PULL_REQUEST_TEMPLATE.md)）
3. 添加标签：`feat`、`fix`、`refactor` 等
4. 指派审查人

### PR 合并后的操作

1. 删除远程功能分支
2. 更新本地 `develop` 分支
3. 如果本次变更对用户可见，更新 `CHANGELOG.md`

## 8. 代码审查流程

完整的代码审查标准请参阅 [code-review-standards.md](./code-review-standards.md)。

### 简版流程

```
作者: 提交 PR
  │
CI: 自动化检查 ──> 不通过 → 作者修改
  │ 通过
审查人: 代码审查 ──> 发现问题 → 作者修改 → 重新审查
  │ 通过
审查人: Approve
  │
作者: Squash Merge
```

### 关键约定

- **24 小时内**给出首轮审查反馈
- 至少一名非作者的 **Approve** 方可合并
- 紧急 Hotfix 走加速通道（见审查标准文档）
- 使用 **Squash Merge** 合入 `develop`

## 9. 测试要求

> 当前项目测试覆盖率为 0，正在逐步改善中。

- **新代码必须附带测试**，覆盖率 >= 60%
- **修改已有代码**，如修改的函数缺少测试，需补充后再修改
- **关键路径必须测**：
  - 部署流程（deployer/）
  - 认证逻辑（auth/）
  - SSH 连接管理（remote/）
  - 文件操作（fs/ envman/）
- 测试类型优先级：**单元测试 > 集成测试 > E2E**

### 编写测试

```go
// Go table-driven test 示例
func TestDeployService_Deploy(t *testing.T) {
    tests := []struct {
        name    string
        project model.Project
        wantErr bool
    }{
        {name: "valid project", project: validProject, wantErr: false},
        {name: "missing git URL", project: missingURL, wantErr: true},
        // ...
    }
    for _, tt := range tests {
        t.Run(tt.name, func(t *testing.T) {
            svc := NewDeployService(mockDeployer, mockRepo)
            err := svc.Deploy(context.Background(), tt.project)
            if tt.wantErr && err == nil {
                t.Error("expected error, got nil")
            }
        })
    }
}
```

## 10. 文档要求

- **公开 API**（导出的 Go 函数、前端公共组件）必须有注释
- **复杂逻辑**必须在代码中添加注释解释设计意图
- **外部行为变更**（API 格式、配置项、命令参数）必须在 `CHANGELOG.md` 中记录
- PR 涉及 UI 变更，建议附带截图

---

> **最后更新**: 2026-07-08
>
> 有任何疑问，请开一个 Discussion 或联系维护者 @ChengLiKe
