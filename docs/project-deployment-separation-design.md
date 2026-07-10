# 项目与部署解耦重构方案

## 1. 问题分析

### 当前架构的耦合问题

```
Project (项目)
├── 基本信息 (name, description, git_url, ssh_key_id)
├── 代码配置 (code_dir, deploy_dir, env_format, env_content)
├── **部署配置** ← 耦合点
│   ├── deploy_mode (local / container)
│   ├── pre_cmd / deploy_cmd / post_cmd
│   ├── timeout_sec
│   ├── local_config (JSON)
│   └── container_config (JSON)
├── **服务器绑定** ← 耦合点
│   └── server_node_id (FK → ServerNode)
└── status / created_at / updated_at
```

**具体问题：**
1. **项目与部署配置强耦合** — 一个项目只能有一套部署配置，无法实现"同一个项目，不同环境（开发/测试/生产）不同部署方式"
2. **项目与服务器强耦合** — 项目创建时必须指定服务器，切换服务器需编辑项目；无法将同一项目部署到多台服务器
3. **"部署"概念缺失** — 路由表中没有独立的部署入口，部署操作隐藏在项目列表的弹窗中；`DeployPage.tsx` 页面已存在但未路由
4. **导航缺失** — 侧边栏只有"项目"和"服务器"，缺少"部署"一级入口
5. **ProjectForm 巨型组件 (~1400行)** — 集成了项目信息编辑 + 部署配置 + 部署执行，职责过重

### 期望的目标架构

```
项目 (Project)         服务器 (ServerNode)
    │                       │
    │   ┌───────────────────┘
    │   ▼
    └──→ 部署 (Deployment) ←──┘
            │
            ▼
        部署任务 (DeployTask)
```

**核心解耦原则：**
- **项目 = 应用定义**（代码仓库、环境变量、SSH 密钥等）
- **服务器 = 目标机器**（连接信息、认证方式）
- **部署 = 在哪个服务器上、以什么方式、部署哪个项目**（部署命令、模式、超时等）
- 一个项目可以有多个部署配置（开发/测试/生产）
- 一台服务器可以被多个部署引用

---

## 2. 数据模型设计

### 新增：Deployment 模型

```go
// Deployment 部署配置（关联项目和服务器）
type Deployment struct {
    ID              uint       `gorm:"primaryKey" json:"id"`
    Name            string     `gorm:"size:100;not null" json:"name"`
    ProjectID       uint       `gorm:"not null;index" json:"project_id"`
    ServerNodeID    *uint      `json:"server_node_id"`  // nil = 本地部署

    // 部署命令（从 Project 移入）
    PreCmd          string     `gorm:"type:text;default:''" json:"pre_cmd"`
    DeployCmd       string     `gorm:"type:text;default:''" json:"deploy_cmd"`
    PostCmd         string     `gorm:"type:text;default:''" json:"post_cmd"`
    DeployMode      string     `gorm:"size:20;not null;default:'local'" json:"deploy_mode"`
    TimeoutSec      int        `gorm:"default:600" json:"timeout_sec"`
    ContainerConfig string     `gorm:"type:text;default:''" json:"container_config"`
    LocalConfig     string     `gorm:"type:text;default:''" json:"local_config"`

    // 部署独有的配置
    DefaultBranch   string     `gorm:"size:255;default:'main'" json:"default_branch"`
    Description     string     `gorm:"size:500;default:''" json:"description"`

    Status          string     `gorm:"size:20;default:'draft'" json:"status"` // draft / active / archived
    CreatedAt       time.Time  `json:"created_at"`
    UpdatedAt       time.Time  `json:"updated_at"`

    // 关联
    Project    Project    `gorm:"foreignKey:ProjectID" json:"project,omitempty"`
    ServerNode *ServerNode `gorm:"foreignKey:ServerNodeID" json:"server_node,omitempty"`
    Tasks      []DeployTask `gorm:"foreignKey:DeploymentID" json:"-"`
}
```

### 修改：Project 模型（剥离部署配置）

