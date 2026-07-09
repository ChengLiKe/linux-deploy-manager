import { useEffect, useState, useCallback, useRef } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { Play, Download, RotateCcw, ChevronDown, ChevronUp, Save, ArrowLeft, FolderOpen, ArrowUp } from 'lucide-react'
import { projectApi, keyApi, taskApi, fsApi, envmanApi, serverNodeApi } from '../utils/api'
import { useWebSocket } from '../hooks/useWebSocket'
import type { ServerNode } from '../types'

interface SSHKey {
  id: number
  name: string
  algorithm: string
  source: 'managed' | 'system'
}

interface LocalConfig {
  exec_type: 'direct' | 'background' | 'systemd'
  runtime_env: string
  env_manager: 'none' | 'nvm' | 'conda' | 'pyenv'
  env_manager_env: string
  service_name: string
  run_user: string
  skip_pre_cmd: boolean
}

interface ContainerConfig {
  compose_file: string
  build_cmd: string
  up_cmd: string
}

const runtimeExamples: Record<string, { pre: string; deploy: string; post: string; check: string }> = {
  nodejs: {
    pre: 'npm install && npm run build',
    deploy: 'npm start',
    post: 'curl -f http://localhost:3000/health || exit 1',
    check: 'node --version',
  },
  python: {
    pre: 'python -m pip install -r requirements.txt',
    deploy: 'python app.py',
    post: 'curl -f http://localhost:5000/health || exit 1',
    check: 'python --version',
  },
  java: {
    pre: 'mvn clean package -DskipTests',
    deploy: 'java -jar target/app.jar',
    post: 'curl -f http://localhost:8080/actuator/health || exit 1',
    check: 'java -version',
  },
  go: {
    pre: 'go build -o app',
    deploy: './app',
    post: 'curl -f http://localhost:8080/health || exit 1',
    check: 'go version',
  },
  php: {
    pre: 'composer install --no-dev',
    deploy: 'php-fpm',
    post: 'curl -f http://localhost/health || exit 1',
    check: 'php --version',
  },
  ruby: {
    pre: 'bundle install',
    deploy: 'bundle exec rails server',
    post: 'curl -f http://localhost:3000/health || exit 1',
    check: 'ruby --version',
  },
  dotnet: {
    pre: 'dotnet build',
    deploy: 'dotnet run',
    post: 'curl -f http://localhost:5000/health || exit 1',
    check: 'dotnet --version',
  },
  other: {
    pre: 'make build',
    deploy: './start.sh',
    post: 'echo "部署完成"',
    check: '',
  },
}

const initialForm = {
  name: '',
  description: '',
  git_url: '',
  ssh_key_id: 0,
  server_node_id: 0,
  code_dir: '',
  env_format: 'dotenv',
  env_content: '',
  deploy_mode: 'local',
  pre_cmd: runtimeExamples.nodejs.pre,
  deploy_cmd: runtimeExamples.nodejs.deploy,
  post_cmd: runtimeExamples.nodejs.post,
  timeout_sec: 600,
}

const initialLocalConfig: LocalConfig = {
  exec_type: 'direct',
  runtime_env: 'nodejs',
  env_manager: 'none',
  env_manager_env: '',
  service_name: '',
  run_user: 'root',
  skip_pre_cmd: false,
}

const initialContainerConfig: ContainerConfig = {
  compose_file: 'docker-compose.yml',
  build_cmd: 'docker-compose build',
  up_cmd: 'docker-compose up -d',
}

interface SectionProps {
  title: string
  id?: string
  children: React.ReactNode
  sectionRef?: React.RefObject<HTMLDivElement>
}

function Section({ title, id, children, sectionRef }: SectionProps) {
  return (
    <div ref={sectionRef} id={id} className="scroll-mt-24">
      <h3 className="text-base font-semibold text-slate-800 mb-4 flex items-center gap-2">
        <span className="w-1 h-4 bg-amber-500 rounded-full inline-block" />
        {title}
      </h3>
      {children}
    </div>
  )
}

interface TimelineItem {
  id: string
  title: string
  ref: React.RefObject<HTMLDivElement>
}

