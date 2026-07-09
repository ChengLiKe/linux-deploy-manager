import { useEffect, useRef, useState, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Maximize2, Minimize2 } from 'lucide-react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { buildWsUrl } from '../utils/electron'

export default function TerminalPage() {
  const { nodeId } = useParams<{ nodeId: string }>()
  const navigate = useNavigate()
  const terminalRef = useRef<HTMLDivElement>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const xtermRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const [connected, setConnected] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const [nodeName, setNodeName] = useState('')
  const [error, setError] = useState('')

  const sendResize = useCallback(() => {
    if (xtermRef.current && wsRef.current?.readyState === WebSocket.OPEN) {
      const { cols, rows } = xtermRef.current
      wsRef.current.send(JSON.stringify({ type: 'resize', data: { cols, rows } }))
    }
  }, [])

  useEffect(() => {
    if (!terminalRef.current || !nodeId) return

    // 初始化 xterm
    const term = new Terminal({
      cursorBlink: true,
      cursorStyle: 'block',
      fontSize: 14,
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Consolas', monospace",
      theme: {
        background: '#1e1e2e',
        foreground: '#cdd6f4',
        cursor: '#f5e0dc',
        selectionBackground: '#585b70',
        black: '#45475a',
        red: '#f38ba8',
        green: '#a6e3a1',
        yellow: '#f9e2af',
        blue: '#89b4fa',
        magenta: '#f5c2e7',
        cyan: '#94e2d5',
        white: '#bac2de',
        brightBlack: '#585b70',
        brightRed: '#f38ba8',
        brightGreen: '#a6e3a1',
        brightYellow: '#f9e2af',
        brightBlue: '#89b4fa',
        brightMagenta: '#f5c2e7',
        brightCyan: '#94e2d5',
        brightWhite: '#a6adc8',
      },
      allowTransparency: false,
      scrollback: 5000,
    })

    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    term.open(terminalRef.current)
    term.focus()

    xtermRef.current = term
    fitAddonRef.current = fitAddon

    // 连接到 WebSocket
    const token = localStorage.getItem('token')
    ;(async () => {
      const baseUrl = await buildWsUrl(`/ws/terminal/${nodeId}`)
      const wsUrl = token ? `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}` : baseUrl
      const ws = new WebSocket(wsUrl)
      wsRef.current = ws

      ws.onopen = () => {
        setConnected(true)
        setError('')
        setTimeout(() => {
          fitAddon.fit()
          sendResize()
        }, 100)
      }

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data)
          if (msg.type === 'error') {
            setError(msg.message)
            return
          }
          if (msg.type === 'info') {
            setNodeName(msg.session_id || '')
            term.writeln(`\x1b[32m[连接已建立]\x1b[0m ${msg.message || ''}`)
            return
          }
          if (msg.type === 'close') {
            term.writeln(`\x1b[33m${msg.message || '连接已关闭'}\x1b[0m`)
            return
          }
          if (msg.type === 'stderr') {
            term.writeln(`\x1b[31m${msg.data}\x1b[0m`)
            return
          }
        } catch {
          // 纯文本输出（直接的终端输出）
          term.write(event.data)
        }
      }

      ws.onclose = () => {
        setConnected(false)
        term.writeln('\x1b[31m[连接已断开]\x1b[0m')
      }

      ws.onerror = () => {
        setError('WebSocket 连接失败')
      }

      // 用户输入 → WebSocket
      term.onData((data) => {
        const wsc = wsRef.current
        if (wsc && wsc.readyState === WebSocket.OPEN) {
          wsc.send(JSON.stringify({ type: 'input', data: { text: data } }))
        }
      })
    })()

    // 窗口大小变化 → 调整 PTY
    const handleResize = () => {
      try {
        fitAddon.fit()
        sendResize()
      } catch {}
    }
    window.addEventListener('resize', handleResize)

    // ResizeObserver for parent container changes
    const resizeObserver = new ResizeObserver(() => {
      setTimeout(handleResize, 50)
    })
    if (terminalRef.current) {
      resizeObserver.observe(terminalRef.current)
    }

    // 心跳保持连接
    const ping = setInterval(() => {
      const wsc = wsRef.current
      if (wsc && wsc.readyState === WebSocket.OPEN) {
        wsc.send(JSON.stringify({ type: 'ping' }))
      }
    }, 30000)

    return () => {
      clearInterval(ping)
      window.removeEventListener('resize', handleResize)
      resizeObserver.disconnect()
      const wsc = wsRef.current
      if (wsc) wsc.close()
      term.dispose()
    }
  }, [nodeId, sendResize])

  useEffect(() => {
    setTimeout(() => {
      try {
        fitAddonRef.current?.fit()
        sendResize()
      } catch {}
    }, 200)
  }, [fullscreen, sendResize])

  const toggleFullscreen = () => setFullscreen(!fullscreen)

  return (
    <div className={`flex flex-col ${fullscreen ? 'fixed inset-0 z-50' : 'h-full'}`}>
      {/* 顶部栏 */}
      <div className="flex items-center justify-between px-4 py-2 bg-slate-900 border-b border-slate-700 shrink-0">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/terminal')}
            className="p-1 text-slate-400 hover:text-white hover:bg-slate-700 rounded transition-colors"
            title="返回终端管理"
          >
            <ArrowLeft size={18} />
          </button>
          <span className="text-sm font-medium text-slate-200">
            SSH 终端 {nodeName ? `- ${nodeName}` : `#${nodeId}`}
          </span>
          <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium ${
            connected ? 'bg-green-900/50 text-green-400' : 'bg-red-900/50 text-red-400'
          }`}>
            <span className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-green-400' : 'bg-red-400'}`} />
            {connected ? '已连接' : '已断开'}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={toggleFullscreen}
            className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-700 rounded transition-colors"
            title={fullscreen ? '退出全屏' : '全屏'}
          >
            {fullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
          </button>
        </div>
      </div>

      {/* 错误提示 */}
      {error && (
        <div className="px-4 py-2 bg-red-900/30 border-b border-red-800 text-sm text-red-300">
          {error}
        </div>
      )}

      {/* 终端 */}
      <div ref={terminalRef} className="flex-1 bg-[#1e1e2e] overflow-hidden" />
    </div>
  )
}
