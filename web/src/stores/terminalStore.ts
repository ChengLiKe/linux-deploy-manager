/**
 * terminalStore — 模块级终端会话管理器
 *
 * 作用：
 * 1. 缓存 WebSocket 连接，页面切换时不销毁
 * 2. 累积终端输出缓冲区，页面返回时回放
 * 3. 管理多节点多终端会话
 * 4. 持有 onmessage 替换器，页面恢复时更新输出目标
 */

type WriteFn = (data: string) => void

interface CachedSession {
  nodeId: string
  ws: WebSocket | null
  sessionId: string
  buffer: string[]
  connected: boolean
  createdAt: number
  nodeName: string
  /** 当前活跃的写入回调（由挂载的 xterm 实例提供） */
  writeFn: WriteFn | null
  /** 最近一次错误信息 */
  lastError: string
}

const sessions = new Map<string, CachedSession>()

const bufferSize = 500

function getOrCreate(nodeId: string): CachedSession {
  if (sessions.has(nodeId)) {
    return sessions.get(nodeId)!
  }
  const entry: CachedSession = {
    nodeId,
    ws: null,
    sessionId: '',
    buffer: [],
    connected: false,
    createdAt: Date.now(),
    nodeName: '',
    writeFn: null,
    lastError: '',
  }
  sessions.set(nodeId, entry)
  return entry
}

function attachWS(nodeId: string, ws: WebSocket, sessionId: string, nodeName: string) {
  const entry = getOrCreate(nodeId)
  if (entry.ws && entry.ws.readyState === WebSocket.OPEN) {
    entry.ws.close()
  }
  entry.ws = ws
  entry.sessionId = sessionId
  entry.nodeName = nodeName
  entry.connected = true
}

function appendBuffer(nodeId: string, text: string) {
  const entry = getOrCreate(nodeId)
  entry.buffer.push(text)
  if (entry.buffer.length > bufferSize) {
    entry.buffer.splice(0, entry.buffer.length - bufferSize)
  }
}

function replayBuffer(nodeId: string, writeFn: WriteFn) {
  const entry = sessions.get(nodeId)
  if (!entry) return
  for (const line of entry.buffer) {
    writeFn(line)
  }
}

function setConnected(nodeId: string, connected: boolean) {
  const entry = sessions.get(nodeId)
  if (entry) entry.connected = connected
}

/** 获取并清除最近一次错误 */
function getLastError(nodeId: string): string {
  const entry = sessions.get(nodeId)
  if (!entry) return ''
  const err = entry.lastError
  entry.lastError = ''
  return err
}

/** 设置当前 xterm 写入回调，并替换 ws.onmessage 指向新回调 */
function setWriteFn(nodeId: string, fn: WriteFn) {
  const entry = sessions.get(nodeId)
  if (!entry) return
  entry.writeFn = fn
  // 替换 ws.onmessage 指向新的写入回调
  if (entry.ws) {
    entry.ws.onmessage = buildMessageHandler(nodeId, fn)
  }
}

/** 构建 ws.onmessage 处理器，写入到指定回调 */
function buildMessageHandler(nodeId: string, writeFn: WriteFn) {
  return (event: MessageEvent) => {
    try {
      const msg = JSON.parse(event.data)
      if (msg.type === 'error') {
        const entry = sessions.get(nodeId)
        if (entry) entry.lastError = msg.message || '未知错误'
        writeFn(`\x1b[31m[连接失败] ${msg.message || '未知错误'}\x1b[0m\n`)
        return
      }
      if (msg.type === 'info') {
        const entry = sessions.get(nodeId)
        if (entry) {
          entry.nodeName = msg.node_name || entry.nodeName || `节点 #${nodeId}`
          entry.sessionId = msg.session_id || ''
        }
        writeFn(`\x1b[32m[连接已建立]\x1b[0m ${msg.message || ''}\n`)
        return
      }
      if (msg.type === 'close') {
        writeFn(`\x1b[33m${msg.message || '连接已关闭'}\x1b[0m\n`)
        setConnected(nodeId, false)
        return
      }
      if (msg.type === 'stderr') {
        const text = `\x1b[31m${msg.data}\x1b[0m`
        writeFn(text)
        appendBuffer(nodeId, text)
        return
      }
    } catch {
      // 纯文本输出
      writeFn(event.data)
      appendBuffer(nodeId, event.data)
    }
  }
}

/** 在初始 WS 连接上设置标准消息处理器 */
function setupMessageHandler(nodeId: string, ws: WebSocket) {
  const entry = getOrCreate(nodeId)
  const writeFn = (data: string) => {
    // 初始设置时 writeFn 可能为空，等 setWriteFn 调用后替换
    entry.writeFn?.(data)
  }
  ws.onmessage = buildMessageHandler(nodeId, writeFn)
  entry.ws = ws
}

function disconnect(nodeId: string) {
  const entry = sessions.get(nodeId)
  if (entry) {
    if (entry.ws && entry.ws.readyState === WebSocket.OPEN) {
      entry.ws.close()
    }
    sessions.delete(nodeId)
  }
}

function disconnectAll() {
  for (const [nodeId] of sessions) {
    disconnect(nodeId)
  }
}

function listSessions() {
  const result: Array<{
    nodeId: string
    sessionId: string
    nodeName: string
    connected: boolean
    createdAt: number
    bufferLines: number
  }> = []
  for (const [, entry] of sessions) {
    result.push({
      nodeId: entry.nodeId,
      sessionId: entry.sessionId,
      nodeName: entry.nodeName,
      connected: entry.connected,
      createdAt: entry.createdAt,
      bufferLines: entry.buffer.length,
    })
  }
  return result
}

export {
  getOrCreate,
  attachWS,
  appendBuffer,
  replayBuffer,
  setConnected,
  getLastError,
  setWriteFn,
  setupMessageHandler,
  disconnect,
  disconnectAll,
  listSessions,
}
