import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams } from 'react-router-dom'
import { Play, Download, RotateCcw, ChevronDown, ChevronUp } from 'lucide-react'
import { templateApi, taskApi } from '../utils/api'
import { useWebSocket } from '../hooks/useWebSocket'

export default function DeployPage() {
  const { id } = useParams<{ id: string }>()
  const templateId = Number(id)

  const [branch, setBranch] = useState('')
  const [branches, setBranches] = useState<string[]>([])
  const [branchesLoading, setBranchesLoading] = useState(false)
  const [deploying, setDeploying] = useState(false)
  const [logs, setLogs] = useState<string[]>([])
  const [status, setStatus] = useState<'idle' | 'running' | 'success' | 'failed' | 'cancelled'>('idle')
  const [showLog, setShowLog] = useState(true)
  const [taskId, setTaskId] = useState<number | null>(null)
  const logsEndRef = useRef<HTMLDivElement>(null)

  // 自动滚动到日志底部
  useEffect(() => {
    if (logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [logs])

  // 加载分支列表
  const loadBranches = useCallback(async () => {
    setBranchesLoading(true)
    try {
      const res = await templateApi.branches(templateId)
      setBranches(res.data.data?.branches || [])
    } catch (err) {
      console.error('加载分支失败:', err)
    } finally {
      setBranchesLoading(false)
    }
  }, [templateId])

  useEffect(() => {
    loadBranches()
  }, [loadBranches])

  // 使用相对路径，由 useWebSocket 自动解析为完整 WebSocket URL
  const wsUrl = taskId ? `/ws/deploy/${taskId}` : null
  const { connect, disconnect, connected } = useWebSocket(wsUrl, {
    onMessage: (line) => {
      setLogs((prev) => [...prev, line])
    },
    onStatus: (s) => {
      if (s === 'completed') {
        // 完成后不再标记为 running，保持 success/failed
      }
    },
    onClose: () => {
      // 连接断开时轮询状态
      if (taskId && status === 'running') {
        pollTaskStatus(taskId)
      }
    },
  })

  // 轮询任务状态
  const pollTaskStatus = async (tid: number) => {
    try {
      const res = await taskApi.get(tid)
      const task = res.data.data
      if (task?.status) {
        setStatus(task.status as 'idle' | 'running' | 'success' | 'failed' | 'cancelled')
        if (task.status !== 'running' && task.status !== 'pending') {
          setDeploying(false)
          // 拉取完整日志
          const logRes = await taskApi.log(tid)
          if (logRes.data.data?.content) {
            setLogs(logRes.data.data.content.split('\n'))
          }
        }
      }
    } catch (err) {
      console.error('轮询状态失败:', err)
    }
  }

  // 启动部署
  const handleDeploy = async () => {
    if (!branch) return
    setDeploying(true)
    setStatus('running')
    setLogs([])
    setTaskId(null)

    try {
      const res = await templateApi.deploy(templateId, branch)
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

  // 当 taskId 变化时，连接 WebSocket
  useEffect(() => {
    if (taskId) {
      connect()
    } else {
      disconnect()
    }
  }, [taskId, connect, disconnect])

  // 取消部署
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

  // 下载日志
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
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-slate-800">部署 - 模板 #{id}</h2>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-6 space-y-4">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">选择分支</label>
          <div className="flex gap-3">
            <select
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
              disabled={deploying}
              className="flex-1 px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500 disabled:opacity-50"
            >
              <option value="">请选择分支</option>
              {branches.map((b) => (
                <option key={b} value={b}>{b}</option>
              ))}
            </select>
            <button
              onClick={loadBranches}
              disabled={branchesLoading}
              className="px-4 py-2 text-slate-600 hover:bg-slate-50 rounded-lg border border-slate-200 disabled:opacity-50"
            >
              {branchesLoading ? '刷新中...' : '刷新'}
            </button>
          </div>
        </div>

        <div className="flex gap-3">
          <button
            onClick={handleDeploy}
            disabled={!branch || deploying}
            className="flex items-center gap-2 px-6 py-2.5 bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors disabled:opacity-50"
          >
            <Play size={16} />
            {deploying ? '部署中...' : '确认部署'}
          </button>
          <button
            onClick={handleDeploy}
            disabled={!branch || deploying}
            className="flex items-center gap-2 px-4 py-2.5 text-slate-600 hover:bg-slate-50 rounded-lg border border-slate-200 disabled:opacity-50"
          >
            <RotateCcw size={16} />
            重新部署
          </button>
          {status === 'running' && (
            <button
              onClick={handleCancel}
              className="flex items-center gap-2 px-4 py-2.5 text-red-600 hover:bg-red-50 rounded-lg border border-red-200"
            >
              取消部署
            </button>
          )}
        </div>

        {status !== 'idle' && (
          <div className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-sm ${statusColor[status]}`}>
            <span className={`w-2 h-2 rounded-full ${statusDot[status]}`} />
            {statusText[status]}
            {connected && status === 'running' && (
              <span className="text-xs text-slate-400">(WS 已连接)</span>
            )}
          </div>
        )}
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 bg-slate-50 border-b border-slate-200">
          <div className="flex items-center gap-2">
            <button onClick={() => setShowLog(!showLog)} className="text-slate-500 hover:text-slate-700">
              {showLog ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
            </button>
            <span className="font-medium text-slate-700">部署日志</span>
            {taskId && (
              <span className="text-xs text-slate-400">任务 #{taskId}</span>
            )}
          </div>
          <button
            onClick={handleDownload}
            disabled={!taskId}
            className="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700 disabled:opacity-50"
          >
            <Download size={14} />
            下载
          </button>
        </div>
        {showLog && (
          <div className="p-4 bg-slate-900 font-mono text-sm text-slate-300 max-h-96 overflow-y-auto">
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
  )
}
