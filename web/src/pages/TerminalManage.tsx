import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Terminal, X, RefreshCw, ExternalLink, Monitor } from 'lucide-react'
import { terminalApi } from '../utils/api'
import ConfirmDialog from '../components/ConfirmDialog'

interface TermSession {
  id: string
  node_id: number
  node_name: string
  user: string
  host: string
  created_at: string
}

export default function TerminalManage() {
  const navigate = useNavigate()
  const [sessions, setSessions] = useState<TermSession[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [disconnectAllConfirm, setDisconnectAllConfirm] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)

  const fetchSessions = async () => {
    setLoading(true)
    setError('')
    try {
      const res = await terminalApi.list()
      setSessions(res.data.data || [])
    } catch (err: any) {
      setError(err.response?.data?.message || '获取会话列表失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchSessions()
    // 30 秒轮询
    const timer = setInterval(fetchSessions, 30000)

    // 页面可见时立即刷新
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        fetchSessions()
      }
    }
    document.addEventListener('visibilitychange', handleVisibility)

    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [])

  const handleDisconnect = async (sessionId: string) => {
    try {
      await terminalApi.disconnect(sessionId)
      setSessions((prev) => prev.filter((s) => s.id !== sessionId))
    } catch (err: any) {
      setError(err.response?.data?.message || '断开连接失败')
    }
  }

  const handleDisconnectAll = async () => {
    setDisconnecting(true)
    try {
      await Promise.all(sessions.map((s) => terminalApi.disconnect(s.id)))
      setSessions([])
      setDisconnectAllConfirm(false)
    } catch (err: any) {
      setError(err.response?.data?.message || '批量断开失败')
    } finally {
      setDisconnecting(false)
    }
  }

  const formatTime = (iso: string) => {
    try {
      return new Date(iso).toLocaleString()
    } catch {
      return iso
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-slate-800">终端连接管理</h1>
          <p className="text-sm text-slate-400 mt-0.5">管理所有活跃的 SSH 终端会话</p>
        </div>
        <div className="flex items-center gap-2">
          {sessions.length > 1 && (
            <button
              onClick={() => setDisconnectAllConfirm(true)}
              className="flex items-center gap-1 px-3 py-2 text-xs text-red-600 border border-red-200 rounded-lg hover:bg-red-50 transition-colors"
            >
              <X size={12} />
              断开全部
            </button>
          )}
          <button
            onClick={fetchSessions}
            disabled={loading}
            className="flex items-center gap-2 px-3 py-2 text-sm text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            刷新
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
          {error}
        </div>
      )}

      {loading && sessions.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center text-slate-400 text-sm">
          加载中...
        </div>
      ) : sessions.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-12 text-center">
          <Monitor className="mx-auto mb-3 text-slate-300" size={48} />
          <h3 className="text-base font-medium text-slate-600 mb-1">暂无活跃终端</h3>
          <p className="text-sm text-slate-400 mb-4">从服务器节点页面可以打开 SSH 终端连接</p>
          <button
            onClick={() => navigate('/server-nodes')}
            className="px-4 py-2 text-sm font-medium bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors"
          >
            前往服务器节点
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="text-sm text-slate-500">
            共 {sessions.length} 个活跃会话
          </div>
          {sessions.map((session, index) => (
            <div
              key={session.id}
              className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 hover:border-slate-300 transition-colors"
            >
              <div className="flex items-start justify-between">
                <div className="flex items-start gap-4 min-w-0">
                  <div className="mt-0.5 w-10 h-10 rounded-xl bg-green-50 flex items-center justify-center shrink-0">
                    <Terminal className="text-green-600" size={20} />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-semibold text-slate-800">{session.node_name}</span>
                      <span className="px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-green-100 text-green-700">
                        活跃
                      </span>
                      <span className="text-[10px] text-slate-400 font-mono">#{index + 1}</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
                      <span>用户：{session.user}</span>
                      <span>地址：{session.host}</span>
                      <span>连接时间：{formatTime(session.created_at)}</span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0 ml-4">
                  <button
                    onClick={() => navigate(`/server-nodes/${session.node_id}/terminal`)}
                    className="flex items-center gap-1 px-3 py-1.5 text-xs text-amber-600 border border-amber-200 rounded-lg hover:bg-amber-50 transition-colors"
                    title="打开一个新的终端连接到同一节点"
                  >
                    <ExternalLink size={12} />
                    新开终端
                  </button>
                  <button
                    onClick={() => handleDisconnect(session.id)}
                    className="flex items-center gap-1 px-3 py-1.5 text-xs text-red-600 border border-red-200 rounded-lg hover:bg-red-50 transition-colors"
                  >
                    <X size={12} />
                    断开
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 断开全部确认框 */}
      <ConfirmDialog
        open={disconnectAllConfirm}
        title="断开全部终端"
        message={`确定要断开所有 ${sessions.length} 个活跃终端会话吗？`}
        subtext="此操作不可撤销"
        confirmLabel="全部断开"
        variant="danger"
        loading={disconnecting}
        onConfirm={handleDisconnectAll}
        onCancel={() => setDisconnectAllConfirm(false)}
      />
    </div>
  )
}
