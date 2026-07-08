import { useEffect, useState, useRef, useMemo, useCallback } from 'react'
import { X, Download, Wifi, WifiOff, Search, Pause, Play, RotateCw } from 'lucide-react'
import { useInstanceLogSocket, type LogLine, type ServiceMeta } from '../hooks/useInstanceLogSocket'

interface InstanceLogModalProps {
  projectId: number
  projectName: string
  onClose: () => void
}

const LEVEL_COLORS: Record<string, string> = {
  error: 'text-red-300 bg-red-950/40',
  warn: 'text-yellow-300 bg-yellow-950/20',
  info: 'text-slate-300',
  debug: 'text-slate-500',
}

const LEVEL_ICONS: Record<string, string> = {
  error: '✕',
  warn: '⚠',
  info: '·',
  debug: '…',
}

const MAX_LINES = 10000

export default function InstanceLogModal({ projectId, projectName, onClose }: InstanceLogModalProps) {
  const [logs, setLogs] = useState<LogLine[]>([])
  const [services, setServices] = useState<string[]>([])
  const [selectedService, setSelectedService] = useState('')
  const [selectedLevel, setSelectedLevel] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [tailCount, setTailCount] = useState(200)
  const [isPaused, setIsPaused] = useState(false)
  const logsEndRef = useRef<HTMLDivElement>(null)
  const logsContainerRef = useRef<HTMLDivElement>(null)
  const pendingLinesRef = useRef<LogLine[]>([])

  const { connectionStatus, connect, disconnect, sendCommand } = useInstanceLogSocket({
    projectId,
    onLog: (line) => {
      pendingLinesRef.current.push(line)
    },
    onStatus: (status) => {
      if (status === 'completed') {
        flushPendingLines()
      }
    },
    onMeta: (meta: ServiceMeta) => {
      if (meta.services && meta.services.length > 0) {
        setServices(meta.services)
      }
    },
    autoReconnect: true,
  })

  const flushPendingLines = useCallback(() => {
    if (pendingLinesRef.current.length > 0) {
      setLogs((prev) => {
        const combined = [...prev, ...pendingLinesRef.current]
        pendingLinesRef.current = []
        return combined.length > MAX_LINES ? combined.slice(-MAX_LINES) : combined
      })
    }
  }, [])

  useEffect(() => {
    const interval = setInterval(flushPendingLines, 200)
    return () => clearInterval(interval)
  }, [flushPendingLines])

  useEffect(() => {
    setLogs([])
    setServices([])
    setSelectedService('')
    pendingLinesRef.current = []
    connect()
    return () => {
      disconnect()
    }
  }, [connect, disconnect])

  useEffect(() => {
    if (!isPaused && logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [logs, isPaused])

  const filteredLogs = useMemo(() => {
    let result = logs
    if (selectedService) {
      result = result.filter((l) => l.service === selectedService)
    }
    if (selectedLevel) {
      result = result.filter((l) => l.level === selectedLevel)
    }
    if (searchQuery) {
      const q = searchQuery.toLowerCase()
      result = result.filter((l) => l.data.toLowerCase().includes(q))
    }
    if (result.length > tailCount) {
      result = result.slice(-tailCount)
    }
    return result
  }, [logs, selectedService, selectedLevel, searchQuery, tailCount])

  const handleDownload = useCallback(() => {
    const text = filteredLogs.map((l) => l.data).join('\n')
    const blob = new Blob([text], { type: 'text/plain' })
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `instance_${projectId}_log.txt`
    a.click()
    window.URL.revokeObjectURL(url)
  }, [filteredLogs, projectId])

  const handleServiceChange = useCallback((service: string) => {
    setSelectedService(service)
    sendCommand('tail', { service, tail: tailCount })
  }, [sendCommand, tailCount])

  const handleTailChange = useCallback((count: number) => {
    setTailCount(count)
    sendCommand('tail', { service: selectedService, tail: count })
  }, [sendCommand, selectedService])

  const handleReconnect = useCallback(() => {
    disconnect()
    setLogs([])
    pendingLinesRef.current = []
    setTimeout(() => connect(), 500)
  }, [disconnect, connect])

  const statusBadge = () => {
    switch (connectionStatus) {
      case 'connecting':
        return (
          <span className="flex items-center gap-1 px-2 py-0.5 text-xs bg-amber-50 text-amber-600 rounded-full">
            <span className="w-1.5 h-1.5 bg-amber-500 rounded-full animate-pulse" />
            连接中
          </span>
        )
      case 'connected':
        return (
          <span className="flex items-center gap-1 px-2 py-0.5 text-xs bg-green-50 text-green-600 rounded-full">
            <Wifi size={10} />
            实时
          </span>
        )
      case 'reconnecting':
        return (
          <span className="flex items-center gap-1 px-2 py-0.5 text-xs bg-orange-50 text-orange-600 rounded-full">
            <RotateCw size={10} className="animate-spin" />
            重连中
          </span>
        )
      default:
        return (
          <span className="flex items-center gap-1 px-2 py-0.5 text-xs bg-slate-100 text-slate-500 rounded-full">
            <WifiOff size={10} />
            已断开
          </span>
        )
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center pt-[2vh] bg-black/40 p-4" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-lg w-full max-w-5xl flex flex-col max-h-[92vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200 shrink-0">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-slate-800">{projectName} - 实例日志</h3>
            {statusBadge()}
          </div>
          <div className="flex items-center gap-2">
            {connectionStatus !== 'connected' && connectionStatus !== 'connecting' && (
              <button
                onClick={handleReconnect}
                className="flex items-center gap-1 px-2.5 py-1.5 text-xs text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-md"
              >
                <RotateCw size={14} />
                重连
              </button>
            )}
            <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg">
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2 px-4 py-2 bg-slate-50 border-b border-slate-200 shrink-0 flex-wrap">
          {services.length > 0 && (
            <>
              <span className="text-xs text-slate-500 shrink-0">服务</span>
              <select
                value={selectedService}
                onChange={(e) => handleServiceChange(e.target.value)}
                className="text-xs border border-slate-300 rounded px-2 py-1 bg-white text-slate-700"
              >
                <option value="">全部</option>
                {services.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </>
          )}
          <span className="text-xs text-slate-500 shrink-0">级别</span>
          <select
            value={selectedLevel}
            onChange={(e) => setSelectedLevel(e.target.value)}
            className="text-xs border border-slate-300 rounded px-2 py-1 bg-white text-slate-700"
          >
            <option value="">全部</option>
            <option value="error">ERROR</option>
            <option value="warn">WARN</option>
            <option value="info">INFO</option>
            <option value="debug">DEBUG</option>
          </select>
          <div className="w-px h-4 bg-slate-300 mx-1" />
          <span className="text-xs text-slate-500 shrink-0">显示</span>
          <select
            value={tailCount}
            onChange={(e) => handleTailChange(Number(e.target.value))}
            className="text-xs border border-slate-300 rounded px-2 py-1 bg-white text-slate-700"
          >
            <option value="100">100行</option>
            <option value="200">200行</option>
            <option value="500">500行</option>
            <option value="1000">1000行</option>
          </select>
          <div className="w-px h-4 bg-slate-300 mx-1" />
          <div className="flex items-center gap-1 flex-1 min-w-0">
            <Search size={12} className="text-slate-400 shrink-0" />
            <input
              type="text"
              placeholder="搜索日志..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="text-xs border border-slate-300 rounded px-2 py-1 bg-white text-slate-700 w-full min-w-0"
            />
          </div>
        </div>

        <div
          ref={logsContainerRef}
          className="flex-1 overflow-y-auto bg-slate-900 font-mono text-xs leading-relaxed"
        >
          {filteredLogs.length === 0 ? (
            <div className="text-sm text-slate-500 py-8 text-center font-mono">
              {connectionStatus === 'connecting' ? '正在连接...' : connectionStatus === 'reconnecting' ? '正在重连...' : '暂无日志'}
            </div>
          ) : (
            filteredLogs.map((line, i) => {
              const highlight = searchQuery && line.data.toLowerCase().includes(searchQuery.toLowerCase())
              const parts = highlight ? splitHighlight(line.data, searchQuery) : null
              return (
                <div
                  key={`${i}-${line.data.length}`}
                  className={`flex items-start gap-1.5 px-3 py-0.5 hover:bg-slate-800/50 min-h-5 ${LEVEL_COLORS[line.level] || LEVEL_COLORS.info}`}
                >
                  <span className="shrink-0 w-4 text-center opacity-50 select-none">
                    {LEVEL_ICONS[line.level] || LEVEL_ICONS.info}
                  </span>
                  {line.service && (
                    <span className="shrink-0 text-[10px] px-1 rounded bg-slate-700/50 text-slate-400 leading-4 mt-px">
                      {line.service}
                    </span>
                  )}
                  <span className="whitespace-pre-wrap break-all min-w-0">
                    {parts ? (
                      parts.map((part, pi) =>
                        part.highlight ? (
                          <span key={pi} className="bg-amber-500/30 text-amber-200 rounded px-0.5">{part.text}</span>
                        ) : (
                          <span key={pi}>{part.text}</span>
                        )
                      )
                    ) : (
                      line.data
                    )}
                  </span>
                </div>
              )
            })
          )}
          <div ref={logsEndRef} />
        </div>

        <div className="flex items-center justify-between px-4 py-2 bg-slate-100 border-t border-slate-200 shrink-0">
          <div className="flex items-center gap-3 text-xs text-slate-500">
            <span>{filteredLogs.length} 行</span>
            {logStats(filteredLogs) && (
              <span className="flex items-center gap-2">
                <span className="text-red-400">{logStats(filteredLogs)?.error || 0} ERR</span>
                <span className="text-yellow-400">{logStats(filteredLogs)?.warn || 0} WARN</span>
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsPaused(!isPaused)}
              className="flex items-center gap-1 px-2 py-1 text-xs text-slate-500 hover:text-slate-700 hover:bg-slate-200 rounded-md"
              title={isPaused ? '继续滚动' : '暂停滚动'}
            >
              {isPaused ? <Play size={12} /> : <Pause size={12} />}
              {isPaused ? '继续' : '暂停'}
            </button>
            {filteredLogs.length > 0 && (
              <button
                onClick={handleDownload}
                className="flex items-center gap-1 px-2 py-1 text-xs text-slate-500 hover:text-slate-700 hover:bg-slate-200 rounded-md"
              >
                <Download size={12} />
                下载
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function splitHighlight(text: string, query: string): { text: string; highlight: boolean }[] {
  const parts: { text: string; highlight: boolean }[] = []
  const lower = text.toLowerCase()
  const q = query.toLowerCase()
  let start = 0
  while (start < text.length) {
    const idx = lower.indexOf(q, start)
    if (idx === -1) {
      parts.push({ text: text.slice(start), highlight: false })
      break
    }
    if (idx > start) {
      parts.push({ text: text.slice(start, idx), highlight: false })
    }
    parts.push({ text: text.slice(idx, idx + q.length), highlight: true })
    start = idx + q.length
  }
  return parts
}

function logStats(lines: LogLine[]): { error: number; warn: number } | null {
  let error = 0
  let warn = 0
  for (const l of lines) {
    if (l.level === 'error') error++
    if (l.level === 'warn') warn++
  }
  if (error === 0 && warn === 0) return null
  return { error, warn }
}
