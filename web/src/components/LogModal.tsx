import { useState, useEffect } from 'react'
import { X, Download } from 'lucide-react'
import { taskApi } from '../utils/api'

interface LogModalProps {
  taskId: number
  onClose: () => void
}

export default function LogModal({ taskId, onClose }: LogModalProps) {
  const [content, setContent] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    (async () => {
      try {
        const res = await taskApi.log(taskId)
        setContent(res.data.data?.content || '')
      } catch (err: any) {
        setError(err.response?.data?.message || '日志不存在或已丢失')
      } finally {
        setLoading(false)
      }
    })()
  }, [taskId])

  const handleDownload = () => {
    const blob = new Blob([content], { type: 'text/plain' })
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `task_${taskId}.log`
    a.click()
    window.URL.revokeObjectURL(url)
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center pt-[5vh] bg-black/40 p-4" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-lg w-full max-w-3xl flex flex-col max-h-[80vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 shrink-0">
          <h3 className="font-semibold text-slate-800">部署日志 #{taskId}</h3>
          <div className="flex items-center gap-2">
            {content && (
              <button
                onClick={handleDownload}
                className="flex items-center gap-1 px-2.5 py-1.5 text-xs text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-md"
              >
                <Download size={14} />
                下载
              </button>
            )}
            <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg">
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="p-4 overflow-y-auto flex-1">
          {loading ? (
            <div className="text-sm text-slate-400 py-8 text-center">加载中...</div>
          ) : error ? (
            <div className="text-sm text-slate-400 py-8 text-center">{error}</div>
          ) : !content ? (
            <div className="text-sm text-slate-400 py-8 text-center">暂无日志内容</div>
          ) : (
            <pre className="bg-slate-900 text-slate-300 text-xs font-mono p-4 rounded-lg whitespace-pre-wrap overflow-x-auto leading-relaxed">
              {content}
            </pre>
          )}
        </div>
      </div>
    </div>
  )
}