```go
// Project 项目（仅保留应用定义相关字段）
type Project struct {
    ID              uint       `gorm:"primaryKey" json:"id"`
    Name            string     `gorm:"size:50;not null;uniqueIndex" json:"name"`
    Description     string     `gorm:"size:500;default:''" json:"description"`
    GitURL          string     `gorm:"size:255;not null" json:"git_url"`
    SSHKeyID        uint       `gorm:"not null" json:"ssh_key_id"`
    CodeDir         string     `gorm:"size:4096;not null" json:"code_dir"`
    DeployDir       string     `gorm:"size:4096;default:''" json:"deploy_dir"`
    EnvFormat       string     `gorm:"size:20;default:'dotenv'" json:"env_format"`
    EnvContent      string     `gorm:"type:text;default:''" json:"env_content"`
    EnvEncrypted    bool       `gorm:"default:false" json:"env_encrypted"`
    Status          string     `gorm:"size:20;default:'draft'" json:"status"`
    CreatedAt       time.Time  `json:"created_at"`
    UpdatedAt       time.Time  `json:"updated_at"`

    // 移除的字段：
    // ServerNodeID    *uint     ← 移到 Deployment
    // DeployMode      string    ← 移到 Deployment
    // PreCmd          string    ← 移到 Deployment
    // DeployCmd       string    ← 移到 Deployment
    // PostCmd         string    ← 移到 Deployment
    // TimeoutSec      int       ← 移到 Deployment
    // ContainerConfig string    ← 移到 Deployment
    // LocalConfig     string    ← 移到 Deployment

    SSHKey     SSHKey       `gorm:"foreignKey:SSHKeyID" json:"-"`
    Deployments []Deployment `gorm:"foreignKey:ProjectID" json:"-"`
    Tasks      []DeployTask  `gorm:"foreignKey:ProjectID" json:"-"`
}
```

### 修改：DeployTask 模型（关联 Deployment）

```go
type DeployTask struct {
    ID           uint       `gorm:"primaryKey" json:"id"`
    ProjectID    uint       `gorm:"not null;index" json:"project_id"`
    DeploymentID *uint      `json:"deployment_id"`    // 新增：关联到 Deployment
    Branch       string     `gorm:"size:255;not null" json:"branch"`
    CommitSHA    string     `gorm:"size:40;default:''" json:"commit_sha"`
    Status       string     `gorm:"size:20;not null;default:'pending'" json:"status"`
    StartedAt    *time.Time `json:"started_at"`
    EndedAt      *time.Time `json:"ended_at"`
    LogPath      string     `gorm:"size:4096;not null" json:"log_path"`
    TriggeredBy  string     `gorm:"size:100;default:'root'" json:"triggered_by"`
    ErrorMsg     string     `gorm:"type:text;default:''" json:"error_msg"`
    CreatedAt    time.Time  `json:"created_at"`

    Project    Project    `gorm:"foreignKey:ProjectID" json:"-"`
    Deployment *Deployment `gorm:"foreignKey:DeploymentID" json:"deployment,omitempty"`
}
```

### 关系图

```
Project ──1:N──→ Deployment ──N:1──→ ServerNode
  │                  │
  │                  │
  1:N                └──1:N──→ DeployTask
  │
  └────────1:N──────────→ DeployTask
```

- **Project** → **Deployment**: 一个项目可以有多个部署（如 dev/staging/prod）
- **ServerNode** → **Deployment**: 一台服务器可以被多个部署引用
- **Deployment** → **DeployTask**: 一次部署触发一个任务
- **Project** → **DeployTask**: 保留以保持向后兼容，但主关联变为 `Deployment → DeployTask`

---

## 3. 数据库迁移策略

### 迁移方案：保留旧字段 + 新增 Deployment 表

采用**渐进式迁移**，不在第一阶段删除旧字段：

**第一阶段（添加新表，保留旧数据）：**
1. 新建 `deployments` 表
2. 新建 `deployment_tasks._deployment_id` 字段（可为空）
3. Project 表的旧字段**保留不动**（`server_node_id`, `deploy_mode`, `pre_cmd` 等）
4. 提供迁移脚本，为每个已有项目创建一个默认 Deployment

**第二阶段（可选，稳定后清理）：**
1. 将 Project 的旧字段标记为 `DEPRECATED`
2. 代码中所有读部署配置的地方改为从 Deployment 获取
3. 确认无误后删除 Project 的旧字段

### 迁移 SQL（GORM AutoMigrate 兼容）

