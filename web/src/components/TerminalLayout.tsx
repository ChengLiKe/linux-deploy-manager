import { useEffect, useState } from 'react'
import { useNavigate, useLocation, Outlet } from 'react-router-dom'
import { Terminal, Monitor, Plus, X, RefreshCw, Laptop } from 'lucide-react'
import { terminalApi } from '../utils/api'
import * as termStore from '../stores/terminalStore'

interface TermSession {
  id: string
  node_id: number
  node_name: string
  user: string
  host: string
  created_at: string
}

export default function TerminalLayout() {
  const navigate = useNavigate()
  const location = useLocation()
  const [sessions, setSessions] = useState<TermSession[]>([])
  const [loading, setLoading] = useState(true)
  const [collapsed, setCollapsed] = useState(false)

  const currentPath = location.pathname
  const isLocalActive = currentPath.endsWith('/local')

  const fetchSessions = async () => {
    setLoading(true)
    try {
      const res = await terminalApi.list()
      setSessions(res.data.data || [])
    } catch (err: any) {
      console.error('获取会话列表失败', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchSessions()
    const timer = setInterval(fetchSessions, 30000)
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') fetchSessions()
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
      console.error('断开连接失败', err)
    }
  }

  return (
    <div className="flex" style={{ height: 'calc(100vh - 48px)', margin: '-16px' }}>
      {/* 左侧面板 */}
      <div className={`flex flex-col bg-white border-r border-slate-200 transition-all duration-200 ${collapsed ? 'w-12' : 'w-64'} shrink-0`}>
        <div className="flex items-center justify-between px-3 h-10 border-b border-slate-100 shrink-0">
          {!collapsed && (
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">终端</span>
          )}
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="p-1 text-slate-400 hover:text-slate-600 rounded hover:bg-slate-100 transition-colors"
            title={collapsed ? '展开面板' : '折叠面板'}
          >
            <Terminal size={14} />
          </button>
        </div>

        {/* 快速操作 */}
        <div className="p-2 space-y-1 border-b border-slate-100">
          <button
            onClick={() => navigate('/terminal/local')}
            className={`flex items-center gap-2 w-full px-2.5 py-2 rounded-lg text-xs transition-colors ${
              isLocalActive
                ? 'bg-amber-50 text-amber-700 font-medium'
                : 'text-slate-600 hover:bg-slate-50 hover:text-slate-800'
            }`}
            title="打开本地终端（直接操作服务器 Shell）"
          >
            <Laptop size={15} className="shrink-0" />
            {!collapsed && <span>本地终端</span>}
          </button>

          {!collapsed && (
            <button
              onClick={() => navigate('/server-nodes')}
              className="flex items-center gap-2 w-full px-2.5 py-2 rounded-lg text-xs text-slate-400 hover:bg-slate-50 hover:text-slate-600 transition-colors"
            >
              <Plus size={14} className="shrink-0" />
              <span>从节点连接...</span>
            </button>
          )}
        </div>

        {!collapsed && (
          <>
            <div className="flex-1 overflow-y-auto">
              {loading && sessions.length === 0 ? (
                <div className="p-4 text-center text-xs text-slate-400">加载中...</div>
              ) : sessions.length === 0 ? (
                <div className="p-4 text-center">
                  <Monitor size={24} className="mx-auto mb-2 text-slate-300" />
                  <p className="text-xs text-slate-400">暂无活跃会话</p>
                </div>
              ) : (
                <div className="py-1">
                  <div className="px-3 py-1.5 text-[10px] text-slate-400 font-medium uppercase tracking-wider">
                    活跃会话 ({sessions.length})
                  </div>
                  {/* 按 node_id 去重，只保留最新一条 */}
                  {Array.from(
                    new Map(sessions.map(s => [s.node_id, s])).values()
                  ).map((session) => {
                    const targetPath = `/terminal/${session.node_id}`
                    const isActiveRoute = currentPath === targetPath
                    const hasCache = termStore.listSessions().some(
                      (s) => s.nodeId === String(session.node_id)
                    )
                    return (
                      <div
                        key={session.id}
                        className={`group flex items-center gap-2 px-3 py-2 mx-1 rounded-lg cursor-pointer transition-colors ${
                          isActiveRoute
                            ? 'bg-amber-50 text-amber-700'
                            : 'text-slate-600 hover:bg-slate-50'
                        }`}
                        onClick={() => navigate(targetPath)}
                      >
                        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${hasCache ? 'bg-green-500' : 'bg-slate-300'}`} />
                        <div className="flex-1 min-w-0">
                          <div className="text-xs font-medium truncate">{session.node_name}</div>
                          <div className="text-[10px] text-slate-400 truncate mt-0.5">
                            {session.user}@{session.host.split(':')[0]}
                          </div>
                        </div>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleDisconnect(session.id) }}
                          className="p-1 text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all shrink-0"
                          title="断开连接"
                        >
                          <X size={12} />
                        </button>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            <div className="p-2 border-t border-slate-100">
              <button
                onClick={fetchSessions}
                disabled={loading}
                className="flex items-center justify-center gap-1 w-full py-1.5 text-[11px] text-slate-400 hover:text-slate-600 bg-slate-50 hover:bg-slate-100 rounded transition-colors"
              >
                <RefreshCw size={11} className={loading ? 'animate-spin' : ''} />
                刷新会话
              </button>
            </div>
          </>
        )}
      </div>

      {/* 右侧终端区域 */}
      <div className="flex-1 flex flex-col min-w-0">
        <Outlet />
      </div>
    </div>
  )
}
