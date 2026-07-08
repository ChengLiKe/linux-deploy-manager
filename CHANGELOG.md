# 版本记录

## [v1.1.0] - 2026-07-08

### 新增
- 纯 Go SQLite 驱动（`glebarez/sqlite`），移除 CGO 依赖，支持 `CGO_ENABLED=0` 交叉编译
- 跨平台系统工具包 `internal/sysutil/`，自动适配 Linux `bash -c` 与 Windows `cmd /C`
- Windows 原生构建脚本 `build.ps1`，一键编译 Windows/Linux 双平台二进制
- 跨平台进程管理：Windows 使用 `taskkill`，Unix 使用 POSIX 信号（SIGTERM/SIGKILL）
- Windows 后台启动支持：使用 `CREATE_NEW_PROCESS_GROUP | DETACHED_PROCESS` 创建分离进程
- 配置默认路径跨平台适配（Windows `%APPDATA%` / Linux `/var/lib`）

### 变更
- SQLite 驱动：`mattn/go-sqlite3` → `glebarez/sqlite`（纯 Go），API 完全兼容
- Git SSH 命令：`/dev/null` 替换为 `os.DevNull`，兼容 Windows
- `git/service.go`：移除 Linux 专用路径硬编码
- `config/config.go`：默认数据/日志目录根据 `runtime.GOOS` 动态选择
- `envman/service.go`：命令执行改为跨平台的 `sysutil.ShellCommand`

### 修复
- Windows 上 `syscall.SIGKILL` 未定义导致的编译失败
- Windows 上 `mkdir -p` / `base64 -d` / `cat` 等 Linux 命令不可用的问题
- Windows 上 `/var/lib` 默认路径不存在的问题
- `remote_executor.go` 中未使用的 `sigNum` 变量
- Windows 环境无 `tail` / `journalctl` 命令的运行时崩溃

## [v1.0.0] - 2026-07-06

### 新增
- 多服务器节点管理：SSH 连接池、健康检测、密钥分发
- 远程执行器（SSH/SFTP），支持远程 Git 拉取与命令执行
- 环境管理工具接口（`/api/envman/detect`, `/api/envman/envs`）
- 文件系统浏览 API（`/api/fs/list`, `/api/fs/check-dir`）
- 实例日志实时流（WebSocket `/ws/instance-logs/:template_id`）
- Docker 部署支持：`Dockerfile` + `docker-compose.yml` + `deploy.sh` 自动化脚本
- 国内镜像加速（`goproxy.cn` + `npmmirror`）

### 变更
- 部署引擎集成远程/本地双执行器抽象（`Executor` 接口）
- Docker 部署脚本移除硬编码路径，通过交互式输入挂载目录
- 顶部导航栏重构，适配更多功能入口

## [v0.5.0] - 2026-07-02

### 新增
- 实例日志查看器：通过 WebSocket 实时流式输出运行中实例的日志
- `systemd journalctl` 日志、`tail -f` 文件日志、`docker-compose logs` 容器日志三种模式
- 日志过滤与级别高亮（ERROR/WARN/DEBUG/INFO）
- 文件系统服务：目录列表浏览、部署目录状态检查
- 1Panel 部署文档

### 变更
- 部署日志窗口高度增加
- 日志服务拆分：部署日志（`/ws/deploy/`）与运行日志（`/ws/instance-logs/`）

## [v0.4.0] - 2026-07-01

### 新增
- 系统设置管理（`/api/settings`）：sudo 密码、系统级配置
- 容器化部署支持 sudo 及密码自动输入
- 选择运行环境后同时覆盖预部署/执行/后部署三条命令
- 本地部署命令与运行环境选择整合

### 变更
- 容器化部署简化为仅三个配置项（`compose_file`、`build_cmd`、`up_cmd`）
- 容器化部署仅支持 `docker-compose`，移除裸 `docker run` 支持
- 移除独立部署历史页面，集成到模板卡片

### 修复
- 容器化部署误走本地命令的问题
- 部署日志内容重复显示

## [v0.3.0] - 2026-06-30

### 新增
- 环境管理工具检测：NVM（Node Version Manager）、Conda、Pyenv
- 手动运行环境检查功能
- 模板子目录自动创建
- 部署日志置顶按钮
- WebSocket 推送实时部署日志（`/ws/deploy/:task_id`）
- 部署历史查看与状态追踪
- 页面索引导航（时间线引导航）

### 变更
- 日志区域优化，容器化部署改为仅支持 `docker-compose`
- WebSocket 连接重连与超时处理

### 修复
- WebSocket 连接已结束任务日志时的 nil 指针 panic
- 模板表单输入框每输入一个字符就失去焦点的问题

## [v0.2.0] - 2026-06-29

### 新增
- 完整的 SSH 密钥管理（创建、导出、测试连通性）
- 支持识别当前用户 `~/.ssh/` 系统密钥
- 用户认证：首次运行密码设置 + bcrypt 密码认证 + JWT 会话管理
- 部署模板 CRUD：创建、编辑、克隆、删除
- 模板部署流程：Git 拉取 → 环境变量注入 → 预/执行/后三阶段命令
- 本地部署模式：直接运行、后台进程（PID 管理）
- 文件目录可视化选择器

### 变更
- 模板编辑与部署合并为单页竖向全展示布局
- 模板列表只保留部署入口，部署时自动保存
- 代码目录支持可视化选择，移除部署目录字段

### 修复
- 前端 SSH 密钥列表未调用 API 导致显示为空
- 未登录点击密钥路由报错并跳回首页的问题

## [v0.1.0] - 2026-06-27

### 新增
- 项目初始化：Go 后端 + React 前端基础框架
- 前端技术栈：React 18 + TypeScript + Vite + Tailwind CSS + Zustand + React Query
- 后端技术栈：Go 1.22+ + Gin + GORM + SQLite + gorilla/websocket
- `go:embed` 嵌入前端静态资源，单二进制发布
- 基础配置管理：命令行参数 / 环境变量 / 默认值三级优先级