第一阶段无需手动 SQL——GORM AutoMigrate 会自动创建 deployment 表并添加 deployment_id 列。迁移脚本 Go 代码：

```go
// 迁移逻辑：为每个已有项目创建一个默认 Deployment
func migrateProjectsToDeployments(db *gorm.DB) error {
    var projects []model.Project
    if err := db.Where("id NOT IN (SELECT DISTINCT project_id FROM deployments)").Find(&projects).Error; err != nil {
        return err
    }
    for _, p := range projects {
        dep := &model.Deployment{
            ProjectID:       p.ID,
            ServerNodeID:    p.ServerNodeID,
            Name:            p.Name + " (默认部署)",
            DeployMode:      p.DeployMode,
            PreCmd:          p.PreCmd,
            DeployCmd:       p.DeployCmd,
            PostCmd:         p.PostCmd,
            TimeoutSec:      p.TimeoutSec,
            ContainerConfig: p.ContainerConfig,
            LocalConfig:     p.LocalConfig,
            DefaultBranch:   "main",
            Status:          "active",
        }
        if err := db.Create(dep).Error; err != nil {
            return fmt.Errorf("create deployment for project %d: %w", p.ID, err)
        }
    }
    return nil
}
```

---

## 4. 后端 API 设计

### 新增：Deployment API

```go
// ===== Deployment Handler 新端点 =====
authorized.GET("/deployments", deploymentHandler.List)
authorized.POST("/deployments", deploymentHandler.Create)
authorized.GET("/deployments/:id", deploymentHandler.Get)
authorized.PUT("/deployments/:id", deploymentHandler.Update)
authorized.DELETE("/deployments/:id", deploymentHandler.Delete)
authorized.POST("/deployments/:id/deploy", deploymentHandler.Deploy) // 触发部署
authorized.GET("/deployments/:id/branches", deploymentHandler.Branches) // 获取 Git 分支（通过关联 Project）
```

### 修改：Project API（剥离部署相关）

```go
// ===== Project 创建/更新请求 简化版 =====
type CreateProjectRequest struct {
    Name        string `json:"name" binding:"required,min=2,max=50"`
    Description string `json:"description" binding:"max=500"`
    GitURL      string `json:"git_url" binding:"required"`
    SSHKeyID    uint   `json:"ssh_key_id" binding:"required"`
    CodeDir     string `json:"code_dir" binding:"required"`
    DeployDir   string `json:"deploy_dir"`
    EnvFormat   string `json:"env_format" binding:"omitempty,oneof=dotenv json yaml plain"`
    EnvContent  string `json:"env_content"`
    // 移除：ServerNodeID, DeployMode, PreCmd, DeployCmd, PostCmd, TimeoutSec, ContainerConfig, LocalConfig
}

// 保留但标记为 DEPRECATED 的端点：
// POST /projects/:id/deploy  ← 向后兼容：创建一个默认 Deployment 并触发部署
// GET  /projects/:id/branches ← 保留（通过 Project 获取 Git 分支）
```

### 修改：Task API（增加 deployment_id 过滤）

```go
// GET /tasks 增加 deployment_id 查询参数
func (h *TaskHandler) List(c *gin.Context) {
    deploymentID := c.Query("deployment_id") // 新增
    projectID := c.Query("project_id")
    // ...
}
```

### 完整的 API 路由变化

```
当前路由树：
/api/v1
├── /auth/...
├── /keys/...
├── /server-nodes/...
├── /projects/...          ← 包含部署配置 + 部署触发
├── /tasks/...
├── /fs/...
├── /envman/...
└── /settings/...

重构后路由树：
/api/v1
├── /auth/...
├── /keys/...
├── /server-nodes/...
├── /projects/...          ← 仅项目基本信息
├── /deployments/...       ← 新增：部署配置 CRUD + 触发部署
├── /tasks/...
├── /fs/...
├── /envman/...
└── /settings/...
```

---

## 5. 前端设计

### 5.1 新增 TypeScript 类型

