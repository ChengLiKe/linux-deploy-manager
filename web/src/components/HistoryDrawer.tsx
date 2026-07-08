import { useState, useEffect } from 'react'
import { X, Clock, FileText } from 'lucide-react'
import { taskApi } from '../utils/api'
import LogModal from './LogModal'

interface HistoryDrawerProps {
  projectId: number
  projectName: string
  onClose: () => void
}

const statusMap: Record<string, { label: string; cls: string }> = {
  success: { label: '成功', cls: 'bg-green-50 text-green-600' },
  failed: { label: '失败', cls: 'bg-red-50 text-red-600' },
  running: { label: '进行中', cls: 'bg-blue-50 text-blue-600' },
  pending: { label: '等待中', cls: 'bg-amber-50 text-amber-600' },
  cancelled: { label: '已取消', cls: 'bg-slate-100 text-slate-500' },
}

export default function HistoryDrawer({ projectId, projectName, onClose }: HistoryDrawerProps) {
  const [history, setHistory] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [logTarget, setLogTarget] = useState<number | null>(null)

  useEffect(() => {
    (async () => {
      try {
        const res = await taskApi.list({ project_id: projectId, page_size: 20 })
        setHistory(res.data.data?.items || [])
      } catch (err) {
        console.error('加载部署历史失败:', err)
      } finally {
        setLoading(false)
      }
    })()
  }, [projectId])

  const formatTime = (value?: string) => {
    if (!value) return ''
    const d = new Date(value)
    return isNaN(d.getTime()) ? value : d.toLocaleString()
  }

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/30" onClick={onClose} />
      <div className="fixed top-0 right-0 z-50 h-full w-full max-w-md bg-white shadow-xl flex flex-col animate-slide-in-right">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <Clock size={15} className="text-slate-400 shrink-0" />
            <h3 className="font-semibold text-slate-800 text-sm truncate">{projectName} - 部署历史</h3>
          </div>
          <button onClick={onClose} className="p-1 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg shrink-0">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="text-sm text-slate-400 py-8 text-center">加载中...</div>
          ) : history.length === 0 ? (
            <div className="text-sm text-slate-400 py-8 text-center">暂无部署记录</div>
          ) : (
            <div className="space-y-1.5">
              {history.map((task: any) => {
                const s = statusMap[task.status] || { label: task.status, cls: 'bg-slate-100 text-slate-500' }
                return (
                  <div key={task.id} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-50 hover:bg-slate-100 transition-colors">
                    <span className={`px-1.5 py-0.5 text-[10px] rounded-full shrink-0 ${s.cls}`}>{s.label}</span>
                    <span className="text-[11px] text-slate-400 font-mono shrink-0">#{task.id}</span>
                    <span className="text-xs text-slate-600 font-mono truncate">{task.branch}</span>
                    <span className="text-[11px] text-slate-400 shrink-0 ml-auto">{formatTime(task.created_at)}</span>
                    <button
                      onClick={() => setLogTarget(task.id)}
                      className="flex items-center gap-1 px-1.5 py-1 text-[11px] text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-md transition-colors shrink-0"
                      title="查看日志"
                    >
                      <FileText size={11} />
                      日志
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {logTarget && (
        <LogModal taskId={logTarget} onClose={() => setLogTarget(null)} />
      )}
    </>
  )
}
