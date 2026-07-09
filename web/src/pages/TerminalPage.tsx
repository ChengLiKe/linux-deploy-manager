import { useEffect, useRef, useState, useCallback } from 'react'
import { useParams } from 'react-router-dom'
import { Maximize2, Minimize2, Search, RotateCcw } from 'lucide-react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { SearchAddon } from '@xterm/addon-search'
import '@xterm/xterm/css/xterm.css'
import { buildWsUrl } from '../utils/electron'
import * as termStore from '../stores/terminalStore'

const THEMES: Record<string, Terminal['options']['theme']> = {
  catppuccin: {
    background: '#1e1e2e', foreground: '#cdd6f4', cursor: '#f5e0dc',
    selectionBackground: '#585b70',
    black: '#45475a', red: '#f38ba8', green: '#a6e3a1', yellow: '#f9e2af',
    blue: '#89b4fa', magenta: '#f5c2e7', cyan: '#94e2d5', white: '#bac2de',
    brightBlack: '#585b70', brightRed: '#f38ba8', brightGreen: '#a6e3a1',
    brightYellow: '#f9e2af', brightBlue: '#89b4fa', brightMagenta: '#f5c2e7',
    brightCyan: '#94e2d5', brightWhite: '#a6adc8',
  },
  dracula: {
    background: '#282a36', foreground: '#f8f8f2', cursor: '#f8f8f2',
    selectionBackground: '#44475a',
    black: '#21222c', red: '#ff5555', green: '#50fa7b', yellow: '#f1fa8c',
    blue: '#bd93f9', magenta: '#ff79c6', cyan: '#8be9fd', white: '#f8f8f2',
    brightBlack: '#6272a4', brightRed: '#ff6e6e', brightGreen: '#69ff94',
    brightYellow: '#ffffa5', brightBlue: '#d6acff', brightMagenta: '#ff92df',
    brightCyan: '#a4ffff', brightWhite: '#ffffff',
  },
  oneDark: {
    background: '#282c34', foreground: '#abb2bf', cursor: '#528bff',
    selectionBackground: '#3e4451',
    black: '#5c6370', red: '#e06c75', green: '#98c379', yellow: '#e5c07b',
    blue: '#61afef', magenta: '#c678dd', cyan: '#56b6c2', white: '#abb2bf',
    brightBlack: '#5c6370', brightRed: '#e06c75', brightGreen: '#98c379',
    brightYellow: '#e5c07b', brightBlue: '#61afef', brightMagenta: '#c678dd',
    brightCyan: '#56b6c2', brightWhite: '#ffffff',
  },
}

type ThemeName = keyof typeof THEMES

