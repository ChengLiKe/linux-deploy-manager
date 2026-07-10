import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Plus, Rocket, Clock, Edit3 } from 'lucide-react'
import { deploymentApi } from '../utils/api'
import type { Deployment } from '../types'
import DeploymentDeployModal from '../components/DeploymentDeployModal'
import HistoryDrawer from '../components/HistoryDrawer'

export default function DeploymentList() {
  const [searchParams] = useSearchParams()
  const projectIdFilter = searchParams.get('project_id')

  const [items, setItems] = useState<Deployment[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [total, setTotal] = useState(0)

  const [deployTarget, setDeployTarget] = useState<{ id: number; name: string; mode: string } | null>(null)
  const [historyTarget, setHistoryTarget] = useState<{ id: number; name: string } | null>(null)

  const fetchDeployments = async () => {
    setLoading(true)
    setError('')
    try {
      const params: any = { page: 1, page_size: 50 }
      if (projectIdFilter) params.project_id = Number(projectIdFilter)
      const res = await deploymentApi.list(params)
      setItems(res.data.data?.items || [])
      setTotal(res.data.data?.total || 0)
    } catch (err: any) {
      setError(err.response?.data?.message || '加载部署列表失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchDeployments()
  }, [projectIdFilter])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-slate-800">部署</h2>
          {total > 0 && <p className="text-xs text-slate-400 mt-0.5">共 {total} 个部署</p>}
          {projectIdFilter && (
            <p className="text-xs text-slate-400 mt-0.5">筛选项目 ID: {projectIdFilter}</p>
          )}
        </div>
        <Link
          to="/deployments/new"
          className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors text-sm"
        >
          <Plus size={15} />
          创建部署
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
          暂无部署配置，点击右上角"创建部署"开始
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {items.map((d) => {
            return (
              <div key={d.id} className="bg-white rounded-xl border border-slate-200 p-4 hover:shadow-md transition-shadow flex flex-col gap-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <h3 className="font-semibold text-slate-800 text-sm truncate">{d.name}</h3>
                    </div>
                    <p className="text-xs text-slate-400 mt-0.5 truncate">{d.description || '暂无描述'}</p>
                  </div>
                </div>

                <div className="flex items-center gap-2 text-xs text-slate-400">
                  <span className="truncate font-medium text-slate-500">
                    {d.project?.name || `项目 #${d.project_id}`}
                  </span>
                  <span className="text-slate-300">|</span>
                  <span className="truncate">
                    {d.server_node ? d.server_node.host : '本地部署'}
                  </span>
                  <span className="text-slate-300">|</span>
                  <span>{d.deploy_mode === 'local' ? '本地化' : '容器化'}</span>
                </div>

                <div className="flex items-center gap-1.5 pt-1">
                  <button
                    onClick={() => setDeployTarget({ id: d.id, name: d.name, mode: d.deploy_mode })}
                    className="flex-1 flex items-center justify-center gap-1 py-1.5 bg-amber-50 text-amber-700 rounded-lg hover:bg-amber-100 transition-colors text-xs"
                  >
                    <Rocket size={12} />
                    部署
                  </button>
                  <button
                    onClick={() => setHistoryTarget({ id: d.id, name: d.name })}
                    className="flex items-center justify-center gap-1 px-3 py-1.5 text-slate-500 hover:text-slate-700 hover:bg-slate-50 rounded-lg transition-colors text-xs"
                  >
                    <Clock size={12} />
                    历史
                  </button>
                  <Link
                    to={`/deployments/${d.id}/edit`}
                    className="flex items-center justify-center gap-1 px-3 py-1.5 text-slate-500 hover:text-slate-700 hover:bg-slate-50 rounded-lg transition-colors text-xs"
                  >
                    <Edit3 size={12} />
                    编辑
                  </Link>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {deployTarget && (
        <DeploymentDeployModal
          deploymentId={deployTarget.id}
          deploymentName={deployTarget.name}
          deployMode={deployTarget.mode}
          onClose={() => setDeployTarget(null)}
          onDeployComplete={() => fetchDeployments()}
        />
      )}

      {historyTarget && (
        <HistoryDrawer
          projectId={historyTarget.id}
          projectName={historyTarget.name}
          onClose={() => setHistoryTarget(null)}
        />
      )}
    </div>
  )
}
