import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus, Trash2, Rocket, RotateCcw, Clock, Terminal } from 'lucide-react'
import { projectApi, type ProjectItem } from '../utils/api'
import DeployModal from '../components/DeployModal'
import HistoryDrawer from '../components/HistoryDrawer'
import InstanceLogModal from '../components/InstanceLogModal'

export default function ProjectList() {
  const [items, setItems] = useState<ProjectItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const [deployTarget, setDeployTarget] = useState<{ id: number; name: string; mode: string; latest: any } | null>(null)
  const [historyTarget, setHistoryTarget] = useState<{ id: number; name: string } | null>(null)
  const [logTarget, setLogTarget] = useState<{ id: number; name: string } | null>(null)

  const fetchProjects = async () => {
    setLoading(true)
    setError('')
    try {
      const res = await projectApi.list()
      setItems(res.data.data?.items || [])
    } catch (err: any) {
      setError(err.response?.data?.message || '加载项目列表失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchProjects()
  }, [])

  const handleDelete = async (id: number) => {
    if (!confirm('确定要删除这个项目吗？')) return
    try {
      await projectApi.delete(id)
      fetchProjects()
    } catch (err: any) {
      setError(err.response?.data?.message || '删除失败')
    }
  }

  const formatTime = (value?: string) => {
    if (!value) return ''
    const d = new Date(value)
    return isNaN(d.getTime()) ? value : d.toLocaleString()
  }

  const statusMap: Record<string, { label: string; cls: string }> = {
    success: { label: '成功', cls: 'bg-green-50 text-green-600' },
    failed: { label: '失败', cls: 'bg-red-50 text-red-600' },
    running: { label: '进行中', cls: 'bg-blue-50 text-blue-600' },
    pending: { label: '等待中', cls: 'bg-amber-50 text-amber-600' },
    cancelled: { label: '已取消', cls: 'bg-slate-100 text-slate-500' },
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-slate-800">项目</h2>
        <Link
          to="/projects/new"
          className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors text-sm"
        >
          <Plus size={15} />
          创建项目
        </Link>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded-lg text-xs">
          {error}
        </div>
      )}

      {loading ? (
        <div className="text-sm text-slate-500 py-4 text-center">加载中...</div>
      ) : items.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-6 text-center text-slate-400 text-sm">
          暂无项目，点击右上角"创建项目"开始
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {items.map(({ project: p, latest_task: latest }) => {
            const hasSuccess = latest?.status === 'success'
            const status = latest ? statusMap[latest.status] || { label: latest.status, cls: 'bg-slate-100 text-slate-500' } : null
            return (
              <div key={p.id} className="bg-white rounded-xl border border-slate-200 p-4 hover:shadow-md transition-shadow flex flex-col gap-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <h3 className="font-semibold text-slate-800 text-sm truncate">{p.name}</h3>
                      <span className={`px-1.5 py-0.5 text-[10px] rounded-full shrink-0 ${p.status === 'active' ? 'bg-green-50 text-green-600' : 'bg-slate-100 text-slate-500'}`}>
                        {p.status === 'active' ? '活跃' : '草稿'}
                      </span>
                    </div>
                    <p className="text-xs text-slate-400 mt-0.5 truncate">{p.description || '暂无描述'}</p>
                  </div>
                </div>

                <div className="flex items-center gap-2 text-xs text-slate-400">
                  <span className="px-1.5 py-0.5 bg-slate-50 rounded text-[11px]">{p.deploy_mode === 'local' ? '本地化' : '容器化'}</span>
                  {latest ? (
                    <>
                      <span className={`px-1.5 py-0.5 rounded text-[11px] ${status?.cls}`}>{status?.label}</span>
                      <span className="truncate font-mono text-[11px]">{latest.branch}</span>
                      <span className="ml-auto text-[11px] shrink-0">{formatTime(latest.created_at)}</span>
                    </>
                  ) : (
                    <span className="text-[11px]">尚未部署</span>
                  )}
                </div>

                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => setDeployTarget({ id: p.id, name: p.name, mode: p.deploy_mode, latest })}
                    className="flex-1 flex items-center justify-center gap-1 py-1.5 bg-amber-50 text-amber-700 rounded-lg hover:bg-amber-100 transition-colors text-xs"
                  >
                    {hasSuccess ? <RotateCcw size={12} /> : <Rocket size={12} />}
                    {hasSuccess ? '重新部署' : '部署'}
                  </button>
                  <Link
                    to={`/projects/${p.id}/edit`}
                    className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-50 rounded-lg"
                    title="编辑项目"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>
                  </Link>
                  <button
                    onClick={() => handleDelete(p.id)}
                    className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg"
                    title="删除"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>

                <div className="flex items-center gap-1.5 pt-2 border-t border-slate-100">
                  <button
                    onClick={() => setHistoryTarget({ id: p.id, name: p.name })}
                    className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-600 transition-colors"
                  >
                    <Clock size={11} />
                    部署历史
                  </button>
                  <button
                    onClick={() => setLogTarget({ id: p.id, name: p.name })}
                    className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-blue-600 transition-colors"
                  >
                    <Terminal size={11} />
                    实例日志
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {deployTarget && (
        <DeployModal
          projectId={deployTarget.id}
          projectName={deployTarget.name}
          deployMode={deployTarget.mode}
          latestTask={deployTarget.latest}
          onClose={() => setDeployTarget(null)}
          onDeployComplete={() => fetchProjects()}
        />
      )}

      {historyTarget && (
        <HistoryDrawer
          projectId={historyTarget.id}
          projectName={historyTarget.name}
          onClose={() => setHistoryTarget(null)}
        />
      )}

      {logTarget && (
        <InstanceLogModal
          projectId={logTarget.id}
          projectName={logTarget.name}
          onClose={() => setLogTarget(null)}
        />
      )}
    </div>
  )
}
