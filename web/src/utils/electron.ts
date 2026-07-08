/**
 * Electron 桌面模式适配工具
 * 提供后端端口获取、origin 构建、环境检测等能力
 * 在 Web 部署模式下保持原有行为不变
 */

let cachedPort: number | null = null
let portPromise: Promise<number> | null = null

/** 检测当前是否在 Electron 环境 */
export function isElectron(): boolean {
  return typeof window !== 'undefined' && !!window.electronAPI
}

/**
 * 获取 Go 后端实际监听端口
 * Electron 模式下通过 preload API 获取，结果会缓存
 * Web 模式下从当前 window.location 推断
 */
export async function getBackendPort(): Promise<number> {
  if (cachedPort !== null) return cachedPort
  if (portPromise !== null) return portPromise

  if (window.electronAPI) {
    portPromise = window.electronAPI.getBackendPort().then((port) => {
      cachedPort = port
      return port
    })
    return portPromise
  }

  // Web 模式：从当前 location 推断端口
  const port = window.location.port
    ? parseInt(window.location.port, 10)
    : window.location.protocol === 'https:' ? 443 : 80
  cachedPort = port
  return port
}

/**
 * 同步获取后端服务地址（含协议和端口）
 * 若缓存未命中且处于 Electron 模式，可能返回空字符串，
 * 建议优先使用 getBackendPort() 的异步版本
 */
export function getBackendOrigin(): string {
  if (cachedPort !== null) {
    return `http://127.0.0.1:${cachedPort}`
  }
  // Web 模式下直接返回当前 origin
  if (!isElectron()) {
    return window.location.origin
  }
  // Electron 模式但缓存未命中时返回空字符串
  return ''
}

/**
 * 构建完整的 WebSocket URL
 * 支持相对路径（如 /ws/deploy/123），自动拼接后端 origin
 */
export async function buildWsUrl(path: string): Promise<string> {
  if (path.startsWith('ws')) {
    return path
  }
  if (path.startsWith('http')) {
    return path.replace(/^http/, 'ws')
  }

  let origin: string
  if (window.electronAPI) {
    const port = await window.electronAPI.getBackendPort()
    origin = `ws://127.0.0.1:${port}`
  } else {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    origin = `${protocol}//${window.location.host}`
  }

  return `${origin}${path}`
}

/**
 * 检测是否使用 HashRouter（Electron file:// 或 URL 已包含 hash）
 */
export function isHashRouterMode(): boolean {
  return (
    window.location.protocol === 'file:' ||
    window.location.hash.startsWith('#/')
  )
}

/**
 * 统一登录跳转：HashRouter 模式下通过 hash 跳转，保持 Web 模式兼容
 */
export function navigateToLogin() {
  if (isHashRouterMode()) {
    window.location.hash = '#/login'
  } else {
    window.location.href = '/login'
  }
}

// Electron 环境下提前预热端口缓存，减少首次请求延迟
if (typeof window !== 'undefined' && window.electronAPI) {
  getBackendPort().catch((err) => {
    console.error('[Electron] Failed to preload backend port:', err)
  })
}
