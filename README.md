# Linux Deploy Manager

> 一个 Go 单二进制部署管理平台。支持多服务器节点、本地/远程双执行器、Docker 容器化部署，并提供可选的 Electron 桌面客户端。

[![Go Version](https://img.shields.io/badge/Go-1.22%2B-blue)](https://golang.org)
[![License](https://img.shields.io/badge/License-MIT-green)](LICENSE)
[![Electron](https://img.shields.io/badge/Electron-31%2B-9cf)](https://www.electronjs.org/)
[![Platform](https://img.shields.io/badge/Platform-Linux%20%7C%20Windows%20%7C%20macOS-lightgrey)]()

---

## 目录

- [项目简介](#项目简介)
- [主要功能](#主要功能)
- [架构概览](#架构概览)
- [快速开始](#快速开始)
  - [Docker 部署（推荐）](#docker-部署推荐)
  - [二进制部署（Linux）](#二进制部署linux)
  - [Electron 桌面端](#electron-桌面端)
- [使用指南](#使用指南)
  - [首次设置](#首次设置)
  - [创建部署模板](#创建部署模板)
  - [执行部署](#执行部署)
  - [查看日志](#查看日志)
  - [管理服务器节点](#管理服务器节点)
- [配置说明](#配置说明)
  - [命令行参数](#命令行参数)
  - [环境变量](#环境变量)
  - [系统设置界面](#系统设置界面)
- [API 参考](#api-参考)
  - [认证](#认证)
  - [SSH 密钥](#ssh-密钥)
  - [部署模板](#部署模板)
  - [部署任务](#部署任务)
  - [服务器节点](#服务器节点)
  - [文件系统](#文件系统)
  - [环境管理](#环境管理)
  - [系统设置](#系统设置)
  - [WebSocket](#websocket)
- [项目结构](#项目结构)
- [贡献指南](#贡献指南)
- [许可证](#许可证)

---

## 项目简介

Linux Deploy Manager 是一个面向开发者的部署管理平台，帮助团队通过 Web 界面简化 Linux 服务器上的应用部署流程。

**核心理念**：只需填写一个"部署模板"（Git 仓库地址 + SSH 密钥 + 部署命令），即可通过一键触发完整的部署流程——Git 拉取代码、注入环境变量、执行多阶段命令、管理进程生命周期。支持部署到本地宿主机、远程服务器（SSH）或相同代码目录的 Docker 容器。

**适用场景**：
- 个人项目的快速 CI/CD
- 团队内部的部署管理后台
- 多服务器多应用的批量部署与运维
- 与 Electron 桌面端结合的内网部署工具

---

## 主要功能

### 部署引擎
- **一键部署**：Git 拉取 → 写入 `.env` → 预命令 → 部署命令 → 后命令，全自动串联
- **三阶段命令**：独立的预部署、部署、后部署命令，支持自定义脚本
- **超时控制**：超时自动 SIGTERM，10 秒后 SIGKILL（Windows 使用 `taskkill`）
- **进程管理**：重新部署前自动结束旧进程，支持 PID 文件追踪
- **环境变量注入**：模板级别自定义环境变量，自动写入 `.env` 文件

### 部署模式
| 模式 | 适用场景 | 说明 |
|---|---|---|
| **直接执行** | 开发调试 | 前台运行，部署命令的日志实时回流 |
| **后台运行** | 生产服务 | 进程后台运行（`nohup` / 分离进程），日志写入文件 |
| **systemd 服务** | 生产服务（Linux） | 创建 systemd service，支持开机自启和自动重启 |
| **容器部署** | 隔离运行 | 通过 `docker-compose` 构建和启动容器 |

### 执行器
- **本地执行器**：在部署机本地通过 Shell 执行命令
- **远程执行器**：通过 SSH/SFTP 在远程服务器上执行部署
- **执行器抽象**：`Executor` 接口，部署引擎无需关心本地还是远程

### 多服务器节点管理
- 添加远程服务器（IP + 端口 + SSH 密钥/密码）
- SSH 连接池与健康检测
- SSH 密钥自动分发（`ssh-copy-id` 等效逻辑）
- 节点在线状态监控

### SSH 密钥管理
- 创建 Ed25519 / RSA 4096 密钥对
- 密钥导出与复制公钥
- 连通性测试
- 自动识别系统 `~/.ssh/` 中的已有密钥

### 环境管理
- 检测 NVM、Conda、Pyenv 等环境管理工具
- 列出已安装的环境/版本
- 创建新的运行环境
- 部署时自动激活指定环境

### 实例日志
- 实时日志流（WebSocket）：支持 `tail -f` / `journalctl` / `docker-compose logs`
- 日志级别高亮（ERROR/WARN/DEBUG/INFO）
- 关键词过滤
- 自定义回溯行数
- 服务列表（docker-compose 多服务）

### 用户认证
- 首次运行引导设置密码
- bcrypt 密码哈希 + JWT 会话管理
- 密码修改

### Electron 桌面端
- 跨平台桌面客户端（Windows/macOS/Linux）
- Go 后端嵌入桌面应用，随机端口避免冲突
- 自动启动后端，无需单独启动服务

---

## 架构概览

```
┌─────────────────────────────────────────────────┐
│                 客户端 (Web / Electron)           │
│  React 18 + Vite + Tailwind + Zustand + RQ      │
└────────────────────┬────────────────────────────┘
                     │ HTTP / WebSocket
┌────────────────────▼────────────────────────────┐
│              Go 后端 (Gin + GORM)                │
│                                                   │
│  ┌──────────┐ ┌──────────┐ ┌──────────────────┐  │
│  │ Auth     │ │ Project  │ │ SSH Key          │  │
│  │ Handler  │ │ Handler  │ │ Handler          │  │
│  ├──────────┤ ├──────────┤ ├──────────────────┤  │
│  │ Server   │ │ Task     │ │ Settings         │  │
│  │ Node     │ │ Handler  │ │ Handler          │  │
│  ├──────────┤ ├──────────┤ ├──────────────────┤  │
│  │ FS       │ │ EnvMan   │ │ InstanceLog      │  │
│  │ Handler  │ │ Handler  │ │ Handler (WS)     │  │
│  └──────────┘ └──────────┘ └──────────────────┘  │
│                                                   │
│  ┌──────────────────────────────────────────────┐ │
│  │          部署引擎 (Deployer)                  │ │
│  │  ┌──────────────┐  ┌──────────────────┐      │ │
│  │  │ 本地执行器     │  │  远程执行器 (SSH) │      │ │
│  │  │ LocalExecutor│  │  RemoteExecutor  │      │ │
│  │  └──────────────┘  └──────────────────┘      │ │
│  │         │                      │              │ │
│  │         ▼                      ▼              │ │
│  │  ┌──────────────────────────────────────┐     │ │
│  │  │  sysutil (跨平台 Shell/进程工具)      │     │ │
│  │  │  bash -c (Unix) / cmd /C (Windows)   │     │ │
│  │  │  SIGTERM (Unix) / taskkill (Windows)  │     │ │
│  │  └──────────────────────────────────────┘     │ │
│  └──────────────────────────────────────────────┘ │
│                                                   │
│  ┌──────────────────────────────────────────────┐ │
│  │          数据层 (SQLite WAL)                  │ │
│  │  模板 / 密钥 / 服务器节点 / 任务 / 设置        │ │
│  └──────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────┘
```

---

## 快速开始

### Docker 部署（推荐）

适合快速在 Linux 服务器上启动服务。

```bash
# 1. 克隆仓库
git clone https://github.com/your-org/linux-deploy-manager.git
cd linux-deploy-manager

# 2. 运行部署脚本（自动生成 docker-compose.yml）
#    会交互式询问是否挂载 ~/.ssh 和项目代码目录
bash deploy.sh

# 3. 访问 http://服务器IP:18081
#    首次访问会自动跳转到设置密码页面
```

手动 Docker 部署：

```bash
docker compose up -d
```

### 二进制部署（Linux）

适用于直接在本机或目标服务器上运行。

**方式一：使用构建脚本（需要 Docker）**

```bash
bash deploy-localhost.sh
```

脚本会在 Docker 内编译静态链接二进制，然后安装到 `/usr/local/bin/` 并创建 systemd 服务。

**方式二：手动编译**

```bash
# 需要 Go 1.22+、Node.js、GCC（用于 CGO SQLite）

# 1. 构建前端
cd web && npm install && npm run build && cd ..

# 2. 拷贝前端资源到 embed 目录
mkdir -p cmd/server/web/dist && cp -r web/dist/* cmd/server/web/dist/

# 3. 编译后端
go build -o linux-deploy-manager -ldflags "-s -w" ./cmd/server

# 4. 运行
./linux-deploy-manager --port 8080 --data-dir /var/lib/ldm --log-dir /var/log/ldm
```

> **注意**：从 v1.1.0 起，SQLite 驱动已替换为纯 Go 实现，支持 `CGO_ENABLED=0` 编译跨平台静态二进制。

**Windows 构建**：

```powershell
# 需要 Go 1.22+ 和 Node.js
.\build.ps1
```

脚本会自动构建前端、编译 Windows 二进制（`bin/linux-deploy-manager.exe`）以及交叉编译 Linux 二进制（`bin/linux-deploy-manager-linux-amd64`）。

### Electron 桌面端

```bash
# 1. 安装 Electron 依赖
npm install

# 2. 开发模式运行（需要先启动 Vite dev server）
cd web && npm run dev &
cd .. && npm run electron:dev

# 3. 打包发布（自动构建前端 + Go 后端 + 调用 electron-builder）
npm run electron:build           # 打包当前平台
npm run electron:build:win       # Windows: NSIS 安装包 + 便携版
npm run electron:build:mac       # macOS: DMG + ZIP（需 macOS 环境或 osxcross）
npm run electron:build:linux     # Linux: AppImage + deb

# 产物在 dist-electron/ 目录
```

> **Windows 首次打包提示**：electron-builder 需要解压 `winCodeSign` 工具包，其中包含 macOS 签名所需的符号链接。若系统未开启「开发者模式」且未以管理员身份运行，解压会失败。解决方案（任选其一）：
> 1. 以管理员身份运行终端；
> 2. 开启 Windows 设置 → 隐私和安全性 → 开发者模式；
> 3. 在 WSL2 / Linux CI 环境中打包 Windows 产物。
>
> 脚本已内置国内镜像（`npmmirror.com/mirrors/electron`）加速二进制下载。



---

## 使用指南

### 首次设置

1. 启动服务后，浏览器访问 `http://服务器IP:端口`
2. 页面自动跳转到 `/setup`
3. 设置管理员密码（用于后续登录认证）
4. 设置成功后跳转到登录页面，使用刚设置的密码登录

### 创建部署模板

登录后，进入"模板管理"页面创建一个部署模板。模板包含以下核心配置：

| 配置项 | 说明 | 必填 |
|---|---|---|
| **模板名称** | 标识名称，也用作代码子目录名 | 是 |
| **Git 仓库 URL** | 要部署的应用代码仓库 | 是 |
| **SSH 密钥** | 用于拉取私有仓库 | 否 |
| **分支** | 目标分支 | 否（默认 main） |
| **部署模式** | local / container | 是 |
| **代码目录** | 代码落盘根目录 | 是 |
| **环境变量** | 键值对，部署时写入 `.env` 文件 | 否 |
| **预部署命令** | 部署前执行的命令（如安装依赖） | 否 |
| **部署命令** | 启动应用的命令（如 `npm start`） | 是 |
| **后部署命令** | 部署后执行的命令（如通知） | 否 |
| **本地配置** | 执行类型（direct/background/systemd）、运行环境等 | 否 |
| **容器配置** | compose 文件路径、构建/启动命令 | 否 |

### 执行部署

1. 在模板列表页，点击目标模板的"部署"按钮
2. 系统自动执行：清理旧实例 → Git 拉取 → 写 .env → 预命令 → 部署命令 → 后命令
3. WebSocket 实时推送部署日志到浏览器
4. 可在"部署历史"中查看历史记录和日志下载

### 查看日志

- **部署日志**：部署执行时的实时日志，支持历史回播和下载
- **实例日志**：部署完成后应用的运行日志（通过 WebSocket 实时流）
  - 本地后台模式：`tail -f app.log`
  - 本地 systemd 模式：`journalctl -u 服务名 -f`
  - 容器模式：`docker-compose logs -f`
  - 支持日志过滤、级别筛选、自定义回溯行数

### 管理服务器节点

1. 进入"服务器节点"页面
2. 添加远程服务器（主机名/IP、端口、SSH 认证信息）
3. 使用"测试连接"验证连通性
4. 使用"分发密钥"将选中的 SSH 密钥分发到目标服务器
5. 节点状态自动定时检测

---

## 配置说明

### 命令行参数

| 参数 | 默认值 | 说明 |
|---|---|---|
| `--bind` | `0.0.0.0` (Web) / `127.0.0.1` (Electron) | 监听地址 |
| `--port` | `8080` (Web) / `0` 随机端口 (Electron) | 监听端口 |
| `--data-dir` | `/var/lib/linux-deploy-manager` (Linux) / `%APPDATA%` (Windows) | 数据存储目录 |
| `--log-dir` | `/var/log/linux-deploy-manager` (Linux) / `{data-dir}/logs` (Windows) | 日志存储目录 |
| `--mode` | `release` | 运行模式：`debug` / `release` |

### 环境变量

| 变量 | 作用 | 优先级 |
|---|---|---|
| `LDM_BIND` | 监听地址 | 高于默认值，低于 `--bind` |
| `LDM_PORT_FILE` | 端口文件路径（Electron 模式使用） | 环境变量最高优先级 |
| `LDM_DATA_DIR` | 数据目录 | 高于默认值，低于 `--data-dir` |
| `LDM_LOG_DIR` | 日志目录 | 高于默认值，低于 `--log-dir` |

配置优先级：**命令行参数 > 环境变量 > 默认值**

### 系统设置界面

登录后可通过 `/settings` 页面配置：
- 系统级 sudo 密码（用于容器化部署时的 Docker 命令）
- 密码修改

---

## API 参考

所有 API 以 `/api` 为前缀。需要认证的接口需在请求头携带 `Authorization: Bearer <JWT_TOKEN>`。

### 认证

| 方法 | 路径 | 说明 | 认证 |
|---|---|---|---|
| GET | `/api/auth/status` | 获取认证状态 | 否 |
| POST | `/api/auth/setup` | 首次设置密码 | 否 |
| POST | `/api/auth/login` | 登录获取 JWT | 否 |
| POST | `/api/auth/change-password` | 修改密码 | 是 |

### SSH 密钥

| 方法 | 路径 | 说明 | 认证 |
|---|---|---|---|
| GET | `/api/keys` | 密钥列表 | 是 |
| POST | `/api/keys` | 创建密钥 | 是 |
| GET | `/api/keys/:id` | 获取密钥详情 | 是 |
| DELETE | `/api/keys/:id` | 删除密钥 | 是 |
| POST | `/api/keys/:id/test` | 测试密钥连通性 | 是 |

### 部署模板

| 方法 | 路径 | 说明 | 认证 |
|---|---|---|---|
| GET | `/api/projects` | 模板列表 | 是 |
| POST | `/api/projects` | 创建项目 | 是 |
| GET | `/api/projects/:id` | 获取项目详情 | 是 |
| PUT | `/api/projects/:id` | 更新项目 | 是 |
| DELETE | `/api/projects/:id` | 删除项目 | 是 |
| POST | `/api/projects/:id/clone` | 克隆项目 | 是 |
| GET | `/api/projects/:id/branches` | 获取远程分支列表 | 是 |
| POST | `/api/projects/:id/deploy` | 触发部署 | 是 |

### 部署任务

| 方法 | 路径 | 说明 | 认证 |
|---|---|---|---|
| GET | `/api/tasks` | 任务列表 | 是 |
| GET | `/api/tasks/:id` | 获取任务详情 | 是 |
| GET | `/api/tasks/:id/log` | 获取任务日志 | 是 |
| POST | `/api/tasks/:id/cancel` | 取消任务 | 是 |
| GET | `/api/tasks/:id/download` | 下载日志文件 | 是 |

### 服务器节点

| 方法 | 路径 | 说明 | 认证 |
|---|---|---|---|
| GET | `/api/server-nodes` | 节点列表 | 是 |
| POST | `/api/server-nodes` | 添加节点 | 是 |
| GET | `/api/server-nodes/:id` | 获取节点详情 | 是 |
| PUT | `/api/server-nodes/:id` | 更新节点 | 是 |
| DELETE | `/api/server-nodes/:id` | 删除节点 | 是 |
| POST | `/api/server-nodes/:id/test` | 测试连接 | 是 |
| POST | `/api/server-nodes/:id/distribute-key` | 分发 SSH 密钥 | 是 |

### 文件系统

| 方法 | 路径 | 说明 | 认证 |
|---|---|---|---|
| GET | `/api/fs/list` | 列出目录 | 是 |
| POST | `/api/fs/check-dir` | 检查部署目录状态 | 是 |

### 环境管理

| 方法 | 路径 | 说明 | 认证 |
|---|---|---|---|
| GET | `/api/envman/detect` | 检测已安装的环境管理工具 | 是 |
| GET | `/api/envman/envs` | 列出指定工具的环境列表 | 是 |
| POST | `/api/envman/envs` | 创建新环境 | 是 |

### 系统设置

| 方法 | 路径 | 说明 | 认证 |
|---|---|---|---|
| GET | `/api/settings` | 获取系统设置 | 是 |
| POST | `/api/settings` | 更新系统设置 | 是 |
| PUT | `/api/settings` | 更新系统设置 | 是 |

### WebSocket

| 路径 | 说明 |
|---|---|
| `/ws/deploy/:task_id` | 实时推送部署日志 |
| `/ws/instance-logs/:project_id` | 实时推送实例运行日志（支持 tail/journalctl/docker-compose logs） |

---

## 项目结构

```
linux-deploy-manager/
├── cmd/server/               # Go 后端入口
│   ├── main.go               # 路由注册、启动入口
│   └── web/dist/             # go:embed 嵌入的前端静态资源
├── internal/
│   ├── auth/                 # 用户认证（JWT + bcrypt）
│   ├── config/               # 配置管理（命令行/环境变量/默认值）
│   ├── deployer/             # 部署引擎
│   │   ├── deployer.go       # 部署流程编排
│   │   ├── local_executor.go # 本地执行器
│   │   ├── remote_executor.go# 远程 SSH 执行器
│   │   ├── launch_unix.go    # Unix 后台启动（nohup）
│   │   ├── launch_windows.go # Windows 后台启动（分离进程）
│   │   ├── proc_unix.go      # Unix 进程终止（SIGTERM/SIGKILL）
│   │   ├── proc_windows.go   # Windows 进程终止（taskkill）
│   │   └── log.go            # 日志缓冲区
│   ├── envman/               # 环境管理器（NVM/Conda/Pyenv）
│   ├── fs/                   # 文件系统服务
│   ├── git/                  # Git 操作封装
│   ├── handler/              # HTTP 处理器
│   │   ├── auth_handler.go
│   │   ├── key_handler.go
│   │   ├── project_handler.go
│   │   ├── task_handler.go
│   │   ├── server_node_handler.go
│   │   ├── setting_handler.go
│   │   ├── envman_handler.go
│   │   ├── fs_handler.go
│   │   └── instance_log_handler.go
│   ├── middleware/           # Gin 中间件（JWT 认证等）
│   ├── model/                # GORM 数据模型（SQLite）
│   ├── remote/               # 远程连接管理
│   │   ├── sshclient/        # SSH 客户端
│   │   └── sftp/             # SFTP 文件传输
│   ├── repository/           # 数据访问层
│   ├── service/              # 业务逻辑层
│   ├── sysutil/              # 跨平台系统工具
│   │   ├── sysutil.go        # 平台检测
│   │   ├── shell_unix.go     # Unix Shell 命令
│   │   └── shell_windows.go  # Windows Shell 命令
│   └── websocket/            # WebSocket 管理器
├── web/                      # React 前端
│   ├── src/                  # 源代码
│   │   ├── components/       # 通用组件
│   │   ├── pages/            # 页面组件
│   │   ├── stores/           # Zustand 状态管理
│   │   ├── utils/            # 工具函数
│   │   └── main.tsx          # 入口
│   ├── vite.config.ts        # Vite 配置
│   └── package.json
├── electron/                 # Electron 桌面端
│   ├── main.js               # 主进程
│   └── preload.js            # preload 脚本
├── package.json              # Electron 打包配置
├── build.ps1                 # Windows 构建脚本
├── deploy.sh                 # Docker 部署脚本
├── deploy-localhost.sh       # Linux 本地部署脚本
├── Dockerfile                # 容器化构建镜像
├── docker-compose.yml        # Docker Compose 配置
├── Makefile                  # Unix 构建命令
├── CHANGELOG.md
└── README.md
```

---

## 贡献指南

欢迎贡献代码、报告问题或提出改进建议！

完整的贡献指南请参阅 [docs/CONTRIBUTING.md](./docs/CONTRIBUTING.md)。

### 快速开始

```bash
# 前置要求: Go 1.22+, Node.js 18+
# 启动后端
go run ./cmd/server --mode debug --port 8080

# 另一个终端启动前端
cd web && npm install && npm run dev

# 浏览器访问 http://localhost:3000
```

### 代码审查

本项目建立了系统的代码审查机制，所有 PR 必须经过审查方可合并：

- **审查标准**：[docs/code-review-standards.md](./docs/code-review-standards.md)
- **PR 模板**：[.github/PULL_REQUEST_TEMPLATE.md](./.github/PULL_REQUEST_TEMPLATE.md)
- **提交规范**：遵循 [Conventional Commits](https://www.conventionalcommits.org/)

### 构建发布

```bash
# Linux 二进制
make build

# 跨平台编译（CGO_ENABLED=0，零依赖）
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o bin/ldm-linux ./cmd/server
CGO_ENABLED=0 GOOS=windows GOARCH=amd64 go build -o bin/ldm.exe ./cmd/server
CGO_ENABLED=0 GOOS=darwin GOARCH=amd64 go build -o bin/ldm-macos ./cmd/server

# Electron 打包
npm run electron:build

# Windows 构建
.\build.ps1
```

---

## 许可证

MIT License

Copyright (c) 2026 Linux Deploy Manager

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
