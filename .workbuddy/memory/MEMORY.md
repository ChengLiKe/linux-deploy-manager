# 项目长期记忆：linux-deploy-manager

## 项目定位
Go 单二进制部署管理平台（Linux 部署管家）。已从单机 root 部署工具演进为多服务器节点 + 本地/远程双执行 + Electron 桌面端。

## 关键事实
- 后端：Go（go.mod 写 1.22，但 README/CHANGELOG 写 1.23，需确认） + Gin + GORM + SQLite WAL + gorilla/websocket，`go:embed` 内嵌 `cmd/server/web/dist`。
- 前端：React 18 + Vite + Tailwind + Zustand + React Query。
- 部署引擎 `deployer/` 用 `Executor` 抽象：`local_executor`（bash -c）与 `remote_executor`（SSH/SFTP）。流程：清理旧实例→Git 拉取→写 .env→预命令→部署命令→后命令，超时 SIGTERM→SIGKILL。本地支持 direct/background/systemd，容器支持 docker-compose，可用 nvm/conda/pyenv 包装。
- 已实现的 README 未记载能力：server-node 多服务器节点（SSH 连接池/健康检测/密钥分发）、remote SSH+SFTP 远程执行、envman 环境管理器、fs 文件系统浏览、ws/instance-logs 实例日志、Electron 桌面端。

## 文档与代码一致性
- **README.md** 和 **CHANGELOG.md** 已于 2026-07-08 完全重写，对齐实际代码能力。README 涵盖全部模块（server-node/fs/envman/settings/instance-logs/electron/sysutil），CHANGELOG 基于 Git 提交历史分为 v0.1.0~v1.1.0 共 7 个版本。
- `migrations/` 和 `scripts/` 目录为空（靠 GORM AutoMigrate，无显式迁移）。
- 生产模式 Electron 真正 serve 前端的是 Go embed 的 `cmd/server/web/dist`；electron-builder 的 `files: web/dist` 属冗余。打包前必须 `make build` 生成 `bin/` 并 `copy-web`，且根 `node_modules` 默认无 electron，需先 `npm install`。

## Windows 适配（2026-07-08）
### 核心改动
- SQLite 驱动：`mattn/go-sqlite3`（CGO）→ `glebarez/sqlite`（纯 Go），解锁 `CGO_ENABLED=0` 编译
- `internal/sysutil/` 跨平台 shell 工具包：Unix → `bash -c`，Windows → `cmd /C`；含 `DetachProcess`、`IsWindows` 等
- `deployer/` 全面适配：平台化进程终止（`proc_unix.go`/`proc_windows.go`）、后台启动（`launch_unix.go`/`launch_windows.go`）、本地文件操作避 Linux 命令（base64/chmod/mkdir -p）
- 配置默认路径平台化：Windows → `%APPDATA%`，Linux → `/var/lib`
- `envman` 用 `sysutil` 替代裸 `exec.Command("bash", "-c")`
- `instance_log_handler`：tail 用 PowerShell，journalctl 仅 Unix，sudo 用 sysutil 包装
- `build.ps1`：Windows 原生构建脚本

### 编译验证
- `CGO_ENABLED=0 go build ./cmd/server` ✅，15.8 MB 零依赖 PE 二进制
- `go vet ./...` ✅ 无警告

## Electron 打包
- 配置完成：`package.json` 含完整 electron-builder 配置（应用元数据/版权/图标/NSIS 安装选项/macOS DMG/Linux deb+AppImage）；`scripts/electron-build.js` 自动化构建前端+Go后端+图标+打包；`electron/installer.nsh` 实现 Windows 开机自启；`electron/after-install.sh`/`after-remove.sh` 处理 Linux 包后脚本。
- 实际打包验证：Windows `npm run electron:build:win` 成功，产出 `dist-electron/Linux Deploy Manager-Setup-1.1.0-win-x64.exe` 和 `dist-electron/Linux Deploy Manager-Portable-1.1.0-win-x64.exe`（均约 80 MB），Go 后端二进制已正确嵌入 `resources/bin/`。
- 注意：Windows 首次打包需以管理员/开发者模式解压 `winCodeSign` 工具包；macOS/Linux 打包需在对应平台或交叉编译环境执行。
