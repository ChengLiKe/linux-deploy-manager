# Electron 桌面客户端改造计划

## 目标
将 `linux-deploy-manager` 从 Web 应用改造为 Electron 桌面应用，双击即可启动，无需部署到 Linux 服务器。

## 架构设计

```
┌─────────────────────────────────────────────────┐
│              Electron 主进程 (Node.js)           │
│  ┌──────────────────────────────────────────┐   │
│  │  启动 Go 子进程 → 读取端口文件 →        │   │
│  │  创建 BrowserWindow → 加载前端           │   │
│  └──────────────────────────────────────────┘   │
│                      │                          │
│          preload.js (IPC 桥接)                   │
│                      │                          │
│  ┌──────────────────────────────────────────┐   │
│  │  React 前端 (HashRouter)                 │   │
│  │  • 动态获取后端端口                       │   │
│  │  • 动态 WebSocket URL                     │   │
│  │  • 开发时加载 localhost:5173             │   │
│  │  • 生产时加载 file://.../index.html      │   │
│  └──────────────────────────────────────────┘   │
│                      │                          │
│          localhost:PORT (HTTP API + WebSocket)   │
│                      │                          │
│  ┌──────────────────────────────────────────┐   │
│  │  Go 后端 (gin + sqlite + ssh)             │   │
│  │  • 绑定 127.0.0.1，随机端口               │   │
│  │  • 数据目录 = Electron userData          │   │
│  │  • 端口写入文件通知 Electron              │   │
│  └──────────────────────────────────────────┘   │
└─────────────────────────────────────────────────┘
```

## 接口契约

### 1. Go ↔ Electron 通信（端口文件）
- Go 启动时读取环境变量 `LDM_PORT_FILE`，如果设置，将实际监听端口写入该文件
- Go 在 Electron 模式下绑定 `127.0.0.1`，默认端口 0（随机）
- Electron 主进程启动 Go 后，轮询读取端口文件，获取端口后创建窗口

### 2. Preload → 前端 API
```typescript
interface ElectronAPI {
  getBackendPort(): Promise<number>  // 获取 Go 后端端口
  isDev: boolean                     // 是否为开发模式
}
```
- 在浏览器环境中（非 Electron），`window.electronAPI` 为 `undefined`
- 前端检测到 `window.electronAPI` 存在时，使用动态端口；否则使用原有行为

### 3. 数据目录约定
- Electron 主进程通过 `LDM_DATA_DIR` 和 `LDM_LOG_DIR` 环境变量传入
- 值为 `app.getPath('userData')`
- 示例：`C:\Users\XXX\AppData\Roaming\linux-deploy-manager\`

## 改造阶段

### Stage 1: Go 后端改造（并行）
- **文件**: `internal/config/config.go`, `cmd/server/main.go`
- **任务**:
  1. `config.go` 增加环境变量 `LDM_PORT_FILE`，支持 `port=0` 随机端口
  2. `config.go` 添加 `PortFile` 配置项
  3. `main.go` 启动后写入端口文件
  4. `main.go` 默认绑定地址改为 `127.0.0.1`（当 PortFile 设置时）

### Stage 2: Electron 基础设施（并行）
- **文件**: 新建 `electron/main.js`, `electron/preload.js`, `electron/package.json`, `Makefile` 更新
- **任务**:
  1. 根目录 `package.json` 添加 Electron 相关依赖和 scripts
  2. `electron/main.js` - 主进程：启动 Go 子进程、轮询端口、创建窗口
  3. `electron/preload.js` - 预加载脚本：暴露 `electronAPI`
  4. `Makefile` 更新 - 添加 `electron-dev`, `electron-build`, `electron-pack` 等目标

### Stage 3: 前端适配（并行）
- **文件**: `web/src/main.tsx`, `web/src/utils/api.ts`, `web/src/hooks/useInstanceLogSocket.ts`, 新增 `web/src/types/electron.d.ts`
- **任务**:
  1. `main.tsx` - `BrowserRouter` → `HashRouter`
  2. `api.ts` - 支持动态 baseURL（Electron 模式下从 `getBackendPort()` 获取）
  3. `useInstanceLogSocket.ts` - 支持动态 WebSocket URL
  4. `electron.d.ts` - TypeScript 类型声明

### Stage 4: 验证与联调（顺序）
- 确保各阶段文件修改不冲突
- 检查 Go 编译、前端构建、Electron 启动流程
- 验证数据目录和端口文件工作正常

## 注意事项
- 保持向后兼容：改造后的 Go 后端仍可独立运行（通过命令行参数）
- 开发模式：Electron 加载 `http://localhost:5173`，同时需要启动 Go 后端
- 生产模式：前端 `vite build` 后嵌入 Go 的 embed 中，Electron 加载 `file://`
- Windows 路径处理：Go 子进程路径使用 `"bin/ldm-server.exe"` 或 `"bin/ldm-server"`
