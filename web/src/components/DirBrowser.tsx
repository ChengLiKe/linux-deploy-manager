import { useState, useEffect } from 'react'
import { X, Folder, ChevronRight, ArrowUp, Loader, Server, Monitor } from 'lucide-react'
import { serverNodeApi, fsApi } from '../utils/api'

interface DirEntry {
  name: string
  path: string
}

interface Props {
  nodeId: number
  localMode: boolean
  open: boolean
  onSelect: (path: string) => void
  onClose: () => void
}

export default function DirBrowser({ nodeId, localMode, open, onSelect, onClose }: Props) {
  const [currentPath, setCurrentPath] = useState('/')
  const [entries, setEntries] = useState<DirEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [history, setHistory] = useState<string[]>([])

  const loadDir = async (path: string) => {
    setLoading(true)
    setError('')
    try {
      if (localMode) {
        const res = await fsApi.listDir(path)
        setEntries(res.data.data.entries || [])
      } else {
        const res = await serverNodeApi.listDir(nodeId, path)
        setEntries(res.data.data.entries || [])
      }
      setCurrentPath(path)
    } catch (err: any) {
      setError(err.response?.data?.message || '加载目录失败')
      setEntries([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (open) {
      loadDir('/')
    }
  }, [open, nodeId])

  const enterDir = (path: string) => {
    setHistory((prev) => [...prev, currentPath])
    loadDir(path)
  }

  const goBack = () => {
    if (history.length === 0) return
    const prev = history[history.length - 1]
    setHistory((prev) => prev.slice(0, -1))
    loadDir(prev)
  }

  const goUp = () => {
    const parent = currentPath === '/' ? '/' : currentPath.substring(0, currentPath.lastIndexOf('/'))
    if (parent === '') {
      loadDir('/')
    } else {
      enterDir(parent || '/')
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-xl w-full max-w-lg mx-4 flex flex-col max-h-[70vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部 */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
          <div className="flex items-center gap-2">
            {localMode ? <Monitor size={16} className="text-slate-400" /> : <Server size={16} className="text-slate-400" />}
            <h3 className="text-base font-semibold text-slate-800">{localMode ? '选择本地目录' : '选择服务器目录'}</h3>
          </div>
          <button onClick={onClose} className="p-1 text-slate-400 hover:text-slate-600 rounded">
            <X size={18} />
          </button>
        </div>

        {/* 当前路径 */}
        <div className="px-5 py-2.5 bg-slate-50 border-b border-slate-100 flex items-center gap-2">
          <button
            onClick={goBack}
            disabled={history.length === 0}
            className="p-1 text-slate-400 hover:text-slate-600 disabled:opacity-30 rounded transition-colors"
            title="后退"
          >
            <ChevronRight size={14} className="rotate-180" />
          </button>
          <button
            onClick={goUp}
            disabled={currentPath === '/'}
            className="p-1 text-slate-400 hover:text-slate-600 disabled:opacity-30 rounded transition-colors"
            title="上级目录"
          >
            <ArrowUp size={14} />
          </button>
          <code className="text-xs text-slate-600 font-mono truncate">{currentPath}</code>
          {loading && <Loader size={12} className="animate-spin text-slate-400 ml-auto" />}
        </div>

        {/* 目录列表 */}
        <div className="flex-1 overflow-y-auto px-2 py-2 min-h-[200px]">
          {error && (
            <div className="m-3 p-3 text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg">{error}</div>
          )}
          {!loading && !error && entries.length === 0 && (
            <div className="flex items-center justify-center h-32 text-xs text-slate-400">此目录下没有子目录</div>
          )}
          {entries.map((entry) => (
            <div
              key={entry.path}
              className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-slate-50 cursor-pointer group transition-colors"
              onClick={() => enterDir(entry.path)}
            >
              <Folder size={16} className="text-amber-500 shrink-0" />
              <span className="flex-1 text-sm text-slate-700 truncate">{entry.name}</span>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  onSelect(entry.path)
                  onClose()
                }}
                className="px-2.5 py-1 text-[11px] font-medium bg-amber-600 text-white rounded-md opacity-0 group-hover:opacity-100 hover:bg-amber-700 transition-all"
                title="选择此目录"
              >
                选择
              </button>
            </div>
          ))}
        </div>

        {/* 底部操作 */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-slate-200 bg-slate-50 rounded-b-xl">
          <code className="text-[10px] text-slate-400 font-mono truncate max-w-[60%]">{currentPath}</code>
          <div className="flex gap-2">
            <button
              onClick={() => {
                onSelect(currentPath)
                onClose()
              }}
              className="px-3 py-1.5 text-xs font-medium bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors"
            >
              选择当前目录
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