```typescript
// types/index.ts 新增
export interface Deployment {
  id: number
  name: string
  project_id: number
  server_node_id?: number
  pre_cmd: string
  deploy_cmd: string
  post_cmd: string
  deploy_mode: 'local' | 'container'
  timeout_sec: number
  container_config: string
  local_config: string
  default_branch: string
  description: string
  status: 'draft' | 'active' | 'archived'
  created_at: string
  updated_at: string
  project?: Project
  server_node?: ServerNode
}

export interface CreateDeploymentRequest {
  name: string
  project_id: number
  server_node_id?: number | null
  deploy_mode?: 'local' | 'container'
  pre_cmd?: string
  deploy_cmd?: string
  post_cmd?: string
  timeout_sec?: number
  container_config?: string
  local_config?: string
  default_branch?: string
  description?: string
}

export type UpdateDeploymentRequest = Partial<CreateDeploymentRequest>

// Project 类型简化
export interface Project {
  id: number
  name: string
  description: string
  git_url: string
  ssh_key_id: number
  // server_node_id 移除 ← 移到 Deployment
  code_dir: string
  deploy_dir: string
  env_format: string
  env_content: string
  // deploy_mode, pre_cmd, deploy_cmd, post_cmd, timeout_sec 移除 ← 移到 Deployment
  status: string
  created_at: string
  updated_at: string
}
```

### 5.2 新增 API 封装

```typescript
// api.ts 新增
export const deploymentApi = {
  list: (params?: { project_id?: number; page?: number; page_size?: number }) =>
    api.get('/deployments', { params }),
  create: (data: CreateDeploymentRequest) => api.post('/deployments', data),
  get: (id: number) => api.get(`/deployments/${id}`),
  update: (id: number, data: UpdateDeploymentRequest) => api.put(`/deployments/${id}`, data),
  delete: (id: number) => api.delete(`/deployments/${id}`),
  deploy: (id: number, branch: string) => api.post(`/deployments/${id}/deploy`, { branch }),
  branches: (id: number) => api.get(`/deployments/${id}/branches`),
}
```

### 5.3 前端路由变化

```tsx
// App.tsx
<Routes>
  {/* ... 登录/设置/404 路由省略 ... */}
  <Route element={<Layout />}>
    <Route path="/" element={<Dashboard />} />
    <Route path="/keys" element={<KeyList />} />
    <Route path="/server-nodes" element={<ServerNodeList />} />

    {/* 项目（精简版） */}
    <Route path="/projects" element={<ProjectList />} />
    <Route path="/projects/new" element={<ProjectForm />} />
    <Route path="/projects/:id/edit" element={<ProjectForm />} />
    <Route path="/projects/:id" element={<ProjectDetail />} /> {/* 新增：项目详情页 */}

    {/* 部署（全新） */}
    <Route path="/deployments" element={<DeploymentList />} />
    <Route path="/deployments/new" element={<DeploymentForm />} />
    <Route path="/deployments/:id" element={<DeploymentDetail />} />
    <Route path="/deployments/:id/edit" element={<DeploymentForm />} />

    {/* 终端/设置 */}
    <Route path="/terminal" element={<TerminalLayout />}>
      <Route index element={<TerminalManage />} />
      <Route path=":nodeId" element={<TerminalPage />} />
    </Route>
  </Route>
  <Route path="/server-nodes/:nodeId/terminal" element={<TerminalPage />} />
  <Route path="/settings" element={<Settings />} />
</Routes>
```

### 5.4 导航栏变化

```tsx
// Layout.tsx navItems
const navItems = [
  { path: '/', label: '仪表盘', icon: Home },
  { path: '/projects', label: '项目', icon: LayoutTemplate },
  { path: '/deployments', label: '部署', icon: Rocket },     // 新增
  { path: '/server-nodes', label: '服务器', icon: Server },
  { path: '/terminal', label: '终端', icon: Terminal },
  { path: '/keys', label: '密钥', icon: Key },
  { path: '/settings', label: '设置', icon: Settings },
]
```

### 5.5 新增页面组件

#### DeploymentList.tsx — 部署列表页

```
┌────────────────────────────────────────────────────┐
│ 部署 [创建部署]                                      │
├────────────────────────────────────────────────────┤
│ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ │
│ │ 项目A-开发    │ │ 项目A-生产    │ │ 项目B-测试    │ │
│ │ 项目: 项目A   │ │ 项目: 项目A   │ │ 项目: 项目B   │ │
│ │ 服务器: dev01 │ │ 服务器: prod1 │ │ 服务器: 本地   │ │
│ │ 模式: 容器化   │ │ 模式: 容器化   │ │ 模式: 本地化   │ │
│ │ 状态: 活跃 ✓  │ │ 状态: 活跃 ✓  │ │ 状态: 草稿    │ │
│ │ [部署] [历史]  │ │ [部署] [历史]  │ │ [部署] [历史]  │ │
│ └──────────────┘ └──────────────┘ └──────────────┘ │
└────────────────────────────────────────────────────┘
```