function Timeline({ items }: { items: TimelineItem[] }) {
  const [activeId, setActiveId] = useState<string>('')
  const [collapsed, setCollapsed] = useState(false)
  const [hoveredId, setHoveredId] = useState<string | null>(null)

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setActiveId(entry.target.id)
          }
        })
      },
      { rootMargin: '-20% 0px -70% 0px', threshold: 0 }
    )

    items.forEach((item) => {
      if (item.ref.current) {
        observer.observe(item.ref.current)
      }
    })

    return () => observer.disconnect()
  }, [items])

  const scrollTo = (ref: React.RefObject<HTMLDivElement>) => {
    ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start', inline: 'nearest' })
  }

  const activeIndex = items.findIndex((item) => item.id === activeId)

  return (
    <div className="hidden lg:block fixed left-[max(0px,calc(50%-720px))] top-24 z-30">
      <div className="bg-white/95 backdrop-blur rounded-xl shadow-lg border border-slate-200/80 overflow-hidden transition-all duration-300">
        {/* 头部 */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 rounded-md bg-amber-50 flex items-center justify-center">
              <svg className="w-3 h-3 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </div>
            <span className="text-xs font-semibold text-slate-500 tracking-wide">导航</span>
          </div>
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-600 px-2 py-1 rounded-md hover:bg-slate-50 transition-all"
          >
            <svg
              className={`w-3 h-3 transition-transform duration-200 ${collapsed ? '' : 'rotate-180'}`}
              fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
            </svg>
            {collapsed ? '展开' : '收起'}
          </button>
        </div>

        {/* 步骤列表 */}
        {!collapsed && (
          <div className="p-3">
            <div className="relative">
              {/* 纵向连接线 */}
              <div className="absolute left-[17px] top-2 bottom-2 w-0.5 bg-slate-100 rounded-full" />
              {/* 高亮线段（跟随当前活跃步骤） */}
              {activeIndex >= 0 && (
                <div
                  className="absolute left-[17px] w-0.5 bg-amber-400 rounded-full transition-all duration-500"
                  style={{
                    top: `${activeIndex * 40 + 10}px`,
                    height: `${40}px`,
                  }}
                />
              )}

              <div className="space-y-0">
                {items.map((item, index) => {
                  const isActive = activeId === item.id
                  const isPast = index < activeIndex
                  const isHovered = hoveredId === item.id

                  return (
                    <button
                      key={item.id}
                      onClick={() => scrollTo(item.ref)}
                      onMouseEnter={() => setHoveredId(item.id)}
                      onMouseLeave={() => setHoveredId(null)}
                      className="relative w-full flex items-center gap-3 px-2 py-2 text-left rounded-lg transition-all duration-200 group"
                    >
                      {/* 步骤圆点 */}
                      <div
                        className={`relative z-10 flex items-center justify-center w-[34px] h-[34px] rounded-full shrink-0 transition-all duration-300 ${
                          isActive
                            ? 'bg-amber-500 text-white shadow-md shadow-amber-200 scale-110'
                            : isPast
                            ? 'bg-amber-100 text-amber-600'
                            : isHovered
                            ? 'bg-slate-100 text-slate-600'
                            : 'bg-slate-50 text-slate-400'
                        }`}
                      >
                        {isPast ? (
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                        ) : (
                          <span className={`text-xs font-bold ${isActive ? 'text-white' : ''}`}>{index + 1}</span>
                        )}
                      </div>

                      {/* 文字 */}
                      <div className="min-w-0 flex-1">
                        <div className={`text-xs font-medium transition-colors duration-200 ${
                          isActive
                            ? 'text-amber-700'
                            : isPast
                            ? 'text-slate-500'
                            : 'text-slate-500 group-hover:text-slate-700'
                        }`}>
                          {item.title}
                        </div>
                        <div className="text-[10px] text-slate-400 mt-0.5">
                          {index === 0 ? '名称与仓库' : index === 1 ? '代码与密钥' : index === 2 ? '环境配置' : index === 3 ? '部署策略' : ''}
                        </div>
                      </div>

                      {/* 活跃指示条 */}
                      {isActive && (
                        <div className="absolute right-1 top-1/2 -translate-y-1/2 w-1 h-6 rounded-full bg-amber-400" />
                      )}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* 底部操作提示 */}
            <div className="mt-3 pt-3 border-t border-slate-100">
              <div className="px-2 py-1.5 rounded-md bg-amber-50/50">
                <div className="text-[10px] text-amber-600 leading-relaxed">
                  点击跳转至对应区域
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 折叠态：简洁指示器 */}
        {collapsed && (
          <div className="p-2 flex justify-center">
            <div className="flex items-center gap-1">
              {items.map((item) => (
                <div
                  key={item.id}
                  className={`w-1.5 h-1.5 rounded-full transition-all ${
                    activeId === item.id ? 'bg-amber-500 scale-125' : 'bg-slate-200'
                  }`}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function RuntimeEnvHint({ runtime }: { runtime: string }) {
  const example = runtimeExamples[runtime] || runtimeExamples.other
  return (
    <div className="text-xs text-slate-500 bg-white border border-slate-200 rounded-lg p-3 space-y-1.5">
      <div className="font-medium text-slate-600 mb-1">命令参考</div>
      <div className="flex items-start gap-2"><span className="text-slate-400 w-14 shrink-0">预部署：</span><code className="font-mono bg-slate-100 px-1 rounded">{example.pre}</code></div>
      <div className="flex items-start gap-2"><span className="text-slate-400 w-14 shrink-0">部署：</span><code className="font-mono bg-slate-100 px-1 rounded">{example.deploy}</code></div>
      <div className="flex items-start gap-2"><span className="text-slate-400 w-14 shrink-0">后部署：</span><code className="font-mono bg-slate-100 px-1 rounded">{example.post}</code></div>
      {example.check && <div className="flex items-start gap-2"><span className="text-slate-400 w-14 shrink-0">检查：</span><code className="font-mono bg-slate-100 px-1 rounded">{example.check}</code></div>}
    </div>
  )
}

export default function TemplateForm() {
  const { id } = useParams()
  const navigate = useNavigate()
  const isEdit = !!id
  const projectId = Number(id)

  const [form, setForm] = useState(initialForm)
  const [localConfig, setLocalConfig] = useState<LocalConfig>(initialLocalConfig)
  const [containerConfig, setContainerConfig] = useState<ContainerConfig>(initialContainerConfig)
  const [keys, setKeys] = useState<SSHKey[]>([])
  const [serverNodes, setServerNodes] = useState<ServerNode[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const [latestSuccessTask, setLatestSuccessTask] = useState<any>(null)

  // 环境管理工具检测
  const [availableEnvs, setAvailableEnvs] = useState<string[]>([])
  const [showAddEnv, setShowAddEnv] = useState(false)
  const [newEnvName, setNewEnvName] = useState('')
  const [creatingEnv, setCreatingEnv] = useState(false)

  // 目录检查
  const [dirCheck, setDirCheck] = useState<{
    exists: boolean
    has_git: boolean
    remote_url: string
    match: boolean | null
    message: string
  } | null>(null)
  const [dirChecking, setDirChecking] = useState(false)
  const dirCheckTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [branch, setBranch] = useState('')
  const [branches, setBranches] = useState<string[]>([])
  const [branchesLoading, setBranchesLoading] = useState(false)
  const [deploying, setDeploying] = useState(false)
  const [logs, setLogs] = useState<string[]>([])
  const [status, setStatus] = useState<'idle' | 'running' | 'success' | 'failed' | 'cancelled'>('idle')
  const [showLog, setShowLog] = useState(true)
  const [taskId, setTaskId] = useState<number | null>(null)
  const logsEndRef = useRef<HTMLDivElement>(null)
  const logSectionRef = useRef<HTMLDivElement>(null)
  const basicRef = useRef<HTMLDivElement>(null)
  const gitRef = useRef<HTMLDivElement>(null)
  const envRef = useRef<HTMLDivElement>(null)
  const modeRef = useRef<HTMLDivElement>(null)
  const deployRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!isEdit) return
    setLoading(true)
    projectApi
      .get(projectId)
      .then((res) => {
        const d = res.data.data
        if (d) {
          const t = d.project || d
          setLatestSuccessTask(d.latest_success_task || null)
          const isContainer = t.deploy_mode === 'container'
          setForm({
            name: t.name || '',
            description: t.description || '',
            git_url: t.git_url || '',
            ssh_key_id: t.ssh_key_id || 0,
            server_node_id: t.server_node_id || 0,
            code_dir: t.code_dir || '',
            env_format: t.env_format || 'dotenv',
            env_content: t.env_content || '',
            deploy_mode: t.deploy_mode || 'local',
            pre_cmd: isContainer ? '' : t.pre_cmd || '',
            deploy_cmd: isContainer ? '' : t.deploy_cmd || '',
            post_cmd: isContainer ? '' : t.post_cmd || '',
            timeout_sec: t.timeout_sec || 600,
          })
          if (t.local_config) {
            try {
              setLocalConfig({ ...initialLocalConfig, ...JSON.parse(t.local_config) })
            } catch {}
          }
          if (t.container_config) {
            try {
              setContainerConfig({ ...initialContainerConfig, ...JSON.parse(t.container_config) })
            } catch {}
          }
        }
      })
      .catch((err) => setError(err.response?.data?.message || '加载模板失败'))
      .finally(() => setLoading(false))
  }, [isEdit, projectId])

  useEffect(() => {
    keyApi
      .list()
      .then((res) => setKeys(res.data.data?.keys || []))
      .catch(() => setKeys([]))

    serverNodeApi
      .list()
      .then((res) => setServerNodes(res.data.data || []))
      .catch(() => setServerNodes([]))

    envmanApi
      .detect()
      .then(() => {})
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (localConfig.env_manager && localConfig.env_manager !== 'none') {
      envmanApi
        .listEnvs(localConfig.env_manager)
        .then((res) => setAvailableEnvs(res.data.data?.envs || []))
        .catch(() => setAvailableEnvs([]))
    } else {
      setAvailableEnvs([])
    }
  }, [localConfig.env_manager])

  const loadBranches = useCallback(async () => {
    if (!isEdit) return
    setBranchesLoading(true)
    try {
      const res = await projectApi.branches(projectId)
      setBranches(res.data.data?.branches || [])
    } catch (err) {
      console.error('加载分支失败:', err)
    } finally {
      setBranchesLoading(false)
    }
  }, [isEdit, projectId])

  useEffect(() => {
    loadBranches()
  }, [loadBranches])

  // 目录检查（防抖）
  useEffect(() => {
    if (dirCheckTimer.current) clearTimeout(dirCheckTimer.current)
    if (!form.code_dir || !form.name || !form.git_url) {
      setDirCheck(null)
      return
    }
    dirCheckTimer.current = setTimeout(async () => {
      setDirChecking(true)
      try {
        const res = await fsApi.checkDir({
          code_dir: form.code_dir,
          name: form.name,
          git_url: form.git_url,
        })
        setDirCheck(res.data.data)
      } catch {
        setDirCheck(null)
      } finally {
        setDirChecking(false)
      }
    }, 500)
    return () => {
      if (dirCheckTimer.current) clearTimeout(dirCheckTimer.current)
    }
  }, [form.code_dir, form.name, form.git_url])

  // 加载目录列表 — placeholder
  const buildPayload = () => {
    return {
      ...form,
      env_format: form.env_format as 'dotenv' | 'json',
      deploy_mode: form.deploy_mode as 'local' | 'container',
      local_config: form.deploy_mode === 'local' ? JSON.stringify(localConfig) : '',
      container_config: form.deploy_mode === 'container' ? JSON.stringify(containerConfig) : '',
    }
  }

  const handleCheckEnv = async (tool?: string) => {
    const targetTool = tool || localConfig.env_manager
    setError('')
    try {
      const envsRes = await (targetTool && targetTool !== 'none'
        ? envmanApi.listEnvs(targetTool)
        : Promise.resolve({ data: { data: { envs: [] } } }))
      setAvailableEnvs(envsRes.data.data?.envs || [])
    } catch (err: any) {
      setError(err.response?.data?.message || '环境检查失败')
    }
  }

  const handleCreateEnv = async () => {
    if (!newEnvName.trim() || localConfig.env_manager === 'none') return
    setCreatingEnv(true)
    setError('')
    try {
      await envmanApi.createEnv(localConfig.env_manager, newEnvName.trim())
      setNewEnvName('')
      setShowAddEnv(false)
      await handleCheckEnv(localConfig.env_manager)
      setError('')
    } catch (err: any) {
      setError(err.response?.data?.message || '创建环境失败')
    } finally {
      setCreatingEnv(false)
    }
  }

  const handleSave = async (): Promise<boolean> => {
    setSaving(true)
    setError('')
    try {
      const payload = buildPayload()
      if (isEdit) {
        await projectApi.update(projectId, payload)
      } else {
        await projectApi.create(payload)
        navigate('/projects')
        return true
      }
      setError('')
      return true
    } catch (err: any) {
      setError(err.response?.data?.message || '保存失败')
      return false
    } finally {
      setSaving(false)
    }
  }

  const handleSaveClick = async () => {
    const ok = await handleSave()
    if (ok) {
      alert('保存成功')
    }
  }

  useEffect(() => {
    if (logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [logs])

  // 使用相对路径，由 useWebSocket 自动解析为完整 WebSocket URL
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
        }
      }
    } catch (err) {
      console.error('轮询状态失败:', err)
    }
  }

  const formatTimeText = (value?: string) => {
    if (!value) return '-'
    const d = new Date(value)
    return isNaN(d.getTime()) ? value : d.toLocaleString()
  }

  const handleDeploy = async () => {
    if (!branch) return
    setLogs((prev) => [...prev, '[Deploy] 正在保存模板...'])
    const saved = await handleSave()
    if (!saved) {
      setLogs((prev) => [...prev, '[Deploy] 模板保存失败，停止部署'])
      return
    }
    setDeploying(true)
    setStatus('running')
    setLogs((prev) => [...prev, '[Deploy] 模板已保存，开始创建部署任务'])
    setTaskId(null)
    try {
      const res = await projectApi.deploy(projectId, branch)
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
    if (logSectionRef.current) {
      logSectionRef.current.scrollIntoView({ behavior: 'smooth', block: 'start', inline: 'nearest' })
    }
  }

  const timelineItems: TimelineItem[] = [
    { id: 'section-basic', title: '基本信息', ref: basicRef },
    { id: 'section-git', title: 'Git 配置', ref: gitRef },
    { id: 'section-env', title: '环境变量', ref: envRef },
    { id: 'section-mode', title: '部署方式', ref: modeRef },
    ...(isEdit ? [{ id: 'section-deploy', title: '部署操作', ref: deployRef }] : []),
  ]

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

  const inputCls =
    'w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500 transition-colors'
  const textareaCls =
    'w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500 transition-colors font-mono'
  const labelCls = 'block text-sm font-medium text-slate-600 mb-1'
  const selectCardCls = (active: boolean) =>
    `flex-1 p-4 text-sm border-2 rounded-xl text-left transition-all ${
      active
        ? 'border-amber-500 bg-amber-50/50 shadow-sm'
        : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
    }`

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

  return (
    <div className="max-w-5xl mx-auto">
      {/* 顶部导航栏 */}
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/projects')}
            className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
            title="返回项目列表"
          >
            <ArrowLeft size={20} />
          </button>
          <div>
            <h1 className="text-xl font-bold text-slate-800">
              {isEdit ? '编辑部署项目' : '创建部署项目'}
            </h1>
            <p className="text-sm text-slate-400 mt-0.5">
              {isEdit ? '修改项目配置后记得保存' : '配置 Git 仓库和部署方式，快速搭建自动化部署'}
            </p>
          </div>
        </div>
        <button
          onClick={handleSaveClick}
          disabled={saving}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors disabled:opacity-50 shadow-sm"
        >
          <Save size={16} />
          {saving ? '保存中...' : '保存项目'}
        </button>
      </div>

      {/* 错误提示 */}
      {error && (
        <div className="mb-6 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm flex items-center gap-2">
          <span className="w-1.5 h-1.5 bg-red-500 rounded-full shrink-0" />
          {error}
        </div>
      )}

      {/* 侧边导航 */}
      <Timeline items={timelineItems} />

      {/* 主表单区域 */}
      <div className="space-y-6 lg:pl-52">

        {/* ── 卡片：基本信息 + Git 配置 ── */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          {/* 基本信息 */}
          <div className="p-6 pb-4 border-b border-slate-100">
            <Section title="基本信息" id="section-basic" sectionRef={basicRef}>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                <div>
                  <label className={labelCls}>项目名称</label>
                  <input
                    type="text"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    className={inputCls}
                    placeholder="如：web-api"
                  />
                </div>
                <div className="md:col-span-2">
                  <label className={labelCls}>项目描述</label>
                  <input
                    type="text"
                    value={form.description}
                    onChange={(e) => setForm({ ...form, description: e.target.value })}
                    className={inputCls}
                    placeholder="简要描述项目的用途"
                  />
                </div>
              </div>
            </Section>
          </div>

          {/* Git 配置 */}
          <div className="p-6">
            <Section title="Git 仓库" id="section-git" sectionRef={gitRef}>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <div className="md:col-span-2">
                  <label className={labelCls}>仓库地址</label>
                  <input
                    type="text"
                    value={form.git_url}
                    onChange={(e) => setForm({ ...form, git_url: e.target.value })}
                    className={inputCls}
                    placeholder="git@github.com:owner/repo.git"
                  />
                </div>
                <div>
                  <label className={labelCls}>SSH 密钥</label>
                  <select
                    value={form.ssh_key_id}
                    onChange={(e) => setForm({ ...form, ssh_key_id: Number(e.target.value) })}
                    className={inputCls}
                  >
                    <option value={0}>请选择密钥</option>
                    {keys.map((k) => (
                      <option key={k.id} value={k.id}>{k.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={labelCls}>目标服务器</label>
                  <select
                    value={form.server_node_id}
                    onChange={(e) => setForm({ ...form, server_node_id: Number(e.target.value) })}
                    className={inputCls}
                  >
                    <option value={0}>本机执行（无需服务器）</option>
                    {serverNodes
                      .filter((n) => n.status === 'online' || n.status === 'unknown')
                      .map((n) => (
                        <option key={n.id} value={n.id}>{n.name}</option>
                      ))}
                  </select>
                  {serverNodes.length === 0 && (
                    <p className="text-xs text-amber-600 mt-1.5">
                      暂无可用服务器，请先
                      <Link to="/server-nodes" className="underline hover:text-amber-700 font-medium ml-1">添加服务器</Link>
                    </p>
                  )}
                </div>
                <div className="md:col-span-2">
                  <label className={labelCls}>代码部署目录</label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={form.code_dir}
                      onChange={(e) => setForm({ ...form, code_dir: e.target.value })}
                      className={inputCls}
                      placeholder="/opt/apps"
                    />
                    <button
                      onClick={() => fsApi.checkDir({ code_dir: form.code_dir, name: form.name, git_url: form.git_url })}
                      className="px-3 py-2 text-slate-500 hover:text-slate-700 hover:bg-slate-50 border border-slate-300 rounded-lg transition-colors"
                      title="验证目录"
                    >
                      <FolderOpen size={18} />
                    </button>
                  </div>
                  {form.code_dir && (
                    <div className="mt-2 text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
                      部署位置：<code className="font-mono font-medium">{form.code_dir}/{form.name || '&lt;项目名称&gt;'}</code>
                    </div>
                  )}
                  {dirChecking && (
                    <div className="mt-2 text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
                      正在检查目录状态...
                    </div>
                  )}
                  {dirCheck && !dirChecking && (
                    <div className={`mt-2 text-xs rounded-lg px-3 py-2 border ${
                      dirCheck.match === false
                        ? 'text-red-700 bg-red-50 border-red-200'
                        : dirCheck.match === true
                        ? 'text-green-700 bg-green-50 border-green-200'
                        : dirCheck.exists && !dirCheck.has_git
                        ? 'text-amber-700 bg-amber-50 border-amber-200'
                        : 'text-blue-700 bg-blue-50 border-blue-200'
                    }`}>
                      {dirCheck.message}
                    </div>
                  )}
                </div>
              </div>
            </Section>
          </div>
        </div>

        {/* ── 卡片：环境变量 ── */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
          <Section title="环境变量" id="section-env" sectionRef={envRef}>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-5">
              <div>
                <label className={labelCls}>格式</label>
                <select
                  value={form.env_format}
                  onChange={(e) => setForm({ ...form, env_format: e.target.value as 'dotenv' | 'json' })}
                  className={inputCls}
                >
                  <option value="dotenv">.env</option>
                  <option value="json">JSON</option>
                  <option value="yaml">YAML</option>
                  <option value="plain">纯文本</option>
                </select>
              </div>
              <div className="md:col-span-3">
                <label className={labelCls}>环境变量内容</label>
                <textarea
                  value={form.env_content}
                  onChange={(e) => setForm({ ...form, env_content: e.target.value })}
                  className={textareaCls}
                  rows={4}
                  placeholder="NODE_ENV=production&#10;PORT=3000&#10;DATABASE_URL=postgresql://localhost/mydb"
                />
              </div>
            </div>
          </Section>
        </div>

        {/* ── 卡片：超时时间 ── */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
          <div className="flex items-center gap-5">
            <div className="w-40">
              <label className={labelCls}>部署超时时间</label>
              <input
                type="number"
                value={form.timeout_sec}
                onChange={(e) => setForm({ ...form, timeout_sec: Number(e.target.value) })}
                className={inputCls}
              />
            </div>
            <div className="text-xs text-slate-400 leading-relaxed">
              超过设定时间未完成的部署将被自动终止。<br />
              建议根据项目构建耗时调整，默认 600 秒（10 分钟）。
            </div>
          </div>
        </div>

        {/* ── 卡片：部署方式 ── */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
          <Section title="部署方式" id="section-mode" sectionRef={modeRef}>
            {/* 模式选择卡片 */}
            <div className="flex gap-4 mb-6">
              <button
                onClick={() => {
                  const examples = runtimeExamples[localConfig.runtime_env] || runtimeExamples.other
                  setForm({ ...form, deploy_mode: 'local', pre_cmd: examples.pre, deploy_cmd: examples.deploy, post_cmd: examples.post })
                }}
                className={selectCardCls(form.deploy_mode === 'local')}
              >
                <div className="flex items-center gap-2 mb-1">
                  <div className={`w-2 h-2 rounded-full ${form.deploy_mode === 'local' ? 'bg-amber-500' : 'bg-slate-300'}`} />
                  <span className="font-semibold text-slate-800">本地化部署</span>
                </div>
                <p className="text-xs text-slate-500 ml-4">直接在服务器运行进程，通过 systemd 或 nohup 管理</p>
              </button>
              <button
                onClick={() => setForm({ ...form, deploy_mode: 'container', pre_cmd: '', deploy_cmd: '', post_cmd: '' })}
                className={selectCardCls(form.deploy_mode === 'container')}
              >
                <div className="flex items-center gap-2 mb-1">
                  <div className={`w-2 h-2 rounded-full ${form.deploy_mode === 'container' ? 'bg-amber-500' : 'bg-slate-300'}`} />
                  <span className="font-semibold text-slate-800">容器化部署</span>
                </div>
                <p className="text-xs text-slate-500 ml-4">使用 docker-compose 构建并运行容器</p>
              </button>
            </div>

            {form.deploy_mode === 'local' && (
              <div className="space-y-5 bg-slate-50/50 rounded-xl border border-slate-100 p-5">
                {/* 第 1 行：运行环境 + 执行方式 */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  <div>
                    <label className={labelCls}>运行环境 / 技术栈</label>
                    <select
                      value={localConfig.runtime_env}
                      onChange={(e) => {
                        const newRuntime = e.target.value
                        const examples = runtimeExamples[newRuntime] || runtimeExamples.other
                        setLocalConfig({ ...localConfig, runtime_env: newRuntime })
                        setForm({ ...form, pre_cmd: examples.pre, deploy_cmd: examples.deploy, post_cmd: examples.post })
                      }}
                      className={inputCls}
                    >
                      <option value="nodejs">Node.js</option>
                      <option value="python">Python</option>
                      <option value="java">Java</option>
                      <option value="go">Go</option>
                      <option value="php">PHP</option>
                      <option value="ruby">Ruby</option>
                      <option value="dotnet">.NET</option>
                      <option value="other">其他</option>
                    </select>
                  </div>
                  <div>
                    <label className={labelCls}>执行方式</label>
                    <select
                      value={localConfig.exec_type}
                      onChange={(e) => setLocalConfig({ ...localConfig, exec_type: e.target.value as any })}
                      className={inputCls}
                    >
                      <option value="direct">直接执行（阻塞）</option>
                      <option value="background">后台运行（nohup）</option>
                      <option value="systemd">systemd 服务管理</option>
                    </select>
                  </div>
                </div>

                {/* 命令参考提示 */}
                <RuntimeEnvHint runtime={localConfig.runtime_env} />

                {/* 第 2 行：预部署/部署/后部署 命令 */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                  <div>
                    <label className={labelCls}>
                      预部署命令
                      <span className="text-slate-400 font-normal ml-1">(可选)</span>
                    </label>
                    <textarea
                      value={form.pre_cmd}
                      onChange={(e) => setForm({ ...form, pre_cmd: e.target.value })}
                      className={textareaCls}
                      rows={3}
                      placeholder="npm install && npm run build"
                    />
                  </div>
                  <div>
                    <label className={labelCls}>部署命令</label>
                    <textarea
                      value={form.deploy_cmd}
                      onChange={(e) => setForm({ ...form, deploy_cmd: e.target.value })}
                      className={textareaCls}
                      rows={3}
                      placeholder="npm start"
                    />
                  </div>
                  <div>
                    <label className={labelCls}>
                      后部署命令
                      <span className="text-slate-400 font-normal ml-1">(可选)</span>
                    </label>
                    <textarea
                      value={form.post_cmd}
                      onChange={(e) => setForm({ ...form, post_cmd: e.target.value })}
                      className={textareaCls}
                      rows={3}
                      placeholder="curl -f http://localhost:3000/health"
                    />
                  </div>
                </div>

                {/* 环境管理工具 */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  <div>
                    <label className={labelCls}>环境管理工具</label>
                    <select
                      value={localConfig.env_manager}
                      onChange={(e) =>
                        setLocalConfig({
                          ...localConfig,
                          env_manager: e.target.value as any,
                          env_manager_env: '',
                        })
                      }
                      className={inputCls}
                    >
                      <option value="none">不使用</option>
                      <option value="nvm">nvm（Node 版本管理）</option>
                      <option value="conda">conda（Python 环境）</option>
                      <option value="pyenv">pyenv（Python 版本管理）</option>
                    </select>
                  </div>

                  {localConfig.env_manager !== 'none' && (
                    <div>
                      <label className={labelCls}>
                        {localConfig.env_manager === 'nvm'
                          ? 'Node 版本'
                          : localConfig.env_manager === 'conda'
                          ? 'conda 环境名'
                          : 'Python 版本'}
                      </label>
                      <div className="flex items-center gap-2">
                        <select
                          value={localConfig.env_manager_env}
                          onChange={(e) => setLocalConfig({ ...localConfig, env_manager_env: e.target.value })}
                          className={inputCls}
                          disabled={availableEnvs.length === 0}
                        >
                          <option value="">
                            {availableEnvs.length === 0 ? '请先检查服务器环境' : '请选择环境'}
                          </option>
                          {availableEnvs.map((env) => (
                            <option key={env} value={env}>{env}</option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={() => setShowAddEnv(!showAddEnv)}
                          className="px-3 py-2 text-xs whitespace-nowrap bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors"
                        >
                          {showAddEnv ? '取消' : '新增'}
                        </button>
                      </div>
                      {showAddEnv && (
                        <div className="mt-2 flex items-center gap-2">
                          <input
                            type="text"
                            value={newEnvName}
                            onChange={(e) => setNewEnvName(e.target.value)}
                            className={inputCls}
                            placeholder={
                              localConfig.env_manager === 'nvm'
                                ? '如：18.0.0'
                                : localConfig.env_manager === 'conda'
                                ? '如：tf-gpu'
                                : '如：3.11.0'
                            }
                          />
                          <button
                            type="button"
                            onClick={handleCreateEnv}
                            disabled={creatingEnv}
                            className="px-3 py-2 text-xs whitespace-nowrap bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:opacity-50"
                          >
                            {creatingEnv ? '创建中...' : '创建'}
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* 高级选项：折叠 */}
                <details className="group">
                  <summary className="text-xs font-medium text-slate-500 cursor-pointer hover:text-slate-700 transition-colors select-none">
                    高级选项
                  </summary>
                  <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-5">
                    {localConfig.exec_type === 'systemd' && (
                      <>
                        <div>
                          <label className={labelCls}>服务名称</label>
                          <input
                            type="text"
                            value={localConfig.service_name}
                            onChange={(e) => setLocalConfig({ ...localConfig, service_name: e.target.value })}
                            className={inputCls}
                            placeholder={form.name || 'my-service'}
                          />
                        </div>
                        <div>
                          <label className={labelCls}>运行用户</label>
                          <input
                            type="text"
                            value={localConfig.run_user}
                            onChange={(e) => setLocalConfig({ ...localConfig, run_user: e.target.value })}
                            className={inputCls}
                          />
                        </div>
                      </>
                    )}
                    <div className="flex items-end pb-1">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={localConfig.skip_pre_cmd}
                          onChange={(e) => setLocalConfig({ ...localConfig, skip_pre_cmd: e.target.checked })}
                          className="w-4 h-4 rounded border-slate-300 text-amber-600 focus:ring-amber-500"
                        />
                        <span className="text-sm text-slate-600">跳过预部署命令</span>
                      </label>
                    </div>
                  </div>
                </details>
              </div>
            )}

            {form.deploy_mode === 'container' && (
              <div className="space-y-5 bg-slate-50/50 rounded-xl border border-slate-100 p-5">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                  <div>
                    <label className={labelCls}>Compose 文件路径</label>
                    <input
                      type="text"
                      value={containerConfig.compose_file}
                      onChange={(e) => setContainerConfig({ ...containerConfig, compose_file: e.target.value })}
                      className={inputCls}
                      placeholder="docker-compose.yml"
                    />
                  </div>
                  <div>
                    <label className={labelCls}>构建命令</label>
                    <input
                      type="text"
                      value={containerConfig.build_cmd}
                      onChange={(e) => setContainerConfig({ ...containerConfig, build_cmd: e.target.value })}
                      className={inputCls}
                      placeholder="docker-compose build"
                    />
                  </div>
                  <div>
                    <label className={labelCls}>启动命令</label>
                    <input
                      type="text"
                      value={containerConfig.up_cmd}
                      onChange={(e) => setContainerConfig({ ...containerConfig, up_cmd: e.target.value })}
                      className={inputCls}
                      placeholder="docker-compose up -d"
                    />
                  </div>
                </div>
              </div>
            )}
          </Section>
        </div>

        {/* ── 卡片：部署操作（仅编辑模式） ── */}
        {isEdit && (
          <div ref={deployRef} id="section-deploy" className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
            <Section title="部署操作">
              {/* 上一次成功部署 */}
              {latestSuccessTask && (
                <div className="bg-green-50/50 border border-green-100 rounded-xl p-4 mb-5">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-2 h-2 bg-green-500 rounded-full" />
                    <span className="text-sm font-medium text-green-800">上一次成功部署</span>
                    <span className="text-xs text-green-600 font-mono">#{latestSuccessTask.id}</span>
                  </div>
                  <div className="grid grid-cols-3 gap-4 text-xs text-green-700">
                    <div>分支：<span className="font-mono">{latestSuccessTask.branch}</span></div>
                    <div>时间：{formatTimeText(latestSuccessTask.ended_at || latestSuccessTask.created_at)}</div>
                    {latestSuccessTask.commit_sha && (
                      <div>Commit：<span className="font-mono">{latestSuccessTask.commit_sha.slice(0, 8)}</span></div>
                    )}
                  </div>
                </div>
              )}

              {/* 部署控制 */}
              <div className="flex items-end gap-4">
                <div className="flex-1">
                  <label className={labelCls}>选择部署分支</label>
                  <div className="flex items-center gap-2 mt-1">
                    <select
                      value={branch}
                      onChange={(e) => setBranch(e.target.value)}
                      className={inputCls}
                      disabled={branches.length === 0}
                    >
                      <option value="">
                        {branchesLoading ? '加载分支中...' : branches.length === 0 ? '保存后加载分支' : '选择分支'}
                      </option>
                      {branches.map((b) => (
                        <option key={b} value={b}>{b}</option>
                      ))}
                    </select>
                    <button
                      onClick={async () => {
                        setBranchesLoading(true)
                        try {
                          const res = await projectApi.branches(projectId)
                          setBranches(res.data.data?.branches || [])
                        } catch (e: any) {
                          setError(e.response?.data?.message || '加载分支列表失败')
                        } finally {
                          setBranchesLoading(false)
                        }
                      }}
                      disabled={branchesLoading}
                      className="px-3 py-2 text-slate-500 hover:text-slate-700 hover:bg-slate-50 border border-slate-300 rounded-lg transition-colors"
                      title="刷新分支列表"
                    >
                      <RotateCcw size={16} className={branchesLoading ? 'animate-spin' : ''} />
                    </button>
                  </div>
                </div>
                <div className="flex items-center gap-2 pb-0.5">
                  <button
                    onClick={handleDeploy}
                    disabled={deploying || !branch}
                    className="flex items-center gap-2 px-5 py-2 text-sm font-medium bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors disabled:opacity-50 shadow-sm"
                  >
                    <Play size={16} />
                    {deploying ? '部署中...' : '开始部署'}
                  </button>
                  {deploying && (
                    <button
                      onClick={handleCancel}
                      className="px-3 py-2 text-sm font-medium text-red-600 border border-red-200 rounded-lg hover:bg-red-50 transition-colors"
                    >
                      取消
                    </button>
                  )}
                  {taskId && status !== 'running' && (
                    <button
                      onClick={handleDownload}
                      className="flex items-center gap-1 px-3 py-2 text-sm text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
                    >
                      <Download size={14} />
                      下载日志
                    </button>
                  )}
                </div>
              </div>

              {/* 状态指示器 */}
              {status !== 'idle' && (
                <div className={`mt-4 inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium ${statusColor[status]}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${statusDot[status]}`} />
                  {statusText[status]}
                </div>
              )}

              {/* 部署日志 */}
              {logs.length > 0 && (
                <div ref={logSectionRef} className="mt-5">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-slate-700">部署日志</span>
                      {connected && <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse" title="实时连接中" />}
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => setShowLog(!showLog)}
                        className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-md transition-colors"
                        title={showLog ? '折叠日志' : '展开日志'}
                      >
                        {showLog ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                      </button>
                      <button
                        onClick={scrollLogToTop}
                        className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-md transition-colors"
                        title="滚动到顶部"
                      >
                        <ArrowUp size={16} />
                      </button>
                    </div>
                  </div>
                  {showLog && (
                    <div className="bg-slate-900 text-slate-100 rounded-xl p-4 font-mono text-xs leading-relaxed max-h-96 overflow-y-auto">
                      {logs.map((line, i) => (
                        <div key={i} className="whitespace-pre-wrap break-all">
                          <span className="text-slate-600 mr-2 select-none">{String(i + 1).padStart(3, ' ')}</span>
                          {line}
                        </div>
                      ))}
                      <div ref={logsEndRef} />
                    </div>
                  )}
                </div>
              )}
            </Section>
          </div>
        )}

        {/* ── 底部导航 ── */}
        <div className="flex items-center justify-between py-4">
          <div className="text-xs text-slate-400">
            {isEdit ? '修改后记得点击保存按钮' : '创建项目后可在编辑页面进行部署操作'}
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate('/projects')}
              className="px-4 py-2 text-sm text-slate-600 hover:text-slate-800 hover:bg-slate-100 rounded-lg transition-colors"
            >
              返回
            </button>
            <button
              onClick={handleSaveClick}
              disabled={saving}
              className="flex items-center gap-2 px-5 py-2 text-sm font-medium bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors disabled:opacity-50 shadow-sm"
            >
              <Save size={16} />
              {saving ? '保存中...' : '保存项目'}
            </button>
          </div>
        </div>

      </div>
    </div>
  )
}

