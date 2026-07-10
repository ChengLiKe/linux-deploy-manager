import { useEffect, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { Rocket, Edit3, ArrowLeft, FileText } from 'lucide-react'
import { deploymentApi, taskApi } from '../utils/api'
import type { Deployment } from '../types'
import DeploymentDeployModal from '../components/DeploymentDeployModal'
import LogModal from '../components/LogModal'

export default function DeploymentDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const deploymentId = Number(id)

  const [deployment, setDeployment] = useState<Deployment | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const [showDeployModal, setShowDeployModal] = useState(false)
  const [history, setHistory] = useState<any[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [logTarget, setLogTarget] = useState<number | null>(null)

  const fetchDeployment = async () => {
    setLoading(true)
    setError('')
    try {
      const res = await deploymentApi.get(deploymentId)
      setDeployment(res.data.data)
    } catch (err: any) {
      setError(err.response?.data?.message || '加载部署配置失败')
    } finally {
      setLoading(false)
    }
  }

  const fetchHistory = async () => {
    setHistoryLoading(true)
    try {
      const res = await taskApi.list({ project_id: deploymentId, page_size: 20 })
      setHistory(res.data.data?.items || [])
    } catch (err) {
      console.error('加载部署历史失败:', err)
    } finally {
      setHistoryLoading(false)
    }
  }

  useEffect(() => {
    fetchDeployment()
    fetchHistory()
  }, [deploymentId])

  const taskStatusMap: Record<string, { label: string; cls: string }> = {
    success: { label: '成功', cls: 'bg-green-50 text-green-600' },
    failed: { label: '失败', cls: 'bg-red-50 text-red-600' },
    running: { label: '进行中', cls: 'bg-blue-50 text-blue-600' },
    pending: { label: '等待中', cls: 'bg-amber-50 text-amber-600' },
    cancelled: { label: '已取消', cls: 'bg-slate-100 text-slate-500' },
  }

  const formatTime = (value?: string) => {
    if (!value) return '-'
    const d = new Date(value)
    return isNaN(d.getTime()) ? value : d.toLocaleString()
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex flex-col items-center gap-3 text-slate-400">
          <div className="w-8 h-8 border-2 border-slate-200 border-t-amber-500 rounded-full animate-spin" />
          <span className="text-sm">加载中...</span>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="space-y-4">
        <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded-lg text-xs">{error}</div>
        <button onClick={() => navigate('/deployments')} className="text-sm text-amber-600 hover:underline">返回部署列表</button>
      </div>
    )
  }

  if (!deployment) return null

  const getScriptContent = () => {
    if (deployment.deploy_mode === 'local') {
      try {
        const lc = JSON.parse(deployment.local_config)
        return lc.script_content || ''
      } catch {
        return deployment.local_config || ''
      }
    }
    if (deployment.deploy_mode === 'container') {
      try {
        const cc = JSON.parse(deployment.container_config)
        return cc.compose_content || ''
      } catch {
        return deployment.container_config || ''
      }
    }
    return ''
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/deployments')}
            className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
          >
            <ArrowLeft size={20} />
          </button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold text-slate-800">{deployment.name}</h1>
            </div>
            <p className="text-sm text-slate-400 mt-0.5">{deployment.description || '暂无描述'}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowDeployModal(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors text-sm"
          >
            <Rocket size={15} />
            部署
          </button>
          <Link
            to={`/deployments/${deployment.id}/edit`}
            className="flex items-center gap-1.5 px-3 py-1.5 text-slate-600 border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors text-sm"
          >
            <Edit3 size={15} />
            编辑
          </Link>
        </div>
      </div>

      {/* Info Section */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
        <h3 className="text-base font-semibold text-slate-800 mb-4 flex items-center gap-2">
          <span className="w-1 h-4 bg-amber-500 rounded-full inline-block" />
          基本信息
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <InfoItem label="关联项目" value={deployment.project?.name || `#${deployment.project_id}`} />
          <InfoItem label="目标服务器" value={deployment.server_node?.host || '本地部署'} />
          <InfoItem label="部署模式" value={deployment.deploy_mode === 'local' ? '本地化' : '容器化'} />
          <InfoItem label="默认分支" value={deployment.default_branch || 'main'} />
          <InfoItem label="超时时间" value={`${deployment.timeout_sec} 秒`} />
          <InfoItem label="创建时间" value={formatTime(deployment.created_at)} />
          <InfoItem label="更新时间" value={formatTime(deployment.updated_at)} />
        </div>
      </div>

      {/* Script Section */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
        <h3 className="text-base font-semibold text-slate-800 mb-4 flex items-center gap-2">
          <span className="w-1 h-4 bg-amber-500 rounded-full inline-block" />
          部署脚本
        </h3>
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <InfoItem label="脚本文件" value={deployment.script_filename || '-'} />
            <InfoItem label="部署模式" value={deployment.deploy_mode === 'local' ? '本地部署' : '容器部署'} />
          </div>
          <div>
            <h4 className="text-xs font-medium text-slate-500 mb-1">脚本内容</h4>
            {getScriptContent() ? (
              <pre className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-xs font-mono text-slate-700 overflow-x-auto whitespace-pre-wrap max-h-96">{getScriptContent()}</pre>
            ) : (
              <p className="text-xs text-slate-400 italic">未设置</p>
            )}
          </div>
        </div>
      </div>

      {/* Deploy History */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
        <h3 className="text-base font-semibold text-slate-800 mb-4 flex items-center gap-2">
          <span className="w-1 h-4 bg-amber-500 rounded-full inline-block" />
          部署历史
        </h3>
        {historyLoading ? (
          <div className="text-sm text-slate-400 py-4 text-center">加载中...</div>
        ) : history.length === 0 ? (
          <p className="text-sm text-slate-400 py-4 text-center">暂无部署记录</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200">
                  <th className="text-left py-2 px-3 text-xs font-medium text-slate-500">任务 ID</th>
                  <th className="text-left py-2 px-3 text-xs font-medium text-slate-500">分支</th>
                  <th className="text-left py-2 px-3 text-xs font-medium text-slate-500">状态</th>
                  <th className="text-left py-2 px-3 text-xs font-medium text-slate-500">时间</th>
                  <th className="text-right py-2 px-3 text-xs font-medium text-slate-500">操作</th>
                </tr>
              </thead>
              <tbody>
                {history.map((task: any) => {
                  const ts = taskStatusMap[task.status] || { label: task.status, cls: 'bg-slate-100 text-slate-500' }
                  return (
                    <tr key={task.id} className="border-b border-slate-100 hover:bg-slate-50">
                      <td className="py-2 px-3 text-xs font-mono text-slate-500">#{task.id}</td>
                      <td className="py-2 px-3 text-xs font-mono text-slate-700">{task.branch}</td>
                      <td className="py-2 px-3">
                        <span className={`px-1.5 py-0.5 text-[10px] rounded-full ${ts.cls}`}>{ts.label}</span>
                      </td>
                      <td className="py-2 px-3 text-xs text-slate-500">{formatTime(task.created_at)}</td>
                      <td className="py-2 px-3 text-right">
                        <button
                          onClick={() => setLogTarget(task.id)}
                          className="inline-flex items-center gap-1 px-2 py-1 text-[11px] text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-md transition-colors"
                        >
                          <FileText size={11} />
                          日志
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showDeployModal && deployment && (
        <DeploymentDeployModal
          deploymentId={deployment.id}
          deploymentName={deployment.name}
          deployMode={deployment.deploy_mode}
          onClose={() => setShowDeployModal(false)}
          onDeployComplete={() => {
            setShowDeployModal(false)
            fetchHistory()
          }}
        />
      )}

      {logTarget && (
        <LogModal taskId={logTarget} onClose={() => setLogTarget(null)} />
      )}
    </div>
  )
}

function InfoItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-slate-400">{label}</p>
      <p className="text-sm font-medium text-slate-700 mt-0.5">{value}</p>
    </div>
  )
}