**关键功能：**
- 展示所有部署配置，每个卡片显示：名称、关联项目、关联服务器、部署模式、状态
- "部署"按钮 → 弹出 DeployModal（选分支 + 实时日志）
- "历史" → 弹出 HistoryDrawer
- 筛选：按项目、按服务器、按状态

#### DeploymentForm.tsx — 创建/编辑部署配置

```
┌────────────────────────────────────────────────────┐
│ 创建部署配置 / 编辑部署配置                          │
├────────────────────────────────────────────────────┤
│ 基本信息                                            │
│ ┌────────────────────────────────────────────────┐ │
│ │ 名称: [________] 描述: [________]              │ │
│ │ 关联项目: [▼ 选择项目]                          │ │
│ │ 目标服务器: [▼ 选择服务器 | 本地部署]           │ │
│ │ 默认分支: [main]                                │ │
│ │ 状态: ○ 草稿  ● 活跃  ○ 归档                    │ │
│ └────────────────────────────────────────────────┘ │
│                                                    │
│ 部署方式                                            │
│ ┌────────────────────────────────────────────────┐ │
│ │ ● 本地部署 (直接/后台/systemd)                   │ │
│ │ ○ 容器部署 (docker-compose)                      │ │
│ │                                                  │ │
│ │ 执行类型: [▼ direct | background | systemd]      │ │
│ │ 环境管理: [▼ none | nvm | conda | pyenv] ➜ [___]│ │
│ │ 服务名称: [________]                              │ │
│ └────────────────────────────────────────────────┘ │
│                                                    │
│ 部署命令                                            │
│ ┌────────────────────────────────────────────────┐ │
│ │ 预部署命令:                                      │ │
│ │ [npm run build                          ] [3行] │ │
│ │                                                  │ │
│ │ 部署命令:                                        │ │
│ │ [node server.js                          ]      │ │
│ │                                                  │ │
│ │ 后部署命令:                                      │ │
│ │ [echo "deploy done"                      ]      │ │
│ │                                                  │ │
│ │ 超时时间: [600] 秒                               │ │
│ └────────────────────────────────────────────────┘ │
│                                                    │
│                                      [取消] [保存]  │
└────────────────────────────────────────────────────┘
```

**关键不同：**
- 可以独立于项目创建多个部署配置（同一个项目 + 不同服务器 = 不同环境）
- 选择项目时，自动加载项目的 Git 配置、环境变量等
- 选择服务器可选"本地部署"（不选服务器）

#### DeploymentDetail.tsx — 部署详情页

```
┌────────────────────────────────────────────────────┐
│ 部署: 项目A-生产                                    │
│ 项目: 项目A | 服务器: prod01 (192.168.1.100)        │
│ 模式: 容器化 | 默认分支: main | 状态: 活跃          │
│ [编辑] [部署] [更多▼]                                │
├────────────────────────────────────────────────────┤
│ 部署历史                                            │
│ ┌────┬────────┬──────┬──────────┬────────────────┐ │
│ │ ID │ 分支   │ 状态  │ 时间     │ 操作           │ │
│ ├────┼────────┼──────┼──────────┼────────────────┤ │
│ │ 42 │ main   │ ✓成功 │ 07-09 17:00 │ [日志] [回滚] │ │
│ │ 41 │ main   │ ✗失败 │ 07-09 16:30 │ [日志]        │ │
│ │ 40 │ develop│ ✓成功 │ 07-09 15:00 │ [日志]        │ │
│ └────┴────────┴──────┴──────────┴────────────────┘ │
└────────────────────────────────────────────────────┘
```

### 5.6 修改现有页面

#### ProjectForm.tsx — 简化

**移除：**
- 部署模式选择器（local/container）
- 部署命令编辑区（pre_cmd, deploy_cmd, post_cmd）
- 本地配置编辑区（exec_type, runtime_env, env_manager 等）
- 容器配置编辑区（compose_file, build_cmd, up_cmd）
- 超时时间设置
- 服务器节点选择