export default function TerminalPage() {
  const { nodeId } = useParams<{ nodeId: string }>()
  const terminalRef = useRef<HTMLDivElement>(null)
  const xtermRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const searchAddonRef = useRef<SearchAddon | null>(null)
  const [connected, setConnected] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const [nodeName, setNodeName] = useState('')
  const [error, setError] = useState('')
  const [showSearch, setShowSearch] = useState(false)
  const [searchText, setSearchText] = useState('')
  const [themeName, setThemeName] = useState<ThemeName>('catppuccin')
  const [showThemePicker, setShowThemePicker] = useState(false)

  const sendResize = useCallback(() => {
    const term = xtermRef.current
    if (!term || !nodeId) return
    const { cols, rows } = term
    const entry = termStore['getOrCreate'](nodeId)
    if (entry.ws && entry.ws.readyState === WebSocket.OPEN) {
      entry.ws.send(JSON.stringify({ type: 'resize', data: { cols, rows } }))
    }
  }, [nodeId])

  // ── 主初始化 effect ──
  useEffect(() => {
    if (!terminalRef.current || !nodeId) return

    // 清除 terminalRef 中可能残留的旧 xterm DOM
    terminalRef.current.innerHTML = ''

    const term = new Terminal({
      cursorBlink: true,
      cursorStyle: 'block',
      fontSize: 14,
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Consolas', 'Menlo', monospace",
      theme: THEMES[themeName],
      allowTransparency: false,
      scrollback: 50000,
      allowProposedApi: true,
      smoothScrollDuration: 80,
    })

    const fitAddon = new FitAddon()
    const webLinksAddon = new WebLinksAddon()
    const searchAddon = new SearchAddon()
    term.loadAddon(fitAddon)
    term.loadAddon(webLinksAddon)
    term.loadAddon(searchAddon)

    term.open(terminalRef.current)
    term.focus()

    xtermRef.current = term
    fitAddonRef.current = fitAddon
    searchAddonRef.current = searchAddon

    // 检查缓存
    const cached = termStore['getOrCreate'](nodeId)
    const wsAlive = cached.ws && cached.ws.readyState === WebSocket.OPEN && cached.connected

    if (wsAlive) {
      setConnected(true)
      setNodeName(cached.nodeName)
      termStore.setWriteFn(nodeId, (data: string) => {
        try { term.write(data) } catch {}
      })
      setTimeout(() => {
        termStore.replayBuffer(nodeId, (data: string) => {
          try { term.write(data) } catch {}
        })
        fitAddon.fit()
        sendResize()
        term.focus()
      }, 50)
    } else {
      // 新连接
      const token = localStorage.getItem('token')
      ;(async () => {
        // 本地终端走 /ws/terminal/local，远程节点走 /ws/terminal/:nodeId
        const baseUrl = await buildWsUrl(`/ws/terminal/${nodeId}`)
        const wsUrl = token
          ? `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`
          : baseUrl
        const ws = new WebSocket(wsUrl)

        termStore.attachWS(nodeId, ws, '', '')
        termStore.setupMessageHandler(nodeId, ws)
        termStore.setWriteFn(nodeId, (data: string) => {
          try { term.write(data) } catch {}
        })

        ws.onopen = () => {
          termStore.setConnected(nodeId, true)
          setConnected(true)
          setError('')
          setTimeout(() => {
            fitAddon.fit()
            sendResize()
            term.focus()
          }, 100)
        }

        ws.onclose = () => {
          termStore.setConnected(nodeId, false)
          setConnected(false)
          // 读取 store 中的错误信息
          const errMsg = termStore.getLastError(nodeId)
          if (errMsg) {
            setError(errMsg)
          }
          term.writeln('\x1b[31m[连接已断开]\x1b[0m')
        }

        ws.onerror = () => {
          setError('WebSocket 连接失败')
        }
      })()
    }

    // 输入绑定
    const inputHandler = term.onData((data) => {
      const entry = termStore['getOrCreate'](nodeId)
      if (entry.ws && entry.ws.readyState === WebSocket.OPEN) {
        entry.ws.send(JSON.stringify({ type: 'input', data: { text: data } }))
      }
    })

    const handleResize = () => {
      try { fitAddon.fit(); sendResize() } catch {}
    }
    window.addEventListener('resize', handleResize)

    const resizeObserver = new ResizeObserver(() => {
      setTimeout(handleResize, 50)
    })
    if (terminalRef.current) {
      resizeObserver.observe(terminalRef.current)
    }

    const ping = setInterval(() => {
      const entry = termStore['getOrCreate'](nodeId)
      if (entry.ws && entry.ws.readyState === WebSocket.OPEN) {
        entry.ws.send(JSON.stringify({ type: 'ping' }))
      }
    }, 30000)

    return () => {
      clearInterval(ping)
      window.removeEventListener('resize', handleResize)
      resizeObserver.disconnect()
      inputHandler.dispose()
      // 销毁 xterm 实例，避免 nodeId 切换时 DOM 叠加导致事件冲突
      term.dispose()
      xtermRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeId])

  useEffect(() => {
    setTimeout(() => {
      try { fitAddonRef.current?.fit(); sendResize(); xtermRef.current?.focus() } catch {}
    }, 300)
  }, [fullscreen, sendResize])

  const switchTheme = useCallback((name: ThemeName) => {
    setThemeName(name)
    if (xtermRef.current) {
      xtermRef.current.options.theme = THEMES[name]
      xtermRef.current.refresh(0, xtermRef.current.rows - 1)
    }
    setShowThemePicker(false)
  }, [])

  const handleSearch = useCallback((text: string) => {
    setSearchText(text)
    searchAddonRef.current?.findNext(text)
  }, [])

  const handleSearchPrev = useCallback(() => {
    searchAddonRef.current?.findPrevious(searchText)
  }, [searchText])

  return (
    <div className={`flex flex-col ${fullscreen ? 'fixed inset-0 z-50' : 'flex-1'}`}>
      {/* 工具栏 */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-[#1e1e2e] border-b border-[#313244] shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xs font-medium text-slate-200 truncate">
            {nodeName || `节点 #${nodeId}`}
          </span>
          <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium ${
            connected ? 'bg-green-900/50 text-green-400' : 'bg-red-900/50 text-red-400'
          }`}>
            <span className={`w-1 h-1 rounded-full ${connected ? 'bg-green-400' : 'bg-red-400'}`} />
            {connected ? '已连接' : '已断开'}
          </span>
        </div>
        <div className="flex items-center gap-0.5">
          <div className="relative">
            <button
              onClick={() => setShowThemePicker(!showThemePicker)}
              className="p-1 text-slate-500 hover:text-white hover:bg-[#313244] rounded transition-colors"
              title="切换主题"
            >
              <RotateCcw size={13} />
            </button>
            {showThemePicker && (
              <div className="absolute right-0 top-full mt-1 bg-[#313244] border border-[#45475a] rounded-lg shadow-xl z-10 py-1 min-w-[110px]">
                {(Object.keys(THEMES) as ThemeName[]).map((name) => (
                  <button
                    key={name}
                    onClick={() => switchTheme(name)}
                    className={`w-full text-left px-2.5 py-1.5 text-[11px] transition-colors ${
                      themeName === name
                        ? 'text-amber-400 bg-[#45475a]'
                        : 'text-slate-300 hover:bg-[#3b3e4f]'
                    }`}
                  >
                    {name === 'catppuccin' ? 'Catppuccin' : name === 'dracula' ? 'Dracula' : 'One Dark'}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            onClick={() => setShowSearch(!showSearch)}
            className="p-1 text-slate-500 hover:text-white hover:bg-[#313244] rounded transition-colors"
            title="搜索"
          >
            <Search size={13} />
          </button>
          <button
            onClick={() => setFullscreen(!fullscreen)}
            className="p-1 text-slate-500 hover:text-white hover:bg-[#313244] rounded transition-colors"
            title={fullscreen ? '退出全屏' : '全屏'}
          >
            {fullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </button>
        </div>
      </div>

      {/* 搜索栏 */}
      {showSearch && (
        <div className="flex items-center gap-2 px-3 py-1 bg-[#313244] border-b border-[#45475a]">
          <input
            type="text"
            value={searchText}
            onChange={(e) => handleSearch(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleSearch(searchText) }}
            className="flex-1 px-2 py-0.5 text-[11px] bg-[#1e1e2e] text-slate-200 border border-[#45475a] rounded focus:outline-none focus:border-amber-500 placeholder-slate-500"
            placeholder="搜索终端输出..."
            autoFocus
          />
          <button onClick={handleSearchPrev} className="px-1.5 py-0.5 text-[10px] text-slate-400 hover:text-white border border-[#45475a] rounded hover:bg-[#45475a] transition-colors">上</button>
          <button onClick={() => { searchAddonRef.current?.findNext(searchText); xtermRef.current?.focus() }} className="px-1.5 py-0.5 text-[10px] text-slate-400 hover:text-white border border-[#45475a] rounded hover:bg-[#45475a] transition-colors">下</button>
          <button onClick={() => { setShowSearch(false); setSearchText(''); xtermRef.current?.focus() }} className="text-[10px] text-slate-500 hover:text-white px-1">✕</button>
        </div>
      )}

      {error && (
        <div className="px-3 py-1 bg-red-900/30 border-b border-red-800 text-[11px] text-red-300">{error}</div>
      )}

      {/* 终端容器 — 小圆角 rounded-lg + 隐藏滚动条 */}
      <div
        ref={terminalRef}
        className="flex-1 overflow-hidden [&_.xterm]:h-full [&_.xterm-viewport]:!overflow-y-auto [&_.xterm-viewport::-webkit-scrollbar]:!hidden"
        onClick={() => xtermRef.current?.focus()}
      />
    </div>
  )
}
