# 服务器节点管理系统 — 自动化部署与连通性测试设计方案

> **版本**: v1.0  
> **日期**: 2026-07-08  
> **作者**: DevOps Automator  
> **状态**: 设计评审

---

## 目录

1. [现状分析](#1-现状分析)
2. [自动化部署流程设计](#2-自动化部署流程设计)
3. [连通性测试模块设计](#3-连通性测试模块设计)
4. [数据模型变更](#4-数据模型变更)
5. [API 设计](#5-api-设计)
6. [前端交互设计](#6-前端交互设计)
7. [实施路径](#7-实施路径)

---

## 1. 现状分析

### 1.1 已有能力

| 模块 | 状态 | 说明 |
|------|------|------|
| SSH 连接 | ✅ 已有 | `sshclient.Client` 支持 key/password 认证 |
| SSH 连接池 | ✅ 已有 | `Pool` 按 nodeID 管理连接复用，TTL=5min |
| 密钥管理 | ✅ 已有 | 生成 ed25519/RSA 密钥，扫描系统密钥 |
| 密钥下发 | ✅ 已有 | SSH 连接目标服务器 → 写入 ~/.ssh/<name> |
| 部署引擎 | ✅ 已有 | 7 步流程：mkdir → cleanup → git pull → env → pre → deploy → post |
| Executor 接口 | ✅ 已有 | `LocalExecutor` / `RemoteExecutor` 统一抽象 |
| 部署日志 | ✅ 已有 | `LogBuffer` 实时 WebSocket 推送 + 文件持久化 |
| 部署取消 | ✅ 已有 | `deployer.Cancel()` 通过 context 取消 |
| 运行环境检查 | ✅ 已有 | `checkRuntimeEnv()` 检查 node/python/java 等 |
| Docker 检查 | ✅ 已有 | `checkDocker()` 检查 docker + docker-compose |

### 1.2 缺失环节

| 环节 | 问题 | 影响 |
|------|------|------|
| 🔴 **节点环境初始化** | 添加节点后无自动初始化流程 | 新节点需人工登录安装基础软件 |
| 🔴 **依赖安装自动化** | PreDeployCmd 需用户手动编写 | 通用依赖（npm/pip/apt）无标准化处理 |
| 🔴 **配置同步** | 系统设置（sudo 密码等）不同步到远程节点 | 远程部署时 sudo 功能不可用 |
| 🔴 **部署回滚** | 部署失败后无自动回滚 | 坏版本持续运行，需人工干预回退 |
| 🔴 **重试机制** | 任何步骤失败即终止 | 临时网络抖动或资源争用导致部署失败 |
| 🔴 **健康检查** | PostDeployCmd 只执行命令，无结构化健康检查 | 无法确认应用是否真正可用 |
| 🔴 **连通性诊断** | `TestConnection` 只返回"连接失败" | 用户无法定位根因（密钥/防火墙/DNS/端口） |
| 🔴 **节点心跳** | 节点状态仅在手动测试时更新 | 部署时可能发现节点已离线 |
| 🔴 **环境清理** | 旧实例清理后无回收机制 | 磁盘空间可能被旧代码目录长期占用 |
| 🔴 **状态回传** | 部署成功后无自动化通知 | 前端需轮询/用户需手动刷新 |

---

## 2. 自动化部署流程设计

### 2.1 全链路架构

```
┌─────────────────────────────────────────────────────────────────────────┐
│                       自动化部署全链路                                    │
│                                                                         │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐          │
│  │ 节点注册  │───>│ 环境初始  │───>│ 依赖安装  │───>│ 配置同步  │         │
│  └──────────┘    └──────────┘    └──────────┘    └──────────┘          │
│       │                                                       │          │
│       v                                                       v          │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐          │
│  │ 预检查   │<───│ 连通性   │<───│ 健康检查  │<───│ 部署执行  │         │
│  └──────────┘    └──────────┘    └──────────┘    └──────────┘          │
│                                          │                               │
│                                          v                               │
│                                    状态回传                               │
└─────────────────────────────────────────────────────────────────────────┘
```

### 2.2 节点生命周期：分阶段自动化

#### Phase 0: 节点注册（已有）
- 用户填写 Host/Port/User/AuthType
- 创建 `ServerNode` 记录，status = "unknown"
- **增强**: 注册成功后自动触发 Phase 1（可选，用户可以关闭自动初始化）

#### Phase 1: 连通性验证（增强）
- 调用增强连通性诊断（详见第 3 节）
- 诊断通过 → status = "online"
- 诊断失败 → 输出逐项检测报告，status 保持 "unknown"

#### Phase 2: 环境初始化（新增）

**目标**: 确保节点具备运行应用的最小化环境

```yaml
初始化清单:
  - system:
      - hostname 确认
      - 系统架构检测 (x86_64 / aarch64)
      - 磁盘空间检查 (建议 > 5GB 可用)
      - 内存检查 (建议 > 1GB)
      - 时区同步 (默认 UTC+8)
  - ssh:
      - 确认 ~/.ssh 权限正确 (700)
      - 确认 authorized_keys 存在 (密码登录节点也自动配置)
      - 配置 SSH keepalive (ServerAliveInterval=60)
  - runtime:
      - Docker (如需要容器部署): docker-ce + docker-compose-plugin
      - Node.js (如需要): 通过 nvm 安装指定版本
      - Python (如需要): 通过 pyenv/conda 安装
      - Go (如需要): 从官方二进制安装
      - Java (如需要): OpenJDK
  - tools:
      - curl / wget
      - git (>= 2.x)
      - unzip / tar
      - base64 (coreutils)
  - security:
      - iptables / ufw 状态检查
      - SELinux / AppArmor 状态检查
      - 创建部署专用系统用户 (可选)
```

**重试与回滚策略**:
```
初始化流程:
  步骤 1: 系统检测          → 失败: 报告无法满足的最小要求，停止
  步骤 2: 安装必要工具      → 失败: 重试 3 次 (指数退避 1s/3s/9s)，均失败则回滚已安装的包
  步骤 3: 安装运行环境      → 失败: 同上重试 + 回滚步骤 2 和 3
  步骤 4: 安全配置          → 失败: 重试 3 次，回滚所有步骤
  
  回滚机制:
    - 每个步骤开始前记录 checkpoint
    - 步骤失败时按倒序撤销: apt-get remove --purge 或 rm -rf 安装目录
    - 回滚完成时 status = "init_failed"，error_msg 包含完整上下文
```

#### Phase 3: 密钥分发与配置同步（增强）

**已有**:
- 分发 git SSH 密钥到 `~/.ssh/<name>`

**增强**:
- **服务器密钥自动分发**: 添加节点时，自动选择 `KeyType = "server"` 的密钥分发到目标节点
- **SSH 配置优化**:
  ```
  ~/.ssh/config 追加:
  Host github.com
    IdentityFile ~/.ssh/<git-key-name>
    StrictHostKeyChecking accept-new
  
  ~/.ssh/config 追加:
  Host *
    ServerAliveInterval 60
    ServerAliveCountMax 3
  ```
- **系统设置同步**:
  - 传递 sudo 密码加密存储到远程节点临时文件（部署时自动清理）
  - 同步代理配置（HTTP_PROXY / HTTPS_PROXY / NO_PROXY）

**重试与回滚**:
```
同步流程:
  步骤 1: 创建远程 .ssh 目录     → 幂等，可不回滚
  步骤 2: 写入密钥文件            → 失败重试 3 次，回滚: 删除已写入的密钥文件
  步骤 3: 写入 .ssh/config        → 失败重试 3 次，回滚: 删除已追加的 config 内容
  步骤 4: 同步系统设置            → 失败重试 3 次，回滚: 删除远程临时设置文件
  
  幂等性保证:
    - 每次同步前备份远程文件为 .bak.$(timestamp)
    - 回滚时从备份文件恢复
```

#### Phase 4: 预检查（增强）

**已有**:
- `checkRuntimeEnv()`: 检查 node/python 版本
- `checkDocker()`: 检查 docker 版本

**增强**:
```go
type PreCheckResult struct {
    Name    string `json:"name"`     // 检查项名称
    Status  string `json:"status"`   // pass / warn / fail
    Message string `json:"message"`  // 详细说明
    FixCmd  string `json:"fix_cmd"`  // 建议修复命令
}

func (d *Deployer) PreCheck(ctx, executor, cfg) []PreCheckResult {
    results := []PreCheckResult{}
    
    // 1. 磁盘空间
    // 2. 内存
    // 3. 运行时环境版本
    // 4. Docker 可用性（容器模式）
    // 5. Git 仓库可达性（尝试 git ls-remote）
    // 6. .env 文件完整性
    // 7. 端口冲突检查
    // 8. 旧进程/容器状态
}
```

**预检查结果决定后续行为**:
- 全部 pass → 继续部署
- 有 warn → 记录日志，继续部署
- 有 fail → 阻止部署，返回修复建议

#### Phase 5: 部署执行（增强）

**增强内容** - 在已有 7 步流程基础上增加:

```
已有流程:
  0. mkdirRemote
  1. cleanupPreviousInstance    ← 增强: 版本快照 + 备份
  2. git pull                   ← 增强: git stash / 分支保护
  3. write .env                 ← 增强: 从模板自动生成
  4. PreDeployCmd               ← 增强: 超时保护 + 步骤化
  5. deploy (local/container)   ← 增强: 自动选择模式
  6. PostDeployCmd              ← 增强: 结构化健康检查
```

**增强细节**:

##### 5.1 版本快照与备份（新增）
```go
// 部署前创建备份
func (d *Deployer) createSnapshot(ctx, executor, actualCodeDir string, buf *LogBuffer) error {
    // 1. 检查是否有上一版本的代码
    // 2. 如果有，创建 tgz 快照到 <dataDir>/snapshots/<name>/<timestamp>.tar.gz
    // 3. 记录快照元数据到 snapshot 表
    // 4. 保留最近 5 个快照，自动清理更早的快照
}
```

##### 5.2 Git 操作增强
```go
// 增强 git pull
func (d *Deployer) enhancedGitPull(ctx, gitService, cfg) error {
    // 1. git stash push -m "auto-$(timestamp)"  # 保护本地未提交变更
    // 2. git fetch origin
    // 3. git checkout -B <branch> origin/<branch>  # 强制对齐远程
    // 4. 记录当前 commit SHA 到 task 记录
    // 5. 如果拉取后无新提交，可选跳过后续部署
}
```

##### 5.3 步骤化重试（新增）

引入**步骤状态机**，每个步骤独立配置重试策略:

```go
type StepConfig struct {
    Name        string        // 步骤名称
    Action      func(ctx) error // 执行函数
    RetryCount  int           // 最大重试次数 (默认 3)
    RetryDelay  time.Duration // 重试间隔 (默认 指数退避 1s/3s/9s)
    Timeout     time.Duration // 步骤超时
    Rollback    func(ctx) error // 回滚函数 (可为 nil)
    Critical    bool          // 是否关键步骤 (失败则终止整个部署)
}
```

**步骤化部署执行器**:
```
precheck → snapshot → cleanup → git_pull → env → pre_cmd → deploy → health_check → post_cmd

每步状态: pending → running → success / failed / skipped
```

##### 5.4 自动部署模式选择（新增）

```go
func (d *Deployer) detectDeployMode(ctx, executor, actualCodeDir) string {
    // 1. 检查 docker-compose.yml 存在 → "container"
    // 2. 检查 Dockerfile 存在 → "container" (自动生成 docker-compose.yml)
    // 3. 检查 package.json 存在 → "local" (nodejs)
    // 4. 检查 main.py / requirements.txt → "local" (python)
    // 5. 默认 → "local"
}
```

##### 5.5 结构化健康检查（新增）

```go
type HealthCheck struct {
    Type     string `json:"type"`     // http / tcp / process / command
    Target   string `json:"target"`   // URL: "http://localhost:3000/health"
                                     // Port: "tcp://localhost:3000"
                                     // Process: "node"
                                     // Command: "curl -sf http://localhost:3000/api/health"
    Interval int    `json:"interval"`  // 检查间隔 (秒)
    Retries  int    `json:"retries"`   // 失败重试次数
    Timeout  int    `json:"timeout"`   // 单次超时 (秒)
}

type HealthCheckResult struct {
    Pass    bool   `json:"pass"`
    Latency int64  `json:"latency_ms"`
    Detail  string `json:"detail"`
    Step    string `json:"step"` // "checking", "startup_delay", "active"
}
```

健康检查流程:
```
1. 等待启动延迟 (默认 5 秒)
2. 循环执行健康检查 (默认 30 秒超时)
3. 每次检查: 发送 HTTP GET / 建立 TCP 连接 / 查找进程 PID / 执行命令
4. 检查通过 → 部署完成
5. 达到最大重试 → 触发回滚
```

#### Phase 6: 状态回传（增强）

**已有**: 部署任务写入 DB，WebSocket 实时推送日志

**增强**:

```yaml
状态回传通道:
  - WebSocket (实时):
      - task_status: pending → running → checking → success/failed/rolled_back
      - task_progress: { "step": "git_pull", "percent": 45, "message": "正在拉取代码..." }
      - task_log: 实时日志行 (已有)
  
  - Webhook (异步通知):
      - 部署完成/失败时 POST 到用户配置的 URL
      - Payload: { "task_id", "template_name", "node_name", "status", "commit_sha", "duration_ms", "error_msg" }
  
  - 系统通知 (桌面):
      - Electron 通知栏推送部署结果
```

---

### 2.3 完整的自动化部署状态机

```
                             ┌──────────────┐
                             │  节点注册     │
                             │  status=     │
                             │  unknown     │
                             └──────┬───────┘
                                    │
                                    v
                             ┌──────────────┐
                  ┌──────────│ 连通性诊断    │──────────┐
                  │          │  (Phase 1)   │          │
                  │          └──────┬───────┘          │
                  │                 │ 成功              │ 失败
                  v                 v                   v
           ┌──────────────┐ ┌──────────────┐  ┌──────────────┐
           │ 跳过初始化   │ │ 环境初始化   │  │ status=      │
           │ (用户选择)   │ │ (Phase 2)    │  │ unknown      │
           └──────┬───────┘ └──────┬───────┘  │ 显示诊断报告  │
                  │                │           └──────────────┘
                  │                v
                  │         ┌──────────────┐
                  │         │ 配置同步     │
                  │         │ (Phase 3)    │
                  │         └──────┬───────┘
                  │                │
                  │                v
                  │         ┌──────────────┐
                  │         │ status=      │
                  │         │ online       │
                  │         │ ready        │
                  │         └──────┬───────┘
                  │                │
                  │                v  (用户触发部署)
                  │         ┌──────────────┐
                  │         │ 预检查       │
                  │         │ (Phase 4)    │
                  │         └──────┬───────┘
                  │                │
                  │                v
                  │         ┌──────────────┐
                  │         │ 版本快照     │
                  │         │ (Create)     │
                  │         └──────┬───────┘
                  │                │
                  │                v
                  │         ┌──────────────┐
                  │         │ 执行部署     │
                  │         │ (Phase 5)    │
                  │         └──────┬───────┘
                  │                │
                  │                v
                  │    ┌──────────────┐
                  │    │ 健康检查     │
                  │    │ (Phase 5.5)  │
                  │    └──────┬───────┘
                  │           │
                  │           v
                  │    ┌──────────────┐
                  │    │ 状态回传     │
                  │    │ (Phase 6)    │
                  │    └──────┬───────┘
                  │           │
                  v           v
              ┌────────────────────┐
              │ 部署完成 / 失败     │
              └────────────────────┘
```

### 2.4 部署回滚机制

#### 触发条件

| 触发点 | 行为 |
|--------|------|
| Git pull 后测试失败 | 保留旧代码目录，不切换 |
| PreDeployCmd 失败 | 回滚到快照 |
| 部署命令失败 | 自动回滚 |
| 健康检查失败 | 自动回滚 |
| 用户手动取消 | 可选回滚 |
| 超时 | 自动回滚 |

#### 回滚策略

```go
type RollbackStrategy int

const (
    RollbackSnapshot  RollbackStrategy = iota // 从快照恢复代码
    RollbackGit                               // git checkout 到上一个 commit
    RollbackContainer                         // docker-compose restart 旧版本
    RollbackSystemd                           // systemctl restart 旧服务
)
```

```
回滚执行流程:
  1. 获取回滚策略 (从任务记录的 snapshot_id 或 commit_sha)
  2. 日志输出: "[Rollback] 开始回滚到 {snapshot/commit}"
  3. 应用回滚:
     - 快照: 解压 tgz 到代码目录
     - Git: git checkout <previous_commit>
     - 容器: docker-compose down && docker-compose -f docker-compose.rollback.yml up -d
     - Systemd: systemctl restart <service> (旧版本仍在)
  4. 重新执行健康检查
  5. 健康检查通过 → 回滚成功
  6. 健康检查失败 → 上报失败 (需要人工介入)
```

#### 回滚防失控

```go
// 最多回滚 3 次，之后锁定需要人工介入
const maxRollbacks = 3
```

---

## 3. 连通性测试模块设计

### 3.1 诊断树结构

```
┌─────────────────────────────────────────────┐
│             连通性诊断 (D1~D9)               │
│                                             │
│  D1. DNS 解析                               │
│      └─ Host → IP 映射检查                  │
│  D2. TCP 连通性                             │
│      └─ Port 22 是否可到达                  │
│  D3. SSH 协议协商                           │
│      └─ 服务器返回 SSH 版本标识             │
│  D4. 认证方式检测                           │
│      ├─ 密钥认证: 私钥格式/权限/算法匹配    │
│      └─ 密码认证: 重试次数/是否被锁         │
│  D5. Shell 可用性                           │
│      └─ 登录后能否执行基本命令              │
│  D6. 文件系统权限                           │
│      └─ 部署目录是否可写                    │
│  D7. 密钥已分发检查                         │
│      └─ 远程 ~/.ssh/ 是否有指定密钥文件     │
│  D8. 代理/网络环境检测                      │
│      └─ HTTP_PROXY / Git 可达性             │
│  D9. 系统资源检查                           │
│      └─ 磁盘/内存/CPU                       │
└─────────────────────────────────────────────┘
```

### 3.2 诊断执行流程

```
                      ┌──────────┐
                      │ 开始诊断  │
                      └────┬─────┘
                           │
                     ┌─────v─────┐
                     │ D1: DNS   │←── host → IP
                     │ 解析      │    失败 → "DNS 解析失败，请检查主机名是否正确"
                     └─────┬─────┘
                           │ 成功
                     ┌─────v─────┐
                     │ D2: TCP   │←── 通过 tcpSynDial 测试
                     │ 连通性    │    失败 → "无法连接到 {host}:{port}，可能原因:"
                     └─────┬─────┘         "1. 防火墙策略拦截 (检查 iptables/ufw)"
                           │ 成功           "2. SSH 服务未启动 (检查 systemctl status sshd)"
                     ┌─────v─────┐         "3. 端口未开放 (检查 port {port} 是否在 Listen)"
                     │ D3: SSH   │←── 连接后读取 banner
                     │ 协议协商  │    失败 → "目标 {host}:{port} 不是 SSH 服务(未返回 SSH banner)"
                     └─────┬─────┘         "建议: 检查端口是否为 SSH 端口，或是否为其他协议服务"
                           │ 成功
                     ┌─────v─────┐
                     │ D4: 认证  │←── 尝试对应认证方式
                     │ 检测      │    失败 → 密钥错误: "私钥 {path} 无法认证"
                     └─────┬─────┘             "可能原因: 公钥未添加到 ~/.ssh/authorized_keys"
                           │ 成功               "或密钥对不匹配"
                     ┌─────v─────┐         → 密码错误: "密码认证失败"
                     │ D5: Shell  │←── 执行 id/echo
                     │ 可用性    │    失败 → "无法启动 shell，检查用户 {user} 的默认 shell"
                     └─────┬─────┘
                           │ 成功
                     ┌─────v─────┐
                     │ D6: 权限  │←── 检查部署目录
                     │ 检查      │    失败 → "部署目录不可写: {dir}"
                     └─────┬─────┘         "建议: chown -R {user}:{user} {dir}"
                           │
                     ┌─────v─────┐
                     │ D7~D9     │←── 按需执行
                     │ 高级诊断   │
                     └───────────┘
```

### 3.3 诊断结果模型

```go
// ConnectivityReport 连通性诊断报告
type ConnectivityReport struct {
    NodeID     uint                `json:"node_id"`
    StartTime  time.Time           `json:"start_time"`
    Duration   time.Duration       `json:"duration_ms"`
    Overall    string              `json:"overall"`    // pass / partial / fail
    Items      []DiagnosticItem    `json:"items"`
    Summary    DiagnosticSummary   `json:"summary"`
}

// DiagnosticItem 单条诊断项
type DiagnosticItem struct {
    ID          string `json:"id"`           // D1, D2, ...
    Name        string `json:"name"`         // DNS 解析, TCP 连通性, ...
    Status      string `json:"status"`       // pass / warn / fail / skip
    Duration    int64  `json:"duration_ms"`
    
    // 详细的诊断结果
    Detail      string `json:"detail"`       // 成功时的具体信息
    Error       string `json:"error"`        // 失败时的错误描述
    
    // 失败修复建议（核心）
    Fixes       []FixSuggestion `json:"fixes"`
    
    // 辅助验证命令（用户可手动执行）
    VerifyCmd   string `json:"verify_cmd"`   // e.g., "ssh -vvv root@host -p 22"
}

// FixSuggestion 修复建议
type FixSuggestion struct {
    Level       string `json:"level"`        // info / warning / critical
    Title       string `json:"title"`        // 修复标题
    Description string `json:"description"`  // 详细描述
    Command     string `json:"command"`      // 建议执行的命令
    Reference   string `json:"reference"`    // 参考文档链接
}

// DiagnosticSummary 诊断摘要
type DiagnosticSummary struct {
    Total   int `json:"total"`
    Passed  int `json:"passed"`
    Warned  int `json:"warned"`
    Failed  int `json:"failed"`
    Skipped int `json:"skipped"`
}
```

### 3.4 各诊断项详细设计

#### D1: DNS 解析

```go
func diagnoseDNS(host string) DiagnosticItem {
    // 1. 尝试 net.LookupHost(host) — 标准 DNS 解析
    // 2. 如果失败，尝试 net.LookupAddr(host) — 反向 DNS（非关键，只 warn）
    // 3. 如果 host 已经是 IP，自动跳过
    
    // 失败原因分类:
    //   - NXDOMAIN → "域名不存在，请检查主机名拼写"
    //   - 超时     → "DNS 服务器无响应，检查 /etc/resolv.conf"
    //   - SERVFAIL → "DNS 服务器异常，可尝试 8.8.8.8 或 114.114.114.114"
    //   - 无 A 记录 → "域名解析成功但无 A/AAAA 记录，检查 DNS 记录类型"
    
    // 修复建议:
    //   Fix 1: dig {host} +short 手动验证
    //   Fix 2: 检查 /etc/hosts 是否存在静态映射
    //   Fix 3: ping {host} 测试网络连通性
}
```

#### D2: TCP 连通性

```go
func diagnoseTCP(host string, port int) DiagnosticItem {
    // 1. 使用 net.DialTimeout 尝试 TCP 连接 (5s 超时)
    // 2. 如果第一步失败，使用 "原始 TCP SYN" 探测（更底层判断）
    // 3. 区分是 connection refused 还是 timeout
    
    // 失败原因分类:
    //   - connection refused: 端口未监听
    //     → "SSH 服务未启动，执行: systemctl status sshd"
    //     → "或者端口 {port} 不是 SSH 端口"
    //   - timeout / no route to host:
    //     → "防火墙策略拦截了 {port} 端口"
    //     → "检查: iptables -L -n | grep {port}"
    //     → "或者: firewall-cmd --list-all"
    //     → "云服务器需检查安全组入站规则"
    //     → "如果启用 SELinux: ausearch -m avc -ts recent"
    //   - i/o timeout (特殊 case):
    //     → "可能为网络环境限制出站连接"
    //     → "建议通过代理或跳板机连接"
    
    // 确定主机是否可达（不关心端口）:
    //   - ping {host} 或 curl --connect-timeout 3 http://{host}:{port}
}
```

#### D3: SSH 协议协商

```go
func diagnoseSSHProtocol(host string, port int) DiagnosticItem {
    // 1. 建立原始 TCP 连接
    // 2. 读取 SSH banner (预期以 "SSH-2.0-" 开头)
    // 3. 发送 SSH 协议版本标识
    // 4. 检查密钥交换算法是否匹配
    
    // 失败原因分类:
    //   - 读取超时 → "服务器未返回 SSH 协议标识，可能该端口不是 SSH 服务"
    //     → "执行: nc -v {host} {port} 查看返回内容"
    //   - 协议版本不匹配:
    //     → "服务器仅支持 SSH-1.x，建议升级"
    //     → "或客户端/服务器密钥交换算法不匹配"
    //   - 服务器返回非 SSH 内容:
    //     → "端口 {port} 可能是 HTTP/gRPC/自定义协议"
    //     → "确认目标端口是否正确"
    
    // 收集信息:
    //   - SSH 服务版本 (OpenSSH_8.9p1, Debian-3)
    //   - 支持的密钥交换算法
}
```

#### D4: 认证检测

```go
func diagnoseAuth(node *ServerNode) DiagnosticItem {
    // 区分两种认证模式
    
    if node.AuthType == "key" {
        // 1. 检查本地私钥文件是否存在、可读
        // 2. 检查私钥文件权限 (应为 600)
        // 3. 解析私钥，确认算法 (ed25519/rsa/ecdsa)
        // 4. 尝试 SSH 公钥认证
        
        // 失败原因分类:
        //   - 私钥权限过大: "私钥文件权限为 {perm}，应为 600"
        //     → "chmod 600 {key_path}"
        //   - 私钥格式错误: "无法解析私钥文件，可能损坏"
        //     → "重新生成密钥对并下发公钥到服务器"
        //   - 算法不被支持: "服务器不支持 {algorithm} 算法"
        //     → "可尝试 ed25519 (优先) 或 RSA 4096"
        //   - 认证被拒: "服务器拒绝了密钥认证"
        //     → "公钥未添加到 ~/.ssh/authorized_keys"
        //     → "检查: cat ~/.ssh/authorized_keys | grep {key_fingerprint}"
        //     → "或者已禁止 pubkey 认证: grep PubkeyAuthentication /etc/ssh/sshd_config"
        //   - 认证超时: "密钥认证尝试超时"
        //     → "考虑 PAM 配置导致的延迟"
    } else {
        // 密码认证
        // 1. 尝试密码认证
        // 2. 检查是否超过登录失败次数
        
        // 失败原因分类:
        //   - 密码错误: "密码认证失败"
        //     → "检查密码是否正确，注意大小写"
        //     → "检查是否启用密码认证: grep PasswordAuthentication /etc/ssh/sshd_config"
        //   - 用户被锁定:
        //     → "用户 {user} 已锁定: passwd -S {user}"
        //     → "尝试解锁: passwd -u {user}"
        //     → "或检查 /etc/shadow 中用户状态"
        //   - 登录失败次数限制: "因多次失败登录被临时封禁"
        //     → "等待 10 分钟后重试，或联系管理员解锁"
        //     → "检查: fail2ban-client status sshd"
    }
}
```

#### D5: Shell 可用性

```go
func diagnoseShell(client *ssh.Client, user string) DiagnosticItem {
    // 1. 执行 "id" 命令
    // 2. 执行 "echo $SHELL" 检查默认 shell
    // 3. 执行 "whoami" 验证登录用户
    // 4. 检查是否为 root (影响部署操作)
    
    // 失败原因分类:
    //   - 无 shell: "SSH 连接成功但无法执行命令"
    //     → "检查用户的 shell 配置: grep {user} /etc/passwd"
    //     → "可能 shell 不存在或不可执行"
    //   - 命令被限制: "执行命令失败，可能被 rbash/restricted shell 限制"
    //     → "检查用户是否被 restricted"
    
    // 收集信息:
    //   - uid, gid, groups
    //   - 默认 shell
    //   - 是否为 sudoer
}
```

#### D6: 文件系统权限

```go
func diagnoseFilesystem(client *ssh.Client, codeDir string) DiagnosticItem {
    // 1. 检查部署目录是否存在，不存在则尝试创建
    // 2. 检查目录写入权限 (touch .ldm-test && rm .ldm-test)
    // 3. 检查磁盘剩余空间
    // 4. 检查 inode 使用率 (df -i)
    
    // 失败原因分类:
    //   - 无写入权限: "目录 {dir} 不可写"
    //     → "chown {user}:{user} {dir}"
    //     → "ls -ld {dir} 查看目录权限"
    //   - 磁盘满: "磁盘使用率 {used}%，剩余空间不足"
    //     → "df -h 查看具体使用情况"
    //     → "清理: apt-get clean, docker system prune"
    //   - inode 用完: "inode 使用率 {used}%，文件数过多"
    //     → "检查: find {dir} -type f | wc -l"
}
```

#### D7: 密钥已分发检查

```go
func diagnoseKeyDistribution(client *ssh.Client, node *ServerNode) DiagnosticItem {
    // 1. 检查远程 ~/.ssh/ 目录下是否存在 git/server 密钥文件
    // 2. 检查 authorized_keys 中是否包含服务器密钥
    // 3. 检查密钥文件权限
    
    // 失败处理:
    //   - 密钥未分发: "节点 {name} 的密钥尚未分发到该服务器"
    //     → "请先下发密钥: [一键下发按钮]"
    //   - 密钥权限错误: "~/.ssh/ 或密钥文件权限不正确"
    //     → "chmod 700 ~/.ssh && chmod 600 ~/.ssh/*"
    //   - authorized_keys 不含公钥:
    //     → "将公钥添加到 ~/.ssh/authorized_keys"
    //     → "cat ~/.ssh/{key_name}.pub >> ~/.ssh/authorized_keys"
}
```

#### D8: 代理/网络环境

```go
func diagnoseNetwork(client *ssh.Client, gitURL string) DiagnosticItem {
    // 1. 检查 HTTP_PROXY / HTTPS_PROXY / NO_PROXY 环境变量
    // 2. 尝试连接 Git 仓库 (git ls-remote)
    // 3. 检查 apt/yum 源可达性 (可选)
    // 4. 检查外部网络 (curl -I https://google.com)
    
    // 失败处理:
    //   - 代理缺失: "需要代理才能访问外部网络"
    //     → "配置代理: export HTTP_PROXY=http://proxy:port"
    //   - Git 不可达: "无法访问 Git 仓库 {gitURL}"
    //     → "检查 DNS 解析 / 代理配置 / Git 密钥是否已下发"
    //   - 内部网络限制: "服务器无法访问外网但内网可达"
    //     → "考虑使用内网 Git 仓库镜像"
}
```

#### D9: 系统资源

```go
func diagnoseSystemResources(client *ssh.Client) DiagnosticItem {
    // 1. 内存: free -m (建议 >= 1GB)
    // 2. CPU: nproc (建议 >= 2 cores)
    // 3. 磁盘: df -h / (建议 >= 5GB)
    // 4. OS: uname -a / cat /etc/os-release
    // 5. 负载: uptime
    // 6. 运行时间
    
    // Warn 级别的检查，不会导致失败:
    //   - 内存 < 512MB → 建议增加内存
    //   - 磁盘 < 1GB → 警告磁盘不足
    //   - CPU < 2 cores → 建议更多核心
    
    // 收集信息用于后续部署决策:
    //   - OS 类型和版本 (影响 apt/yum 命令)
    //   - 架构 (影响二进制构建)
}
```

### 3.5 诊断结果输出格式

```json
{
  "node_id": 1,
  "node_name": "生产服务器-01",
  "host": "192.168.1.100",
  "port": 22,
  "user": "root",
  "auth_type": "key",
  "start_time": "2026-07-08T10:00:00+08:00",
  "duration_ms": 3825,
  "overall": "partial",
  "items": [
    {
      "id": "D1",
      "name": "DNS 解析",
      "status": "skip",
      "duration_ms": 0,
      "detail": "主机名为 IP 地址，跳过 DNS 解析",
      "verify_cmd": ""
    },
    {
      "id": "D2",
      "name": "TCP 连通性",
      "status": "pass",
      "duration_ms": 42,
      "detail": "成功连接到 192.168.1.100:22 (RTT: 42ms)",
      "verify_cmd": "curl --connect-timeout 3 -v telnet://192.168.1.100:22"
    },
    {
      "id": "D3",
      "name": "SSH 协议协商",
      "status": "pass",
      "duration_ms": 15,
      "detail": "服务端: OpenSSH_8.9p1 Ubuntu-3, 协议: SSH-2.0, 支持 ed25519/rsa/ecdsa",
      "verify_cmd": "ssh -v root@192.168.1.100 2>&1 | grep 'SSH\\|remote software version'"
    },
    {
      "id": "D4",
      "name": "认证检测",
      "status": "fail",
      "duration_ms": 3120,
      "error": "密钥认证失败: 服务器拒绝了密钥认证",
      "detail": "私钥 ed25519 指纹: SHA256:xxxx (有效), 服务器 authorized_keys 中未找到匹配公钥",
      "fixes": [
        {
          "level": "critical",
          "title": "下发公钥到服务器",
          "description": "将本地生成的公钥添加到远程服务器的 authorized_keys 文件",
          "command": "ssh-copy-id -i /path/to/key.pub root@192.168.1.100",
          "reference": ""
        },
        {
          "level": "warning",
          "title": "检查 SSH 服务端配置",
          "description": "确认 SSH 服务允许公钥认证",
          "command": "grep PubkeyAuthentication /etc/ssh/sshd_config",
          "reference": ""
        }
      ],
      "verify_cmd": "ssh -vvv -i /path/to/key root@192.168.1.100 -p 22 2>&1 | tail -30"
    },
    {
      "id": "D5",
      "name": "Shell 可用性",
      "status": "skip",
      "duration_ms": 0,
      "detail": "因 D4 失败跳过",
      "verify_cmd": ""
    }
  ],
  "summary": {
    "total": 9,
    "passed": 2,
    "warned": 0,
    "failed": 1,
    "skipped": 6
  }
}
```

### 3.6 诊断引擎实现设计

```go
// ConnectivityDiagnoser 连通性诊断器
type ConnectivityDiagnoser struct {
    repo     repository.ServerNodeRepository
    keyRepo  repository.KeyRepository
    settings *SettingService
}

// DiagnoseConnectivity 执行完整诊断
func (d *ConnectivityDiagnoser) DiagnoseConnectivity(nodeID uint, options *DiagnoseOptions) (*ConnectivityReport, error) {
    node, _ := d.repo.Get(nodeID)
    
    report := &ConnectivityReport{
        NodeID:    nodeID,
        StartTime: time.Now(),
    }
    
    // 按序执行诊断项（后续项依赖前项的结果）
    diagnostics := []DiagnosticStep{
        {ID: "D1", Run: d.diagnoseDNS(node.Host)},
        {ID: "D2", Run: d.diagnoseTCP(node.Host, node.Port)},
        {ID: "D3", Run: d.diagnoseSSHProtocol(node.Host, node.Port)},
        {ID: "D4", Run: d.diagnoseAuth(node)},
        {ID: "D5", Run: d.diagnoseShell(client, node.User)},
        {ID: "D6", Run: d.diagnoseFilesystem(client, codeDir)},
        {ID: "D7", Run: d.diagnoseKeyDistribution(client, node)},
        {ID: "D8", Run: d.diagnoseNetwork(client, gitURL)},
        {ID: "D9", Run: d.diagnoseSystemResources(client)},
    }
    
    for _, step := range diagnostics {
        // 依赖检查：如果 D2 失败，跳过 D3+D4（需要连接）
        // 如果 D4 失败，跳过 D5~D9（需要登录）
        if step.IsSkipped(report) {
            report.Items = append(report.Items, step.SkipItem())
            continue
        }
        
        item := step.Run()
        report.Items = append(report.Items, item)
    }
    
    report.Duration = time.Since(report.StartTime)
    report.Overall = report.calculateOverall()
    report.Summary = report.calculateSummary()
    
    // 更新节点状态
    d.updateNodeStatus(node, report)
    
    return report, nil
}
```

**跳过逻辑**:
```
D2 (TCP) 失败 → 跳过 D3 (SSH), D4 (认证)
D3 (SSH) 失败 → 跳过 D4 (认证)
D4 (认证) 失败 → 跳过 D5~D9 (所有需要登录的检查)
```

---

## 4. 数据模型变更

### 4.1 ServerNode 模型扩展

```go
type ServerNode struct {
    // ... 已有字段 ...
    
    InitStatus      string     `gorm:"size:20;default:'pending'" json:"init_status"`
    // pending / initializing / ready / init_failed
    
    InitVersion     string     `gorm:"size:20;default:''" json:"init_version"`
    // 初始化脚本版本，用于增量更新
    
    LastDiagnosis   string     `gorm:"type:text" json:"last_diagnosis,omitempty"`
    // 上次诊断结果 JSON
    
    HeartbeatAt     *time.Time `json:"heartbeat_at"`
    // 上次心跳时间
    
    Labels          string     `gorm:"type:text" json:"labels,omitempty"`
    // 标签 JSON: {"env": "prod", "region": "cn-hz"}
}
```

### 4.2 新增 Snapshot 模型

```go
type DeploySnapshot struct {
    ID         uint      `gorm:"primaryKey" json:"id"`
    TaskID     uint      `gorm:"not null;index" json:"task_id"`
    TemplateID uint      `gorm:"not null;index" json:"template_id"`
    NodeID     *uint     `json:"node_id"`
    
    SnapshotPath string `gorm:"size:4096;not null" json:"snapshot_path"`
    // <dataDir>/snapshots/<template>/<timestamp>.tar.gz
    
    CommitSHA   string `gorm:"size:40" json:"commit_sha"`
    // 快照时的 commit
    
    FileSize    int64  `json:"file_size"`
    // 快照文件大小
    
    CreatedAt   time.Time `json:"created_at"`
}
```

### 4.3 新增 NodeInitLog 模型

```go
type NodeInitLog struct {
    ID         uint      `gorm:"primaryKey" json:"id"`
    NodeID     uint      `gorm:"not null;index" json:"node_id"`
    Phase      string    `gorm:"size:20;not null" json:"phase"`
    // system / runtime / tools / security / config_sync
    
    Status     string    `gorm:"size:20;not null" json:"status"`
    // running / success / failed / rolled_back
    
    StepIndex  int       `json:"step_index"`
    StepName   string    `gorm:"size:100" json:"step_name"`
    Output     string    `gorm:"type:text" json:"output"`
    ErrorMsg   string    `gorm:"type:text" json:"error_msg"`
    
    StartedAt  time.Time `json:"started_at"`
    EndedAt    *time.Time `json:"ended_at"`
}
```

### 4.4 新增 WebhookConfig 模型

```go
type WebhookConfig struct {
    ID       uint   `gorm:"primaryKey" json:"id"`
    Name     string `gorm:"size:50;not null" json:"name"`
    URL      string `gorm:"size:1024;not null" json:"url"`
    Secret   string `gorm:"size:255" json:"secret"`    // HMAC 签名密钥
    Events   string `gorm:"size:255;not null" json:"events"`
    // deploy_success,deploy_failed,node_offline,node_online
    
    RetryCount int  `gorm:"default:3" json:"retry_count"`
    Enabled    bool `gorm:"default:true" json:"enabled"`
    CreatedAt  time.Time `json:"created_at"`
    UpdatedAt  time.Time `json:"updated_at"`
}
```

---

## 5. API 设计

### 5.1 新增 API

| 方法 | 路由 | 说明 |
|------|------|------|
| **节点管理** | | |
| `POST` | `/api/v1/server-nodes/:id/init` | 触发节点环境初始化 |
| `GET` | `/api/v1/server-nodes/:id/init-log` | 获取初始化日志 |
| `POST` | `/api/v1/server-nodes/:id/init/retry` | 重试失败的初始化 |
| `GET` | `/api/v1/server-nodes/:id/diagnose` | 执行连通性诊断 |
| `POST` | `/api/v1/server-nodes/:id/heartbeat` | 节点心跳（由节点侧调用） |
| `GET` | `/api/v1/server-nodes/:id/heartbeat-status` | 查看节点心跳状态 |
| **部署增强** | | |
| `POST` | `/api/v1/projects/:id/precheck` | 部署预检查 |
| `POST` | `/api/v1/deploy/:id/rollback` | 执行回滚 |
| `GET` | `/api/v1/deploy/:id/snapshots` | 获取部署快照列表 |
| `GET` | `/api/v1/deploy/:id/steps` | 获取步骤化部署状态 |
| **Webhook** | | |
| `GET` | `/api/v1/settings/webhooks` | 列出 Webhook 配置 |
| `POST` | `/api/v1/settings/webhooks` | 创建 Webhook |
| `PUT` | `/api/v1/settings/webhooks/:id` | 更新 Webhook |
| `DELETE` | `/api/v1/settings/webhooks/:id` | 删除 Webhook |
| `POST` | `/api/v1/settings/webhooks/:id/test` | 测试 Webhook |

### 5.2 诊断 API 响应示例

```json
POST /api/v1/server-nodes/1/diagnose
Response:
{
  "code": 0,
  "data": {
    "report": { /* ConnectivityReport JSON */ },
    "node_status": "offline"
  }
}
```

---

## 6. 前端交互设计

### 6.1 连通性诊断页面

```
┌─────────────────────────────────────────────────────────────┐
│  🔌 节点连通性诊断 — 生产服务器-01 (192.168.1.100)          │
│  ├─────────────────────────────────────────────────────────┤
│  │ 诊断概要                                                │
│  │  ┌────────────────────────────────────────────────────┐ │
│  │  │  ✅ 通过: 2  ⚠️ 警告: 0  ❌ 失败: 1  ⏭️ 跳过: 6  │ │
│  │  │  耗时: 3.8s                    开始时间: 10:00:00 │ │
│  │  └────────────────────────────────────────────────────┘ │
│  │                                                         │
│  │ 诊断详情                                                │
│  │  ┌────────────────────────────────────────────────────┐ │
│  │  │ ✅ D1 DNS 解析             <1ms   已跳过 (IP地址)  │ │
│  │  │ ✅ D2 TCP 连通性           42ms  ✓ 22端口可达      │ │
│  │  │    └─ RTT: 42ms, 目标存活                          │ │
│  │  │ ✅ D3 SSH 协议协商         15ms  ✓ SSH-2.0         │ │
│  │  │    └─ OpenSSH_8.9p1, 支持 ed25519/rsa              │ │
│  │  │ ❌ D4 认证检测              3.1s ✗ 密钥认证失败    │ │
│  │  │    └─ 私钥未在 authorized_keys 中找到               │ │
│  │  │    └─ 🔧 [一键修复] 下发公钥到服务器                │ │
│  │  │    └─ 或手动执行: ssh-copy-id -i key root@host     │ │
│  │  │ ⏭️ D5 Shell 可用性         跳过 (认证失败)         │ │
│  │  │ ⏭️ D6 文件系统权限         跳过 (认证失败)         │ │
│  │  │ ...                                                │ │
│  │  └────────────────────────────────────────────────────┘ │
│  │                                                         │
│  │  [🔄 重新诊断]  [📋 复制报告]  [🔧 一键修复全部]      │
│  └─────────────────────────────────────────────────────────┘
```

### 6.2 节点状态页面

```
┌─────────────────────────────────────────────────────────────┐
│  🖥️ 节点详情 — 生产服务器-01                              │
│  ├─────────────────────────────────────────────────────────┤
│  │ 基本信息                                                │
│  │  Host: 192.168.1.100  Port: 22  User: root             │
│  │  认证: SSH 密钥 状态: 🟢 Online                         │
│  │                                                         │
│  │ 初始化状态                                              │
│  │  ┌────────────────────────────────────────────────────┐ │
│  │  │ 🟢 就绪 (v1.2)  │  [重新初始化]  [查看日志]        │ │
│  │  │ ── 系统检测  ✅                                  │ │
│  │  │ ── 工具安装  ✅ (git/curl/unzip/base64)           │ │
│  │  │ ── 运行环境  ✅ (Node.js 20.x via nvm)            │ │
│  │  │ ── Docker    ⚠️ (已安装，服务未启动)              │ │
│  │  │ ── 配置同步  ✅                                  │ │
│  │  └────────────────────────────────────────────────────┘ │
│  │                                                         │
│  │ 连接状态                                                │
│  │  ┌────────────────────────────────────────────────────┐ │
│  │  │ 上次连接成功: 2分钟前   心跳: 🟢 30秒前            │ │
│  │  │ 部署历史: 成功 12 次  失败 1 次                    │ │
│  │  └────────────────────────────────────────────────────┘ │
│  │                                                         │
│  │  [🔌 诊断工具]  [🔄 测试连接]  [📦 下发密钥]          │
│  └─────────────────────────────────────────────────────────┘
```

### 6.3 部署流程进度条

```
部署任务 #42 — MyApp
┌─────────────────────────────────────────────────────────────┐
│ Step 1/9: 预检查              ✅ 通过                      │
│ Step 2/9: 版本快照            ✅ snapshot_20260708.tar.gz  │
│ Step 3/9: 清理旧实例          ✅ 容器已清理                │
│ Step 4/9: Git 拉取            🔄 正在拉取... (进度)       │
│ Step 5/9: 写入环境变量        ⏳ 等待中                   │
│ Step 6/9: 预部署命令          ⏳ 等待中                   │
│ Step 7/9: 部署执行            ⏳ 等待中                   │
│ Step 8/9: 健康检查            ⏳ 等待中                   │
│ Step 9/9: 后部署命令          ⏳ 等待中                   │
├─────────────────────────────────────────────────────────────┤
│ 实时日志:                                                    │
│ [10:00:01] [PreCheck] 磁盘空间: 45GB 可用 ✅               │
│ [10:00:02] [PreCheck] 运行环境: Node.js v20.11.0 ✅        │
│ [10:00:03] [PreCheck] Docker: 24.0.7 ✅                    │
│ [10:00:04] [Snapshot] 创建快照...                           │
│ [10:00:05] [Git] 正在拉取 main 分支...                      │
└─────────────────────────────────────────────────────────────┘
```

---

## 7. 实施路径

### Phase 0: Template → Project 重命名（优先级 P0）

> **⚠️ 前置条件**：此 Phase 必须在其他所有 Phase 之前完成。重命名涉及整个代码库的所有层（模型/仓库/服务/处理器/路由/前端页面/文档），任何后续新增代码若基于旧命名将产生冲突。

**工作量估算**: 2-3 天  
**依赖**: 无（这是整个计划的基础）

#### 7.0.1 重命名映射表

##### Go 后端（模型层）

| 原名称 | 新名称 | 所在文件 | 说明 |
|--------|--------|----------|------|
| `Template` (struct) | `Project` | `internal/model/models.go:38` | 核心模型类 |
| `TemplateHistory` (struct) | `ProjectHistory` | `internal/model/models.go:84` | 历史快照 |
| `TemplateID` (字段) | `ProjectID` | `internal/model/models.go:69,80,86` | DeployTask/TemplateHistory 中的外键 |
| `template_id` (json) | `project_id` | `internal/model/models.go:69,86` | JSON 序列化字段 |
| `TemplateID` (gorm tag) | `ProjectID` | `internal/model/models.go:63,69,80` | GORM 外键 |
| `db.AutoMigrate(&Template{})` | `db.AutoMigrate(&Project{})` | `internal/model/db.go:43` | 数据库迁移 |
| `&TemplateHistory{}` | `&ProjectHistory{}` | `internal/model/db.go:43` | 数据库迁移 |

##### Go 后端（仓库层）

| 原名称 | 新名称 | 所在文件 | 说明 |
|--------|--------|----------|------|
| `TemplateRepository` | `ProjectRepository` | `internal/repository/repository.go:108` | 仓库接口名 |
| `templateRepo` | `projectRepo` | `internal/repository/repository.go:117` | 仓库实现名 |
| `repo.Template` | `repo.Project` | `internal/repository/repository.go:13` | 仓库聚合中的字段 |
| `&templateRepo{db: db}` | `&projectRepo{db: db}` | `internal/repository/repository.go:23` | 实现创建 |
| `model.Template{}` | `model.Project{}` | `internal/repository/repository.go:79,126,134,137,146,152,157` | GORM 查询中的模型引用 |
| `[]model.Template` | `[]model.Project` | `internal/repository/repository.go:134` | 列表返回类型 |
| `var templates []model.Template` | `var projects []model.Project` | `internal/repository/repository.go:134` | 局部变量 |
| `return templates, total, nil` | `return projects, total, nil` | `internal/repository/repository.go:149` | 返回值 |
| `model.Template{}` (Delete) | `model.Project{}` | `internal/repository/repository.go:157` | GORM Delete |
| `CountTemplates` (接口方法) | `CountProjects` | `internal/repository/server_node_repository.go:17` | 统计关联项目数 |
| `CountTemplates` (实现) | `CountProjects` | `internal/repository/server_node_repository.go:60` | 实现方法名 |
| `model.Template{}` (CountTemplates内) | `model.Project{}` | `internal/repository/server_node_repository.go:62` | GORM 查询模型 |

##### Go 后端（服务层）

| 原名称 | 新名称 | 所在文件 | 说明 |
|--------|--------|----------|------|
| `TemplateService` | `ProjectService` | `internal/service/template_service.go:17` | 服务结构体 |
| `NewTemplateService` | `NewProjectService` | `internal/service/template_service.go:28` | 构造函数 |
| `CreateTemplateRequest` | `CreateProjectRequest` | `internal/service/template_service.go:32` | 创建请求结构体 |
| `svc.Template` | `svc.Project` | `internal/service/service.go:15` | 服务聚合中的字段 |
| `NewTemplateService(...)` | `NewProjectService(...)` | `internal/service/service.go:28` | 服务创建 |
| `TemplateWithLatestTask` | `ProjectWithLatestTask` | `internal/service/template_service.go:121` | 列表展示结构体 |
| `model.Template` (参数/返回值) | `model.Project` | `internal/service/template_service.go:53,98,103,116,147,215,220` | 所有 Template 模型引用 |
| `[]model.Template` | `[]model.Project` | `internal/service/template_service.go:116,128` | 切片返回类型 |
| `[]*TemplateWithLatestTask` | `[]*ProjectWithLatestTask` | `internal/service/template_service.go:127` | 包装类型切片 |
| `repo.Template` 引用 | `repo.Project` | `internal/service/template_service.go:19` | 字段类型 |
| `server_node_service.go:112` `CountTemplates` | `CountProjects` | `internal/service/server_node_service.go` | 调用方法名 |
| `task_service.go:37` 注释 `TemplateID` | `ProjectID` | `internal/service/task_service.go` | 请求结构体字段 |
| `task_service.go:46` `TemplateID` 赋值 | `ProjectID` | `internal/service/task_service.go` | 使用处 |
| `template *model.Template` 参数 | `project *model.Project` | `internal/service/task_service.go:85,133` | 函数参数 |
| `template.ServerNodeID/template.*` | `project.ServerNodeID/project.*` | `internal/service/task_service.go:100,108,111-124,134,136,140,142,155` | 所有字段访问 |

##### Go 后端（处理器层）

| 原名称 | 新名称 | 所在文件 | 说明 |
|--------|--------|----------|------|
| `TemplateHandler` | `ProjectHandler` | `internal/handler/template_handler.go:14` | 处理器结构体 |
| `NewTemplateHandler` | `NewProjectHandler` | `internal/handler/template_handler.go:19` | 构造函数 |
| `templateHandler` (变量) | `projectHandler` | `cmd/server/main.go:145` | 变量名 |
| `templateHandler.List` | `projectHandler.List` | `cmd/server/main.go:146` | 路由注册 |
| 所有处理器方法名 | 不变 | `template_handler.go` | 方法名 List/Create/Get/Update/Delete/Clone/Branches/Deploy 不变 |
| 路由 `/templates` | `/projects` | `cmd/server/main.go:146-154` | 全部 API 路由 |
| WebSocket `:template_id` | `:project_id` | `cmd/server/main.go:181` | WebSocket 路由 |
| `instance_log_handler.go:94` `templateID` 字段 | `projectID` | `internal/handler/instance_log_handler.go` | session 结构体字段 |
| `instance_log_handler.go:411` `c.Param("template_id")` | `c.Param("project_id")` | `internal/handler/instance_log_handler.go` | 请求参数解析 |
| `instance_log_handler.go:417,428,432,435-437` `template.*` | `project.*` | `internal/handler/instance_log_handler.go` | 所有 template 变量引用 |
| `task_handler.go:23-33` `templateID` | `projectID` | `internal/handler/task_handler.go` | 查询参数 `template_id` → `project_id` |

##### 前端代码

| 文件 | 修改内容 | 说明 |
|------|----------|------|
| `web/src/pages/TemplateList.tsx` | → `ProjectList.tsx` | 文件名 + 所有 Template 引用 |
| `web/src/pages/TemplateForm.tsx` | → `ProjectForm.tsx` | 文件名 + 所有 Template 引用 |
| `web/src/App.tsx` | 导入和路由 | `TemplateList`/`TemplateForm` → `ProjectList`/`ProjectForm` |
| | | `/templates` → `/projects` (全部 4 条路由) |
| `web/src/utils/api.ts` | `templateApi` → `projectApi` | 变量名 |
| | | 所有 URL `/templates` → `/projects` |
| | | `TemplateItem` 接口 → `ProjectItem` |
| | | `template_id` → `project_id` (taskApi 参数) |
| `web/src/types/index.ts` | `Template` → `Project` | 类型接口 |
| | | `template_id` → `project_id` | 
| `web/src/components/Layout.tsx` | 导航标签和图标 | `'模板'` → `'项目'`, 图标不变 |
| `web/src/components/DeployModal.tsx` | `templateId`/`templateName` → `projectId`/`projectName` | Props 和内部变量 |
| `web/src/components/HistoryDrawer.tsx` | `templateId`/`templateName` → `projectId`/`projectName` | Props 和变量 |
| `web/src/components/HistoryModal.tsx` | `templateId`/`templateName` → `projectId`/`projectName` | Props 和变量 |
| `web/src/components/InstanceLogModal.tsx` | `templateId`/`templateName` → `projectId`/`projectName` | Props 和变量 |
| `web/src/pages/Dashboard.tsx` | `LayoutTemplate` 图标名不变 | `LayoutTemplate` 是 lucide-react 的图标名，无需改名 |
| | | 文案 `'模板总数'` → `'项目总数'` |
| | | `'/templates/new'` → `'/projects/new'` |
| `web/src/pages/DeployPage.tsx` | `templateApi` → `projectApi` | API 调用 |
| | | `templateId` → `projectId` |
| `web/src/pages/TaskList.tsx` | `task.template_name` → `task.project_name` | 模板名称列 |
| `web/src/hooks/useInstanceLogSocket.ts` | `templateId` → `projectId` | Hook 参数 |
| | | `/ws/instance-logs/${templateId}` → `${projectId}` |

##### 文档

| 文件 | 修改内容 |
|------|----------|
| `README.md:132` | `Template` → `Project` |
| `README.md:374-381` | 全部 `/api/templates` → `/api/projects`，`模板` → `项目` |
| `README.md:433` | `:template_id` → `:project_id` |
| `README.md:462` | `template_handler.go` → `project_handler.go` |
| `CHANGELOG.md:34` | `:template_id` → `:project_id` |

#### 7.0.2 影响范围分析

```
┌─────────────────────────────────────────────────────────────┐
│                    影响范围总览                               │
│                                                             │
│  Go 后端模型层      → 1 个 struct 改名 + 1 个 struct 改名    │
│  Go 后端仓库层      → 1 个接口 + 1 个实现 + GORM 所有查询    │
│  Go 后端服务层      → 1 个 service + 1 个 request struct    │
│  Go 后端处理器层    → 1 个 handler + 全部路由地址            │
│  Go 后端 main.go   → 11 条路由 + 1 条 WebSocket 路由        │
│  前端页面文件       → 2 个页面文件改名                       │
│  前端组件           → 5 个组件 props 全部涉及                 │
│  前端 API 层        → 全部 8 个 API URL + 类型接口           │
│  前端路由           → 4 条路由路径                           │
│  前端导航           → 1 处文案                               │
│  前端类型定义       → 1 个 interface                          │
│  前端 Hook          → 1 个参数改名 + 1 处 WebSocket URL      │
│  README             → ~15 处                                 │
│  CHANGELOG          → 1 处                                   │
│  总影响文件数       → ~30 个文件                             │
└─────────────────────────────────────────────────────────────┘
```

**外部依赖方**（如果存在）：
- 如果已有用户安装了旧版本，其数据库中表名为 `templates`，重命名需要 GORM 的表名策略 `TableName()`
- 如果已有 CI/CD 脚本调用 `/api/templates/*` 端点，需同步更新
- 如果 Electron 打包配置涉及模板相关路径，需检查

#### 7.0.3 执行顺序与依赖关系

```
Step 1 ── Go 模型层 (model/models.go)
  │
  ├── Step 2 ── Go 模型层 (model/db.go — AutoMigrate 注册)
  │
  ├── Step 3 ── Go 仓库层 (repository/repository.go)
  │     └── 依赖: Step 1 (模型类型)
  │
  ├── Step 4 ── Go 仓库层 (repository/server_node_repository.go — CountTemplates)
  │     └── 依赖: Step 1 (模型类型)
  │
  ├── Step 5 ── Go 服务层 (service/template_service.go)
  │     └── 依赖: Step 3 (仓库接口)
  │
  ├── Step 6 ── Go 服务层 (service/service.go — 聚合注册)
  │     └── 依赖: Step 5 (构造函数)
  │
  ├── Step 7 ── Go 服务层 (service/task_service.go)
  │     └── 依赖: Step 1, 5
  │
  ├── Step 8 ── Go 服务层 (service/server_node_service.go — CountProjects)
  │     └── 依赖: Step 4
  │
  ├── Step 9 ── Go 处理器层 (handler/template_handler.go)
  │     └── 依赖: Step 5 (服务接口)
  │
  ├── Step 10 ── Go 处理器层 (handler/instance_log_handler.go)
  │     └── 依赖: Step 1, 5
  │
  ├── Step 11 ── Go 处理器层 (handler/task_handler.go — template_id 参数)
  │     └── 依赖: Step 7
  │
  ├── Step 12 ── Go 路由注册 (cmd/server/main.go)
  │     └── 依赖: Step 9-11
  │
  ├── Step 13 ── 前端类型 (web/src/types/index.ts)
  │     └── 依赖: 无 (纯前端，可独立进行)
  │
  ├── Step 14 ── 前端 API 层 (web/src/utils/api.ts)
  │     └── 依赖: Step 13
  │
  ├── Step 15 ── 前端组件 (5 个组件)
  │     └── 依赖: Step 14 (API 调用)
  │
  ├── Step 16 ── 前端页面 (2 个页面)
  │     └── 依赖: Step 14, 15 (组件+API)
  │
  ├── Step 17 ── 前端路由/导航 (App.tsx, Layout.tsx, Dashboard.tsx)
  │     └── 依赖: Step 16
  │
  ├── Step 18 ── 前端 Hook (useInstanceLogSocket.ts)
  │     └── 依赖: Step 12 (URL 对齐)
  │
  └── Step 19 ── 文档 (README.md, CHANGELOG.md)
        └── 依赖: Step 12 (API 路径对齐)
```

**最佳并行策略**：
```
Day 1 (Go 后端):
  Step 1-4 (模型+仓库) — 可一次性完成
  Step 5-8 (服务层)
  编译验证

Day 2 (Go 后端续 + 前端):
  Step 9-12 (处理器+路由)
  go vet + 编译验证
  Step 13-14 (前端类型+API)
  
Day 3 (前端 + 文档):
  Step 15-17 (组件+页面+路由)
  Step 18 (Hook)
  前端构建验证
  Step 19 (文档)
  端到端测试
```

#### 7.0.4 回滚策略

```yaml
方案 A: Git 分支回滚（推荐）
  适用场景: 重命名过程中发现严重问题
  操作: git revert <commit-range>
  优点: 一次操作，精确还原
  缺点: 如果后续有其他代码合并了被 revert 的分支，需手动处理冲突

方案 B: 保留旧 API 路由作为别名
  适用场景: 已有用户/CI 依赖旧 API 端点
  操作: 
    // cmd/server/main.go 中注册两份路由
    authorized.GET("/templates", projectHandler.List)    // 向后兼容
    authorized.GET("/projects", projectHandler.List)     // 新路径
  回滚步骤:
    1. 新增别名路由后，观察一段时间确认无问题
    2. 确认所有用户/CI 已迁移到新路径
    3. 在下一个版本中移除旧路由
    
方案 C: 数据库表名兼容
  适用场景: 已有生产环境的 SQLite 数据库
  操作: 在 Project 模型上实现 TableName() 方法返回旧表名
    func (Project) TableName() string { return "templates" }
  回滚步骤:
    1. 重命名开始时保留 TableName() → "templates"
    2. 验证 Go 代码层面一切正常
    3. 确认无数据兼容问题后，在下个版本移除 TableName() 覆盖，GORM 自动使用 "projects"
    
方案 D（紧急）: git stash + checkout
  适用场景: 发现遗漏了关键文件未改名，导致编译失败无法修复
  操作: git checkout -- . 回滚所有未提交变更
  注意: 仅适用于尚未 commit 的场景，会丢失所有未提交的更改
```

**推荐组合策略**:
```bash
# 1. 重命名工作在独立分支上进行
git checkout -b rename/template-to-project

# 2. 逐个 commit，每个步骤可 revert
git commit -m "refactor(model): rename Template to Project"
git commit -m "refactor(repo): rename TemplateRepository to ProjectRepository"
# ... 后续每个步骤独立 commit

# 3. 本地全量验证后 squash merge
git checkout main
git merge --squash rename/template-to-project
git commit -m "refactor: rename Template to Project across entire codebase"
```

#### 7.0.5 验证步骤

```yaml
验证阶段 1: 编译通过
  - go vet ./...                  # Go 代码静态检查，无 template 相关引用遗漏
  - CGO_ENABLED=0 go build ./...  # 全量编译
  - 确认结果: 无编译错误，无 vet 警告

验证阶段 2: 前端构建
  - cd web && npx tsc --noEmit    # TypeScript 类型检查
  - npm run build                  # Vite 构建
  - 确认结果: 无 TS 错误，构建产物正常

验证阶段 3: 无遗留引用
  - grep -rn -i "template" internal/ --include="*.go" | grep -v "_test.go" | grep -v "vendor/"
  - grep -rn -i "template" web/src/ --include="*.{ts,tsx}"
  - 确认结果: 仅剩的 "template" 出现在：
    - Git 仓库中已经是第三方库的引用（如 lucide-react 的 LayoutTemplate 图标名）
    - 注释/文档中的旧名称说明（如有意保留的迁移说明）
    - 请仔细审查以上排除项

验证阶段 4: 数据库兼容
  - 启动后端，确认 GORM AutoMigrate 无错误
  - 检查 SQLite 数据库表名是否正确
  - 创建/查询/更新/删除 Project 记录
  - 确认结果: CRUD 全部正常

验证阶段 5: API 端点验证
  - curl http://localhost:port/api/v1/projects          # 列表
  - curl http://localhost:port/api/v1/projects/1        # 详情
  - curl -X POST http://localhost:port/api/v1/projects  # 创建
  - curl -X PUT http://localhost:port/api/v1/projects/1 # 更新
  - curl -X DELETE http://localhost:port/api/v1/projects/1 # 删除
  - 确认结果: 所有端点返回 2xx
  - 确认旧端点 /templates 已移除或返回 404 (非兼容模式)

验证阶段 6: 前段端到端
  - 确认导航栏显示"项目"
  - 确认路由 /projects 正确渲染项目列表
  - 确认创建/编辑/部署功能正常
  - 确认 WebSocket 实例日志连接正常

验证阶段 7: 文档一致性
  - README.md 中的 API 路由、架构图均已更新
  - CHANGELOG.md 中的历史记录已同步
```

---

#### 7.0.6 Template → Project 重命名的专用 Todo 清单

```markdown
- [ ] Step 1: model/models.go — Template → Project, TemplateHistory → ProjectHistory, 全部字段改名
- [ ] Step 2: model/db.go — AutoMigrate 注册改名
- [ ] Step 3: repository/repository.go — TemplateRepository → ProjectRepository, 实现全部改名
- [ ] Step 4: repository/server_node_repository.go — CountTemplates → CountProjects
- [ ] Step 5: service/template_service.go — 文件重命名 + 内部全部改名
- [ ] Step 6: service/service.go — svc.Template → svc.Project, NewTemplateService → NewProjectService
- [ ] Step 7: service/task_service.go — 全部 template 引用 → project
- [ ] Step 8: service/server_node_service.go — CountTemplates → CountProjects
- [ ] Step 9: handler/template_handler.go — 文件重命名 + TemplateHandler → ProjectHandler
- [ ] Step 10: handler/instance_log_handler.go — templateID/Param("template_id")/template.* → project
- [ ] Step 11: handler/task_handler.go — template_id → project_id
- [ ] Step 12: cmd/server/main.go — 路由 /templates → /projects, :template_id → :project_id
- [ ] Step 13: web/src/types/index.ts — Template → Project 接口
- [ ] Step 14: web/src/utils/api.ts — templateApi → projectApi, 全部 URL 和类型
- [ ] Step 15: web/src/components/* — 5 个组件的 props 和内部变量改名
- [ ] Step 16: web/src/pages/* — TemplateList → ProjectList, TemplateForm → ProjectForm
- [ ] Step 17: web/src/App.tsx, Layout.tsx, Dashboard.tsx — 路由和导航文案
- [ ] Step 18: web/src/hooks/useInstanceLogSocket.ts — templateId → projectId
- [ ] Step 19: 文档 README.md + CHANGELOG.md 同步更新
- [ ] 编译验证: go vet ./... && go build ./...
- [ ] 前端验证: tsc --noEmit && npm run build
- [ ] 遗留引用审查: grep -rn -i "template"
- [ ] API 端点测试
- [ ] 前端端到端测试
```

---

### Phase 1: 连通性诊断工具（优先级 P0）

**工作量估算**: 3-5 天  
**依赖**: 无

- [ ] 实现 `ConnectivityDiagnoser` 核心引擎
- [ ] 实现 D1-D4（基础网络层诊断）
- [ ] 实现 D5-D7（登录后诊断）
- [ ] 实现 D8-D9（高级诊断）
- [ ] 前端诊断报告展示组件
- [ ] `POST /diagnose` API
- [ ] "一键修复" 功能（如自动下发公钥）

### Phase 2: 节点环境初始化（优先级 P0）

**工作量估算**: 5-7 天  
**依赖**: Phase 1（需要连通性确保）

- [ ] 实现环境初始化脚本引擎（按阶段执行 shell 命令）
- [ ] 系统检测模块
- [ ] 工具安装模块
- [ ] 运行环境安装模块（nvm/node/python/Docker）
- [ ] 配置同步模块
- [ ] 重试与回滚机制
- [ ] 初始化状态持久化与查询 API
- [ ] 前端初始化状态展示组件

### Phase 3: 部署流程增强（优先级 P1）

**工作量估算**: 5-7 天  
**依赖**: Phase 2

- [ ] 步骤化部署状态机
- [ ] 部署快照与回滚
- [ ] Git 操作增强（stash / 严格对齐）
- [ ] 部署模式自动检测
- [ ] 结构化健康检查
- [ ] 重试策略引擎
- [ ] 前端部署步骤进度条

### Phase 4: 状态回传与 Webhook（优先级 P1）

**工作量估算**: 2-3 天  
**依赖**: Phase 3

- [ ] WebHook 配置管理与分发引擎
- [ ] 节点心跳检测机制
- [ ] 桌面通知集成
- [ ] 前端 Webhook 管理页面

### Phase 5: 优化与运维（优先级 P2）

**工作量估算**: 2-3 天  
**依赖**: Phase 3

- [ ] 节点标签系统
- [ ] 批量节点操作（批量初始化/批量部署）
- [ ] 定时健康巡检
- [ ] 磁盘空间自动清理
- [ ] 部署统计报表

---

## 附录

### A. 关键目录结构

```yaml
internal/
  ├── model/
  │   ├── models.go              # [改] Template → Project, TemplateHistory → ProjectHistory
  │   └── db.go                  # [改] AutoMigrate 注册
  ├── repository/
  │   ├── repository.go          # [改] TemplateRepository → ProjectRepository
  │   └── server_node_repository.go  # [改] CountTemplates → CountProjects
  ├── service/
  │   ├── project_service.go     # [改] template_service.go → project_service.go
  │   ├── task_service.go        # [改] template 引用 → project
  │   └── service.go             # [改] svc.Template → svc.Project
  ├── handler/
  │   ├── project_handler.go     # [改] template_handler.go → project_handler.go
  │   ├── task_handler.go        # [改] template_id → project_id
  │   └── instance_log_handler.go # [改] templateID → projectID
  ├── connectivity/              # [新增] 连通性诊断模块
  ├── init/                      # [新增] 节点初始化模块
  ├── deployer/
  │   ├── step_engine.go         # [新增] 步骤化状态机
  │   ├── health_check.go        # [新增] 结构化健康检查
  │   ├── rollback.go            # [新增] 部署回滚
  │   └── snapshot.go            # [新增] 版本快照
  └── webhook/                   # [新增] Webhook 模块
```

### B. 初始化脚本模板示例

```bash
#!/bin/bash
# ldm-init-phase-1.sh — Linux Deploy Manager 节点初始化脚本
# 阶段: 系统检测
set -euo pipefail

echo "[System] 检测系统信息..."
ARCH=$(uname -m)
OS=$(cat /etc/os-release | grep "^ID=" | cut -d= -f2 | tr -d '"')
OS_VERSION=$(cat /etc/os-release | grep "^VERSION_ID=" | cut -d= -f2 | tr -d '"')
echo "  OS: $OS $OS_VERSION"
echo "  Arch: $ARCH"

echo "[System] 检测磁盘空间..."
DISK_AVAIL=$(df / --output=avail -B1 | tail -1)
if [ "$DISK_AVAIL" -lt 1073741824 ]; then  # < 1GB
    echo "  ⚠️  可用空间不足: $((DISK_AVAIL/1024/1024))MB"
    exit 1
fi
echo "  ✅ 磁盘空间: $((DISK_AVAIL/1024/1024/1024))GB 可用"
```

### C. 错误码规范

| 错误码 | 说明 |
|--------|------|
| `400060` | 诊断参数错误 |
| `400061` | 初始化参数错误 |
| `400062` | Webhook 参数错误 |
| `404060` | 节点未找到 |
| `404061` | 初始化日志未找到 |
| `500060` | 诊断执行失败 |
| `500061` | 初始化执行失败 |
| `500062` | 回滚执行失败 |

---

> **方案设计**: DevOps Automator  
> **日期**: 2026-07-08  
> **状态**: 待评审
