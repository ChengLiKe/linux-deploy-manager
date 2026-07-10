import { useState, useEffect, useCallback, useRef } from 'react'
import { Play, Download, ChevronDown, ChevronUp, X, ArrowUp } from 'lucide-react'
import { deploymentApi, taskApi } from '../utils/api'
import { useWebSocket } from '../hooks/useWebSocket'
import Select from '../components/Select'

interface DeploymentDeployModalProps {
  deploymentId: number
  deploymentName: string
  deployMode: string
  onClose: () => void
  onDeployComplete?: () => void
}

export default function DeploymentDeployModal({ deploymentId, deploymentName, deployMode, onClose, onDeployComplete }: DeploymentDeployModalProps) {
  const [branch, setBranch] = useState('')
  const [branches, setBranches] = useState<string[]>([])
  const [branchesLoading, setBranchesLoading] = useState(false)
  const [deploying, setDeploying] = useState(false)
  const [logs, setLogs] = useState<string[]>([])
  const [status, setStatus] = useState<'idle' | 'running' | 'success' | 'failed' | 'cancelled'>('idle')
  const [showLog, setShowLog] = useState(true)
  const [taskId, setTaskId] = useState<number | null>(null)
  const logsEndRef = useRef<HTMLDivElement>(null)
  const logTopRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [logs])

  const loadBranches = useCallback(async () => {
    setBranchesLoading(true)
    try {
      const res = await deploymentApi.branches(deploymentId)
      const list = res.data.data?.branches || []
      setBranches(list)
    } catch (err) {
      console.error('加载分支失败:', err)
    } finally {
      setBranchesLoading(false)
    }
  }, [deploymentId])

  useEffect(() => {
    loadBranches()
  }, [loadBranches])

  const wsUrl = taskId ? `/ws/deploy/${taskId}` : null
  const { connect, disconnect, connected } = useWebSocket(wsUrl, {
    onMessage: (line) => setLogs((prev) => [...prev, line]),
    onClose: () => {
      if (taskId && status === 'running') {
        pollTaskStatus(taskId)
      }
    },
  })

  const pollTaskStatus = async (tid: number) => {
    try {
      const res = await taskApi.get(tid)
      const task = res.data.data
      if (task?.status) {
        setStatus(task.status)
        if (task.status !== 'running' && task.status !== 'pending') {
          setDeploying(false)
          const logRes = await taskApi.log(tid)
          if (logRes.data.data?.content) {
            setLogs(logRes.data.data.content.split('\n'))
          }
          onDeployComplete?.()
        }
      }
    } catch (err) {
      console.error('轮询状态失败:', err)
    }
  }

  const handleDeploy = async () => {
    if (!branch) return
    setDeploying(true)
    setStatus('running')
    setLogs([])
    setTaskId(null)
    try {
      const res = await deploymentApi.deploy(deploymentId, branch)
      const newTaskId = res.data.data?.task_id
      if (newTaskId) {
        setTaskId(newTaskId)
      } else {
        setDeploying(false)
        setStatus('failed')
        setLogs((prev) => [...prev, '创建部署任务失败'])
      }
    } catch (err: any) {
      setDeploying(false)
      setStatus('failed')
      setLogs((prev) => [...prev, `部署失败: ${err?.response?.data?.message || err.message}`])
    }
  }

  useEffect(() => {
    if (taskId) {
      connect()
    } else {
      disconnect()
    }
  }, [taskId, connect, disconnect])

  const handleCancel = async () => {
    if (!taskId) return
    try {
      await taskApi.cancel(taskId)
      setStatus('cancelled')
      setDeploying(false)
      disconnect()
    } catch (err: any) {
      setLogs((prev) => [...prev, `取消失败: ${err?.response?.data?.message || err.message}`])
    }
  }

  const handleDownload = async () => {
    if (!taskId) return
    try {
      const res = await taskApi.download(taskId)
      const blob = new Blob([res.data])
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `task_${taskId}_log.txt`
      a.click()
      window.URL.revokeObjectURL(url)
    } catch (err) {
      console.error('下载日志失败:', err)
    }
  }

  const scrollLogToTop = () => {
    logTopRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const statusText = {
    idle: '等待部署',
    running: '部署中',
    success: '部署成功',
    failed: '部署失败',
    cancelled: '已取消',
  }

  const statusColor = {
    idle: 'bg-slate-50 text-slate-600',
    running: 'bg-blue-50 text-blue-600',
    success: 'bg-green-50 text-green-600',
    failed: 'bg-red-50 text-red-600',
    cancelled: 'bg-amber-50 text-amber-600',
  }

  const statusDot = {
    idle: 'bg-slate-500',
    running: 'bg-blue-500 animate-pulse',
    success: 'bg-green-500',
    failed: 'bg-red-500',
    cancelled: 'bg-amber-500',
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[5vh] bg-black/40 p-4" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-lg w-full max-w-2xl flex flex-col max-h-[85vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 shrink-0">
          <div>
            <h3 className="font-semibold text-slate-800">{deploymentName}</h3>
            <p className="text-xs text-slate-400 mt-0.5">
              {deployMode === 'local' ? '本地化部署' : '容器化部署'}
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg">
            <X size={18} />
          </button>
        </div>

        <div className="px-5 py-4 overflow-y-auto flex-1">
          <div className="space-y-3">
            <div className="flex gap-2">
              <div className="flex-1">
                <Select
                  label="选择分支"
                  value={branch}
                  onChange={(val) => setBranch(val)}
                  disabled={deploying}
                >
                    <option value="">请选择分支</option>
                    {branches.map((b) => (
                      <option key={b} value={b}>{b}</option>
                    ))}
                  </Select>
                </div>
                <button
                  onClick={loadBranches}
                  disabled={branchesLoading || deploying}
                  className="px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50 rounded-md border border-slate-200 disabled:opacity-50 whitespace-nowrap"
                >
                  {branchesLoading ? '刷新中...' : '刷新分支'}
                </button>
              </div>

            <div className="flex items-center gap-2">
              <button
                onClick={handleDeploy}
                disabled={!branch || deploying}
                className="flex items-center gap-1.5 px-4 py-2 text-sm bg-amber-600 text-white rounded-md hover:bg-amber-700 transition-colors disabled:opacity-50"
              >
                <Play size={14} />
                {deploying ? '部署中...' : '确认部署'}
              </button>
              {status === 'running' && (
                <button
                  onClick={handleCancel}
                  className="px-3 py-2 text-sm text-red-600 hover:bg-red-50 rounded-md border border-red-200"
                >
                  取消部署
                </button>
              )}
              {status !== 'idle' && (
                <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs ${statusColor[status]}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${statusDot[status]}`} />
                  {statusText[status]}
                  {connected && status === 'running' && <span className="text-slate-400">(WS)</span>}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="border-t border-slate-200 shrink-0">
          <div className="flex items-center justify-between px-5 py-2 bg-slate-50 border-b border-slate-200">
            <div className="flex items-center gap-2">
              <button onClick={() => setShowLog(!showLog)} className="text-slate-500 hover:text-slate-700">
                {showLog ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
              </button>
              <span className="text-sm font-medium text-slate-700">部署日志</span>
              {taskId && <span className="text-xs text-slate-400">#{taskId}</span>}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={scrollLogToTop}
                className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700"
                title="日志置顶"
              >
                <ArrowUp size={12} />
                置顶
              </button>
              <button
                onClick={handleDownload}
                disabled={!taskId}
                className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700 disabled:opacity-50"
              >
                <Download size={12} />
                下载
              </button>
            </div>
          </div>
          {showLog && (
            <div ref={logTopRef} className="p-3 bg-slate-900 font-mono text-xs text-slate-300 h-64 overflow-y-auto">
              {logs.length === 0 ? (
                <span className="text-slate-500">等待部署...</span>
              ) : (
                <>
                  {logs.map((log, i) => (
                    <div key={i} className="py-0.5 whitespace-pre-wrap">{log}</div>
                  ))}
                  <div ref={logsEndRef} />
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
