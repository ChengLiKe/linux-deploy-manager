import { useEffect, useRef, useState, useCallback } from 'react'

interface UseWebSocketOptions {
  onMessage?: (data: string) => void
  onStatus?: (status: string) => void
  onOpen?: () => void
  onClose?: () => void
  onError?: (error: Event) => void
}

export function useWebSocket(url: string | null, options: UseWebSocketOptions = {}) {
  const wsRef = useRef<WebSocket | null>(null)
  const [connected, setConnected] = useState(false)
  const [resolvedUrl, setResolvedUrl] = useState<string | null>(null)
  const optionsRef = useRef(options)
  optionsRef.current = options

  // 解析 WebSocket URL：支持相对路径，Electron 模式下自动拼接后端地址
  useEffect(() => {
    if (!url) {
      setResolvedUrl(null)
      return
    }

    if (url.startsWith('ws')) {
      setResolvedUrl(url)
      return
    }

    if (url.startsWith('http')) {
      setResolvedUrl(url.replace(/^http/, 'ws'))
      return
    }

    // 相对路径：需要异步解析后端 origin
    if (window.electronAPI) {
      window.electronAPI.getBackendPort().then((port) => {
        setResolvedUrl(`ws://127.0.0.1:${port}${url}`)
      })
    } else {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      setResolvedUrl(`${protocol}//${window.location.host}${url}`)
    }
  }, [url])

  const connect = useCallback(() => {
    if (!resolvedUrl) return

    // 关闭已有连接
    if (wsRef.current) {
      wsRef.current.close()
      wsRef.current = null
    }

    // 附加 JWT token 进行 WebSocket 鉴权
    const token = localStorage.getItem('token')
    const urlWithToken = token ? `${resolvedUrl}${resolvedUrl.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}` : resolvedUrl

    const ws = new WebSocket(urlWithToken)
    wsRef.current = ws

    ws.onopen = () => {
      setConnected(true)
      optionsRef.current.onOpen?.()
    }

    ws.onmessage = (event) => {
      const { onMessage, onStatus } = optionsRef.current
      try {
        const payload = JSON.parse(event.data)
        if (payload.type === 'log' && onMessage) {
          onMessage(payload.data)
        } else if (payload.type === 'status' && onStatus) {
          onStatus(payload.status)
        } else if (onMessage) {
          onMessage(event.data)
        }
      } catch {
        if (onMessage) onMessage(event.data)
      }
    }

    ws.onclose = () => {
      setConnected(false)
      optionsRef.current.onClose?.()
    }

    ws.onerror = (error) => {
      setConnected(false)
      optionsRef.current.onError?.(error)
    }
  }, [resolvedUrl])

  const disconnect = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close()
      wsRef.current = null
      setConnected(false)
    }
  }, [])

  useEffect(() => {
    return () => {
      disconnect()
    }
  }, [disconnect])

  return { connect, disconnect, connected, ws: wsRef.current }
}