**保留：**
- 项目名称、描述
- Git URL、SSH 密钥
- 代码目录、部署目录
- 环境变量格式 & 内容

**新增（可选）：**
- 创建成功后跳转到部署创建页的提示
- 关联的部署配置列表（只读，点击可跳转）

#### ProjectList.tsx — 调整

**移除：**
- 卡片上显示的 `deploy_mode` 标记
- 直接部署按钮（改为跳转到关联的部署配置）

**保留/调整：**
- 项目卡片仍显示基本信息
- "部署"按钮改为跳转到该项目的部署列表（`/deployments?project_id=X`）或关联的 Deployment 详情
- 部署历史仍保留

#### DeployModal.tsx — 适配

当前 `DeployModal` 通过 `projectApi.deploy()` 触发部署。重构后改为通过 `deploymentApi.deploy()`。

**变化：**
- 入参从 `projectId` 改为 `deploymentId`
- 创建部署任务时传递 `deployment_id`
- WebSocket 路径不变（按 task_id）

---

## 6. 后端实现变化

### 6.1 新增 Deployment 三层架构

```
internal/
├── model/
│   ├── models.go          ← 新增 Deployment 模型
│   └── db.go              ← AutoMigrate 加入 Deployment
├── repository/
│   └── repository.go      ← 新增 DeploymentRepository 接口 + 实现
├── service/
│   ├── service.go         ← 新增 DeploymentService
│   └── deployment_service.go  ← 部署配置 CRUD + 触发部署
├── handler/
│   └── deployment_handler.go  ← HTTP 路由处理器
```

### 6.2 部署执行链路变化

**当前链路：**
```
POST /projects/:id/deploy
  → projectHandler.Deploy()
    → projectService.Get(id)            // 获取项目（含部署配置）
    → taskService.Create()              // 创建任务
    → taskService.ExecuteDeploy()       // 从 Project 读配置执行
```

**新链路：**
```
POST /deployments/:id/deploy
  → deploymentHandler.Deploy()
    → deploymentService.Get(id)         // 获取部署配置（含关联 Project 和 ServerNode）
    → taskService.Create()              // 创建任务（关联 deployment_id）
    → taskService.ExecuteDeployFromDeployment()  // 从 Deployment 读配置执行
```

**关键修改点：**

```go
// task_service.go 新增方法
func (s *TaskService) ExecuteDeployFromDeployment(taskID uint, dep *model.Deployment) error {
    // 1. 通过 Deployment.ServerNodeID 创建 Executor（远程或本地）
    // 2. 通过 Deployment.ProjectID 获取 Project 的环境变量信息
    // 3. 从 Deployment 获取部署配置（pre/deploy/post cmd, deploy_mode 等）
    // 4. 组装 deployer.Config 并执行
    // 5. 从 Project 获取 SSHKey 用于 Git 拉取
}
```

### 6.3 Service 层新增

```go
// service/deployment_service.go
type DeploymentService struct {
    repo            repository.DeploymentRepository
    projectRepo     repository.ProjectRepository
    serverNodeRepo  repository.ServerNodeRepository
    keyRepo         repository.KeyRepository
    taskRepo        repository.TaskRepository
    taskSvc         *TaskService
    sshPool         *sshclient.Pool
}

func (s *DeploymentService) Create(req *CreateDeploymentRequest) (*model.Deployment, error)
func (s *DeploymentService) Get(id uint) (*model.Deployment, error)
func (s *DeploymentService) List(projectID uint, page, pageSize int) ([]model.Deployment, int64, error)
func (s *DeploymentService) Update(id uint, req *UpdateDeploymentRequest) (*model.Deployment, error)
func (s *DeploymentService) Delete(id uint) error
func (s *DeploymentService) Deploy(deploymentID uint, branch string) (*model.DeployTask, error)
func (s *DeploymentService) Branches(deploymentID uint) ([]string, error)
```

### 6.4 Repository 层新增

```go
type DeploymentRepository interface {
    Create(d *model.Deployment) error
    Get(id uint) (*model.Deployment, error)
    List(projectID uint, page, pageSize int) ([]model.Deployment, int64, error)
    Update(d *model.Deployment) error
    Delete(id uint) error
    CountByProject(projectID uint) (int64, error)
}
```

