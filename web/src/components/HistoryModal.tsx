import { useState, useEffect } from 'react'
import { X, Clock, FileText, Terminal } from 'lucide-react'
import { taskApi } from '../utils/api'
import LogModal from './LogModal'
import InstanceLogModal from './InstanceLogModal'

interface HistoryModalProps {
  templateId: number
  templateName: string
  onClose: () => void
}

const statusMap: Record<string, { label: string; cls: string }> = {
  success: { label: '成功', cls: 'bg-green-50 text-green-600' },
  failed: { label: '失败', cls: 'bg-red-50 text-red-600' },
  running: { label: '进行中', cls: 'bg-blue-50 text-blue-600' },
  pending: { label: '等待中', cls: 'bg-amber-50 text-amber-600' },
  cancelled: { label: '已取消', cls: 'bg-slate-100 text-slate-500' },
}

export default function HistoryModal({ templateId, templateName, onClose }: HistoryModalProps) {
  const [history, setHistory] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [logTarget, setLogTarget] = useState<number | null>(null)
  const [instanceLogOpen, setInstanceLogOpen] = useState(false)

  useEffect(() => {
    (async () => {
      try {
        const res = await taskApi.list({ template_id: templateId, page_size: 20 })
        setHistory(res.data.data?.items || [])
      } catch (err) {
        console.error('加载部署历史失败:', err)
      } finally {
        setLoading(false)
      }
    })()
  }, [templateId])

  const formatTime = (value?: string) => {
    if (!value) return ''
    const d = new Date(value)
    return isNaN(d.getTime()) ? value : d.toLocaleString()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[10vh] bg-black/40 p-4" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-lg w-full max-w-lg flex flex-col max-h-[70vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 shrink-0">
          <div className="flex items-center gap-2">
            <Clock size={16} className="text-slate-400" />
            <h3 className="font-semibold text-slate-800">{templateName} - 部署历史</h3>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setInstanceLogOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
              title="查看当前实例的实时运行日志"
            >
              <Terminal size={14} />
              实例日志
            </button>
            <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg">
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="px-5 py-4 overflow-y-auto flex-1">
          {loading ? (
            <div className="text-sm text-slate-400 py-8 text-center">加载中...</div>
          ) : history.length === 0 ? (
            <div className="text-sm text-slate-400 py-8 text-center">暂无部署记录</div>
          ) : (
            <div className="space-y-2">
              {history.map((task: any) => {
                const s = statusMap[task.status] || { label: task.status, cls: 'bg-slate-100 text-slate-500' }
                return (
                  <div key={task.id} className="flex items-center gap-3 p-3 rounded-lg bg-slate-50 hover:bg-slate-100 transition-colors">
                    <span className={`px-2 py-0.5 text-xs rounded-full shrink-0 ${s.cls}`}>{s.label}</span>
                    <span className="text-xs text-slate-400 font-mono shrink-0">#{task.id}</span>
                    <span className="text-sm text-slate-600 font-mono truncate">{task.branch}</span>
                    <span className="text-xs text-slate-400 shrink-0">{formatTime(task.created_at)}</span>
                    <button
                      onClick={() => setLogTarget(task.id)}
                      className="flex items-center gap-1 px-2 py-1 text-xs text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-md transition-colors shrink-0"
                      title="查看日志"
                    >
                      <FileText size={12} />
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

      {instanceLogOpen && (
        <InstanceLogModal
          templateId={templateId}
          templateName={templateName}
          onClose={() => setInstanceLogOpen(false)}
        />
      )}
    </div>
  )
}
