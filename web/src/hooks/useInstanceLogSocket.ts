import { useState, useRef, useCallback, useEffect } from 'react'

export interface LogLine {
  data: string
  level: 'error' | 'warn' | 'info' | 'debug'
  service: string
}

export interface ServiceMeta {
  services: string[]
  service: string
  lines: number
}

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'reconnecting'

interface UseInstanceLogSocketOptions {
  projectId: number
  onLog?: (line: LogLine) => void
  onStatus?: (status: string) => void
  onMeta?: (meta: ServiceMeta) => void
  autoReconnect?: boolean
}

export function useInstanceLogSocket(options: UseInstanceLogSocketOptions) {
  const { projectId, onLog, onStatus, onMeta, autoReconnect = true } = options
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('disconnected')
  const [wsUrl, setWsUrl] = useState<string | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectCount = useRef(0)
  const reconnectTimer = useRef<ReturnType<typeof setTimeout>>()
  const shouldReconnect = useRef(autoReconnect)
  const callbacks = useRef({ onLog, onStatus, onMeta })
  callbacks.current = { onLog, onStatus, onMeta }

  // 动态解析 WebSocket URL，支持 Electron 动态端口
  useEffect(() => {
    if (window.electronAPI) {
      window.electronAPI.getBackendPort().then((port) => {
        setWsUrl(`ws://127.0.0.1:${port}/ws/instance-logs/${projectId}`)
      })
    } else {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      setWsUrl(`${protocol}//${window.location.host}/ws/instance-logs/${projectId}`)
    }
  }, [projectId])

  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimer.current !== undefined) {
      clearTimeout(reconnectTimer.current)
      reconnectTimer.current = undefined
    }
  }, [])

  const connect = useCallback(() => {
    clearReconnectTimer()

    if (wsRef.current) {
      wsRef.current.close()
      wsRef.current = null
    }

    if (!wsUrl) {
      setConnectionStatus('disconnected')
      return
    }

    setConnectionStatus(reconnectCount.current > 0 ? 'reconnecting' : 'connecting')

    const ws = new WebSocket(wsUrl)
    wsRef.current = ws

    ws.onopen = () => {
      reconnectCount.current = 0
      setConnectionStatus('connected')
    }

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data)
        const cb = callbacks.current
        switch (msg.type) {
          case 'log':
            cb.onLog?.({
              data: msg.data || '',
              level: msg.level || 'info',
              service: msg.service || '',
            })
            break
          case 'status':
            cb.onStatus?.(msg.status)
            if (msg.status === 'completed') {
              setConnectionStatus('disconnected')
            }
            break
          case 'meta':
            cb.onMeta?.({
              services: msg.services || [],
              service: msg.service || '',
              lines: msg.lines || 0,
            })
            break
          case 'heartbeat':
            break
        }
      } catch {
        // ignore parse errors
      }
    }

    ws.onclose = () => {
      wsRef.current = null
      if (shouldReconnect.current && reconnectCount.current < 5) {
        setConnectionStatus('reconnecting')
        reconnectCount.current++
        const delays = [1000, 2000, 4000, 8000, 16000]
        const delay = delays[Math.min(reconnectCount.current - 1, delays.length - 1)]
        reconnectTimer.current = setTimeout(connect, delay)
      } else {
        setConnectionStatus('disconnected')
      }
    }

    ws.onerror = () => {
      ws.close()
    }
  }, [wsUrl, clearReconnectTimer])

  const disconnect = useCallback(() => {
    shouldReconnect.current = false
    clearReconnectTimer()
    if (wsRef.current) {
      wsRef.current.close()
      wsRef.current = null
    }
    setConnectionStatus('disconnected')
  }, [clearReconnectTimer])

  const sendCommand = useCallback((action: string, params?: Record<string, unknown>) => {
    const ws = wsRef.current
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ action, params: params || {} }))
    }
  }, [])

  useEffect(() => {
    return () => {
      disconnect()
    }
  }, [disconnect])

  return { connectionStatus, connect, disconnect, sendCommand }
}