---

## 7. 向后兼容策略

### 7.1 旧数据兼容

1. **Project 旧字段保留** — 不删除 `server_node_id`, `deploy_mode` 等字段
2. **迁移脚本** — 为每个已有项目自动创建一个默认 Deployment（同名 + "默认部署"后缀）
3. **旧 API 保持** — `POST /projects/:id/deploy` 保留，内部逻辑改为：
   - 查找该项目的默认 Deployment（或第一个活跃的）
   - 调用 `deploymentService.Deploy()`
4. **回退逻辑** — 如果项目没有关联的 Deployment，`/projects/:id/deploy` 能自动创建一个

### 7.2 旧项目创建兼容

当旧版客户端调用 `POST /projects` 传入 `deploy_mode` 等字段时：
- 后端正常创建 Project
- 同时自动创建一个默认 Deployment（使用传入的部署配置）
- 返回 Project 时忽略部署相关字段

### 7.3 前端渐进增强

1. 先上线后端新 API + Deployment 表，旧的 Project API 保持不变
2. 前端新增"部署"导航和页面，旧的项目管理入口不动
3. 逐步引导用户从"项目+部署一体化"过渡到"项目 vs 部署分离"
4. 最终在 1~2 个版本后移除旧字段和向后兼容代码

---

## 8. 分阶段实施计划

### Phase 1: 后端基建（1-2 天）

| 编号 | 任务 | 涉及文件 |
|------|------|---------|
| 1.1 | 新增 `Deployment` 数据模型 | `internal/model/models.go` |
| 1.2 | 注册到 AutoMigrate | `internal/model/db.go` |
| 1.3 | 新增 `DeploymentRepository` 接口+实现 | `internal/repository/repository.go` |
| 1.4 | 新增 `DeploymentService` | `internal/service/deployment_service.go` |
| 1.5 | 注册到 Service 聚合 | `internal/service/service.go` |
| 1.6 | 新增 `DeploymentHandler` | `internal/handler/deployment_handler.go` |
| 1.7 | 注册部署相关路由 | `cmd/server/main.go` |
| 1.8 | 修改 `TaskService.ExecuteDeploy` 支持从 Deployment 读取配置 | `internal/service/task_service.go` |
| 1.9 | 迁移脚本：为旧项目创建默认 Deployment | 单独迁移文件或 main.go 启动时执行 |

### Phase 2: 数据迁移 + 向后兼容（0.5 天）

| 编号 | 任务 | 涉及文件 |
|------|------|---------|
| 2.1 | 保留 `POST /projects/:id/deploy` 兼容旧客户端 | `internal/handler/project_handler.go` |
| 2.2 | 重写旧部署接口 → 查找/创建默认 Deployment 并转发 | `internal/handler/project_handler.go` |
| 2.3 | `DeployTask` 新增 `DeploymentID` 字段 | `internal/model/models.go` |
| 2.4 | 创建/修改任务时填充 `deployment_id` | `internal/service/task_service.go` |

### Phase 3: 前端新页面（2-3 天）

| 编号 | 任务 | 涉及文件 |
|------|------|---------|
| 3.1 | 新增 TypeScript `Deployment` 类型 | `web/src/types/index.ts` |
| 3.2 | 新增 `deploymentApi` | `web/src/utils/api.ts` |
| 3.3 | 新增 `DeploymentList` 页面 | `web/src/pages/DeploymentList.tsx` |
| 3.4 | 新增 `DeploymentForm` 页面 | `web/src/pages/DeploymentForm.tsx` |
| 3.5 | 新增 `DeploymentDetail` 页面 | `web/src/pages/DeploymentDetail.tsx` |
| 3.6 | 新增路由配置 | `web/src/App.tsx` |
| 3.7 | 导航栏新增"部署"入口 | `web/src/components/Layout.tsx` |

### Phase 4: 现有页面适配（1-2 天）

