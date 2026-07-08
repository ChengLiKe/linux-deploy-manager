import { useState, useEffect, useCallback } from 'react'
import { Download, RotateCw, AlertTriangle, CheckCircle, X, ChevronDown } from 'lucide-react'

type UpdateState =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'available'; version: string; releaseDate?: string; releaseNotes?: string }
  | { status: 'not-available' }
  | { status: 'downloading'; percent: number; bytesPerSecond?: number; total?: number; transferred?: number }
  | { status: 'downloaded' }
  | { status: 'error'; message: string }

export default function UpdateNotification() {
  const [state, setState] = useState<UpdateState>({ status: 'idle' })
  const [dismissed, setDismissed] = useState(false)
  const [expanded, setExpanded] = useState(false)

  // 监听 Electron 更新事件
  useEffect(() => {
    if (!window.electronAPI) return

    const cleanup = window.electronAPI.onUpdateEvent((event) => {
      switch (event.type) {
        case 'checking':
          setState({ status: 'checking' })
          setDismissed(false)
          break
        case 'available':
          setState({
            status: 'available',
            version: event.version || '',
            releaseDate: event.releaseDate,
            releaseNotes: event.releaseNotes,
          })
          setDismissed(false)
          break
        case 'not-available':
          setState({ status: 'not-available' })
          // 3秒后自动隐藏
          setTimeout(() => setDismissed(true), 3000)
          break
        case 'download-progress':
          setState({
            status: 'downloading',
            percent: Math.round(event.percent || 0),
            bytesPerSecond: event.bytesPerSecond,
            total: event.total,
            transferred: event.transferred,
          })
          break
        case 'downloaded':
          setState({ status: 'downloaded' })
          break
        case 'error':
          setState({ status: 'error', message: event.message || '更新检查失败' })
          break
      }
    })

    return cleanup
  }, [])

  const handleCheck = useCallback(async () => {
    if (!window.electronAPI) return
    setState({ status: 'checking' })
    await window.electronAPI.checkForUpdate()
  }, [])

  const handleDownload = useCallback(async () => {
    if (!window.electronAPI) return
    await window.electronAPI.downloadUpdate()
  }, [])

  const handleInstall = useCallback(async () => {
    if (!window.electronAPI) return
    await window.electronAPI.installUpdate()
  }, [])

  const handleDismiss = useCallback(() => {
    setDismissed(true)
    // 状态回归 idle 以便下次检测
    setTimeout(() => setState({ status: 'idle' }), 300)
  }, [])

  // 不在 Electron 环境或不显示
  if (!window.electronAPI || dismissed || state.status === 'idle') {
    return null
  }

  // 无可用更新 - 短暂提示后消失
  if (state.status === 'not-available') {
    return (
      <div className="bg-emerald-50 border-b border-emerald-200 px-4 py-2 text-sm text-emerald-700 flex items-center justify-center gap-2">
        <CheckCircle size={14} />
        <span>当前已是最新版本</span>
      </div>
    )
  }

  // 正在检查
  if (state.status === 'checking') {
    return (
      <div className="bg-blue-50 border-b border-blue-200 px-4 py-2 text-sm text-blue-700 flex items-center justify-center gap-2">
        <RotateCw size={14} className="animate-spin" />
        <span>正在检查更新...</span>
      </div>
    )
  }

  // 错误
  if (state.status === 'error') {
    return (
      <div className="bg-red-50 border-b border-red-200 px-4 py-2 text-sm text-red-700 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <AlertTriangle size={14} />
          <span>更新检查失败：{state.message}</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleCheck}
            className="text-red-600 hover:text-red-800 underline text-xs"
          >
            重试
          </button>
          <button onClick={handleDismiss} className="text-red-400 hover:text-red-600">
            <X size={14} />
          </button>
        </div>
      </div>
    )
  }

  // 下载中
  if (state.status === 'downloading') {
    const displayPercent = state.percent
    return (
      <div className="bg-blue-50 border-b border-blue-200 px-4 py-2 text-sm text-blue-700">
        <div className="flex items-center justify-between mb-1">
          <span className="flex items-center gap-2">
            <Download size={14} />
            正在下载更新... {displayPercent}%
          </span>
        </div>
        <div className="w-full bg-blue-200 rounded-full h-1.5">
          <div
            className="bg-blue-600 h-1.5 rounded-full transition-all duration-300"
            style={{ width: `${displayPercent}%` }}
          />
        </div>
      </div>
    )
  }

  // 已下载完毕
  if (state.status === 'downloaded') {
    return (
      <div className="bg-green-50 border-b border-green-200 px-4 py-2 text-sm text-green-700 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <CheckCircle size={14} />
          <span>更新已下载，重启应用即可完成安装</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleInstall}
            className="bg-green-600 text-white px-3 py-1 rounded-md text-xs hover:bg-green-700 transition-colors"
          >
            立即重启安装
          </button>
          <button onClick={handleDismiss} className="text-green-500 hover:text-green-700">
            <X size={14} />
          </button>
        </div>
      </div>
    )
  }

  // 更新可用
  if (state.status === 'available') {
    return (
      <div className="bg-amber-50 border-b border-amber-200 px-4 py-2 text-sm text-amber-800">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Download size={14} />
            <span>
              发现新版本 <strong>v{state.version}</strong>
            </span>
          </div>
          <div className="flex items-center gap-2">
            {state.releaseNotes && (
              <button
                onClick={() => setExpanded(!expanded)}
                className="text-amber-600 hover:text-amber-800 flex items-center gap-1 text-xs"
              >
                {expanded ? '收起' : '更新说明'}
                <ChevronDown
                  size={12}
                  className={`transition-transform ${expanded ? 'rotate-180' : ''}`}
                />
              </button>
            )}
            <button
              onClick={handleDownload}
              className="bg-amber-600 text-white px-3 py-1 rounded-md text-xs hover:bg-amber-700 transition-colors"
            >
              下载更新
            </button>
            <button onClick={handleDismiss} className="text-amber-400 hover:text-amber-600">
              <X size={14} />
            </button>
          </div>
        </div>
        {expanded && state.releaseNotes && (
          <div className="mt-2 p-2 bg-white/60 rounded text-xs text-amber-700 max-h-32 overflow-y-auto whitespace-pre-wrap">
            {state.releaseNotes}
          </div>
        )}
      </div>
    )
  }

  return null
}