| 编号 | 任务 | 涉及文件 |
|------|------|---------|
| 4.1 | 简化 `ProjectForm`：移除部署配置 | `web/src/pages/ProjectForm.tsx` |
| 4.2 | 简化 `ProjectList`：移除 deploy_mode 展示 | `web/src/pages/ProjectList.tsx` |
| 4.3 | 修改 `DeployModal`：从按 project_id 改为按 deployment_id | `web/src/components/DeployModal.tsx` |
| 4.4 | `ProjectList` 部署按钮跳转到项目关联的部署列表 | `web/src/pages/ProjectList.tsx` |
| 4.5 | 适配 Dashboard 统计（部署相关） | `web/src/pages/Dashboard.tsx` |

### Phase 5: 清理 + 文档（1 天）

| 编号 | 任务 | 涉及文件 |
|------|------|---------|
| 5.1 | 移除 `DeployPage.tsx`（已被新页面替代） | `web/src/pages/DeployPage.tsx` |
| 5.2 | 清理废弃的向后兼容代码 | 各处 |
| 5.3 | 更新 README、CHANGELOG | `README.md`, `CHANGELOG.md` |
| 5.4 | 编写迁移指南（如果用户需要保留旧数据） | `docs/` |

---

## 9. 设计决策 & 权衡

### 决策 1：保留 Project 的旧字段 vs 立即删除

**选择：保留（第一阶段）**

理由：
- GORM AutoMigrate 不会删除列，手动删除列需要额外迁移逻辑
- 保留旧字段后，旧版客户端可以和新版共存
- 新创建的项目不会再写入旧字段（前端已经简化），旧字段自动为空
- 等稳定后再一次性清理

### 决策 2：Deployment 中的 Name 字段

Deployment 的 `Name` 字段是必需的，允许用户命名不同的部署环境：
- "项目A-开发环境"
- "项目A-测试环境（服务器01）"
- "项目A-生产环境"

### 决策 3：默认 Deployment 的创建时机

**选择：读取时自动创建 + 迁移脚本**

- 当旧版客户端触发 `/projects/:id/deploy` 且项目没有关联 Deployment 时 → 自动创建默认
- 迁移脚本在启动时为所有"孤儿"项目创建默认 Deployment

### 决策 4：DeployTask 的双向关联

`DeployTask` 同时保留 `ProjectID` 和新增 `DeploymentID`：
- `ProjectID` 保证向下兼容（现有历史数据不丢失）
- `DeploymentID` 提供新的关联方式
- 新创建的 DeployTask 两个字段都填充

---

## 10. 风险与注意事项

1. **数据完整性** — 删除 ServerNode 时，需要检查是否被 Deployment 引用（而非 Project）。需修改 `ServerNodeService.Delete()` 的逻辑
2. **SSH 密钥关联** — Project 的 `SSHKeyID` 仍保留在 Project 中（用于 Git 拉取），不迁移到 Deployment
3. **Project 删除** — 删除 Project 时，级联删除关联的 Deployment 和 DeployTask
4. **WebSocket 日志** — `/ws/deploy/:task_id` 路径不变，只需在触发部署时传入正确的 task_id
5. **仪表盘统计** — Dashboard 中的"项目数"/"服务器数"不变，需新增"部署数"统计

---

## 11. 总结

### 核心价值

| 指标 | 重构前 | 重构后 |
|------|--------|--------|
| 一个项目多个部署 | ❌ 不支持 | ✅ 支持 dev/staging/prod |
| 一个项目多台服务器 | ❌ 不支持 | ✅ 支持灰度/多区域 |
| 部署配置独立管理 | ❌ 绑定在项目上 | ✅ 独立 CRUD |
| 导航入口 | ❌ 无 | ✅ 侧边栏"部署" |
| ProjectForm 复杂度 | ~1400 行巨石 | ~500 行精简 |
| 迁移成本 | — | 渐进式，零停机 |

### 数据流全景（重构后）

```
                       ┌───────────┐
                       │ Project   │  Git repo, env vars, SSH key
                       │ (应用定义)  │
                       └─────┬─────┘
                             │ 1:N
                       ┌─────▼─────┐   N:1   ┌───────────┐
                       │ Deployment│◄────────│ ServerNode│
                       │ (部署配置)  │         │ (目标机器)  │
                       └─────┬─────┘         └───────────┘
                             │ 1:N
                       ┌─────▼─────┐
                       │ DeployTask│  部署记录 + 实时日志
                       │ (部署任务)  │
                       └───────────┘
```
