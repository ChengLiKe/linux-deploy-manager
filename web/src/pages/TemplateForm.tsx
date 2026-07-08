import { useEffect, useState, useCallback, useRef } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { Play, Download, RotateCcw, ChevronDown, ChevronUp, Save, ArrowLeft, FolderOpen, X, ArrowUp } from 'lucide-react'
import { templateApi, keyApi, taskApi, fsApi, envmanApi, serverNodeApi } from '../utils/api'
import { useWebSocket } from '../hooks/useWebSocket'
import type { ServerNode } from '../types'

interface SSHKey {
  id: number
  name: string
  algorithm: string
  source: 'managed' | 'system'
}

interface DirEntry {
  name: string
  path: string
  is_dir: boolean
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
    <div ref={sectionRef} id={id} className="space-y-2 scroll-mt-4">
      <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wider">{title}</h3>
      {children}
    </div>
  )
}

function Divider() {
  return <div className="border-t border-slate-100" />
}

interface TimelineItem {
  id: string
  title: string
  ref: React.RefObject<HTMLDivElement>
}

function Timeline({ items }: { items: TimelineItem[] }) {
  const [activeId, setActiveId] = useState<string>('')
  const [collapsed, setCollapsed] = useState(false)

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

  return (
    <div className="hidden lg:block fixed left-[15rem] top-24 z-30">
      <div className="bg-white/95 backdrop-blur rounded-xl shadow-lg border border-slate-200/80 p-2 w-40">
        <div className="flex items-center justify-between px-2 mb-1">
          <div className="text-xs font-medium text-slate-500">页面索引</div>
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="text-slate-400 hover:text-slate-600 p-0.5"
          >
            {collapsed ? '展开' : '收起'}
          </button>
        </div>
        {!collapsed && (
          <div className="space-y-0.5">
            {items.map((item, index) => (
              <button
                key={item.id}
                onClick={() => scrollTo(item.ref)}
                className={`w-full flex items-center gap-2 px-2 py-1 text-left text-xs rounded-md transition-colors ${
                  activeId === item.id
                    ? 'bg-amber-50 text-amber-700 font-medium'
                    : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700'
                }`}
              >
                <span className="flex items-center justify-center w-4 h-4 rounded-full bg-slate-100 text-[9px] text-slate-500 shrink-0">
                  {index + 1}
                </span>
                <span className="truncate">{item.title}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function RuntimeEnvHint({ runtime }: { runtime: string }) {
  const example = runtimeExamples[runtime] || runtimeExamples.other
  return (
    <div className="text-xs text-slate-500 bg-white border border-slate-200 rounded-md p-2.5 space-y-1">
      <div className="font-medium text-slate-600">命令参考：</div>
      <div>预部署：{example.pre}</div>
      <div>部署：{example.deploy}</div>
      <div>后部署：{example.post}</div>
      {example.check && <div className="text-slate-400">环境检查：{example.check}</div>}
    </div>
  )
}

export default function TemplateForm() {
  const { id } = useParams()
  const navigate = useNavigate()
  const isEdit = !!id
  const templateId = Number(id)

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
  const [envmanTools, setEnvmanTools] = useState<Record<string, { installed: boolean; version: string }>>({})
  const [availableEnvs, setAvailableEnvs] = useState<string[]>([])
  const [checkingEnv, setCheckingEnv] = useState(false)
  const [showAddEnv, setShowAddEnv] = useState(false)
  const [newEnvName, setNewEnvName] = useState('')
  const [creatingEnv, setCreatingEnv] = useState(false)

  // 目录选择器
  const [showDirPicker, setShowDirPicker] = useState(false)
  const [currentDir, setCurrentDir] = useState('/')
  const [dirEntries, setDirEntries] = useState<DirEntry[]>([])
  const [dirLoading, setDirLoading] = useState(false)

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
    templateApi
      .get(templateId)
      .then((res) => {
        const d = res.data.data
        if (d) {
          const t = d.template || d
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
  }, [isEdit, templateId])

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
      .then((res) => setEnvmanTools(res.data.data?.tools || {}))
      .catch(() => setEnvmanTools({}))
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
      const res = await templateApi.branches(templateId)
      setBranches(res.data.data?.branches || [])
    } catch (err) {
      console.error('加载分支失败:', err)
    } finally {
      setBranchesLoading(false)
    }
  }, [isEdit, templateId])

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

  // 加载目录列表
  const loadDirEntries = async (path: string) => {
    setDirLoading(true)
    try {
      const res = await fsApi.listDir(path)
      setDirEntries(res.data.data?.entries || [])
      setCurrentDir(path)
    } catch (err: any) {
      setError(err.response?.data?.message || '加载目录失败')
    } finally {
      setDirLoading(false)
    }
  }

  const openDirPicker = () => {
    const startPath = form.code_dir || '/'
    loadDirEntries(startPath)
    setShowDirPicker(true)
  }

  const selectDir = (path: string) => {
    setForm({ ...form, code_dir: path })
    setShowDirPicker(false)
  }

  const buildPayload = () => {
    return {
      ...form,
      local_config: form.deploy_mode === 'local' ? JSON.stringify(localConfig) : '',
      container_config: form.deploy_mode === 'container' ? JSON.stringify(containerConfig) : '',
    }
  }

  const handleCheckEnv = async (tool?: string) => {
    const targetTool = tool || localConfig.env_manager
    setCheckingEnv(true)
    setError('')
    try {
      const [detectRes, envsRes] = await Promise.all([
        envmanApi.detect(),
        targetTool && targetTool !== 'none'
          ? envmanApi.listEnvs(targetTool)
          : Promise.resolve({ data: { data: { envs: [] } } }),
      ])
      setEnvmanTools(detectRes.data.data?.tools || {})
      setAvailableEnvs(envsRes.data.data?.envs || [])
    } catch (err: any) {
      setError(err.response?.data?.message || '环境检查失败')
    } finally {
      setCheckingEnv(false)
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
        await templateApi.update(templateId, payload)
      } else {
        await templateApi.create(payload)
        navigate('/templates')
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
    'w-full px-2.5 py-1.5 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-1 focus:ring-amber-500'
  const textareaCls =
    'w-full px-2.5 py-1.5 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-1 focus:ring-amber-500 font-mono'
  const labelCls = 'block text-xs font-medium text-slate-500 mb-0.5'

  if (loading) {
    return <div className="p-4 text-slate-500 text-sm">加载中...</div>
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            onClick={() => navigate('/templates')}
            className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg"
          >
            <ArrowLeft size={18} />
          </button>
          <h2 className="text-lg font-bold text-slate-800">{isEdit ? '部署模板' : '创建模板'}</h2>
        </div>
        <button
          onClick={handleSaveClick}
          disabled={saving}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-amber-600 text-white rounded-md hover:bg-amber-700 transition-colors disabled:opacity-50"
        >
          <Save size={14} />
          {saving ? '保存中...' : '保存模板'}
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded-md text-xs">
          {error}
        </div>
      )}

      <Timeline items={timelineItems} />
      <div className="space-y-3 lg:pl-44">
        <div className="bg-white rounded-lg border border-slate-200 p-4 space-y-3">
          <Section title="基本信息" id="section-basic" sectionRef={basicRef}>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div className="md:col-span-1">
              <label className={labelCls}>模板名称</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className={inputCls}
                placeholder="如：web-api"
              />
            </div>
            <div className="md:col-span-3">
              <label className={labelCls}>描述</label>
              <input
                type="text"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                className={inputCls}
                placeholder="简要描述用途"
              />
            </div>
          </div>
        </Section>

        <Divider />

        <Section title="Git 配置" id="section-git" sectionRef={gitRef}>
          <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
            <div className="md:col-span-6">
              <label className={labelCls}>Git 仓库地址</label>
              <input
                type="text"
                value={form.git_url}
                onChange={(e) => setForm({ ...form, git_url: e.target.value })}
                className={inputCls}
                placeholder="git@github.com:owner/repo.git"
              />
            </div>
            <div className="md:col-span-3">
              <label className={labelCls}>SSH 密钥</label>
              <select
                value={form.ssh_key_id}
                onChange={(e) => setForm({ ...form, ssh_key_id: Number(e.target.value) })}
                className={inputCls}
              >
                <option value={0}>请选择密钥</option>
                {keys.map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="md:col-span-3">
              <label className={labelCls}>目标服务器</label>
              <select
                value={form.server_node_id}
                onChange={(e) => setForm({ ...form, server_node_id: Number(e.target.value) })}
                className={inputCls}
              >
                <option value={0}>请选择服务器</option>
                {serverNodes
                  .filter((n) => n.status === 'online')
                  .map((n) => (
                    <option key={n.id} value={n.id}>
                      {n.name} ({n.status === 'online' ? '在线' : n.status})
                    </option>
                  ))}
              </select>
              {serverNodes.length === 0 && (
                <div className="text-xs text-amber-600 mt-1">
                  暂无在线服务器，请先
                  <Link to="/server-nodes" className="underline hover:text-amber-700">添加服务器</Link>
                </div>
              )}
            </div>
            <div className="md:col-span-3">
              <label className={labelCls}>代码目录</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={form.code_dir}
                  onChange={(e) => setForm({ ...form, code_dir: e.target.value })}
                  className={inputCls}
                  placeholder="/opt/apps/..."
                />
                <button
                  onClick={openDirPicker}
                  className="px-2.5 py-1.5 text-slate-600 hover:bg-slate-50 border border-slate-300 rounded-md"
                  title="选择目录"
                >
                  <FolderOpen size={16} />
                </button>
              </div>
            </div>
          </div>
          {form.code_dir && (
            <div className="mt-2 text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-md px-2.5 py-1.5">
              <span className="font-medium">即将部署的位置：</span>
              <code className="font-mono">{form.code_dir}/{form.name || '<模板名称>'}</code>
            </div>
          )}
          {dirChecking && (
            <div className="mt-1 text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-md px-2.5 py-1.5">
              检查目录状态...
            </div>
          )}
          {dirCheck && !dirChecking && (
            <div
              className={`mt-1 text-xs rounded-md px-2.5 py-1.5 border ${
                dirCheck.match === false
                  ? 'text-red-700 bg-red-50 border-red-200'
                  : dirCheck.match === true
                  ? 'text-green-700 bg-green-50 border-green-200'
                  : dirCheck.exists && !dirCheck.has_git
                  ? 'text-amber-700 bg-amber-50 border-amber-200'
                  : 'text-blue-700 bg-blue-50 border-blue-200'
              }`}
            >
              {dirCheck.message}
            </div>
          )}
        </Section>

        <Divider />

        <Section title="环境变量" id="section-env" sectionRef={envRef}>
          <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
            <div className="md:col-span-2">
              <label className={labelCls}>格式</label>
              <select
                value={form.env_format}
                onChange={(e) => setForm({ ...form, env_format: e.target.value })}
                className={inputCls}
              >
                <option value="dotenv">.env</option>
                <option value="json">JSON</option>
                <option value="yaml">YAML</option>
                <option value="plain">纯文本</option>
              </select>
            </div>
            <div className="md:col-span-10">
              <label className={labelCls}>内容</label>
              <textarea
                value={form.env_content}
                onChange={(e) => setForm({ ...form, env_content: e.target.value })}
                className={textareaCls}
                rows={3}
                placeholder="NODE_ENV=production&#10;PORT=3000"
              />
            </div>
          </div>
        </Section>

        <Divider />

        <div className="w-full md:w-32">
          <label className={labelCls}>超时时间（秒）</label>
          <input
            type="number"
            value={form.timeout_sec}
            onChange={(e) => setForm({ ...form, timeout_sec: Number(e.target.value) })}
            className={inputCls}
          />
        </div>

        <Divider />

        <Section title="部署方式" id="section-mode" sectionRef={modeRef}>
          <div className="flex gap-3">
            <button
              onClick={() => {
                const examples = runtimeExamples[localConfig.runtime_env] || runtimeExamples.other
                setForm({
                  ...form,
                  deploy_mode: 'local',
                  pre_cmd: examples.pre,
                  deploy_cmd: examples.deploy,
                  post_cmd: examples.post,
                })
              }}
              className={`flex-1 p-2.5 text-sm border rounded-md text-left transition-colors ${
                form.deploy_mode === 'local' ? 'border-amber-500 bg-amber-50' : 'border-slate-200 hover:bg-slate-50'
              }`}
            >
              <div className="font-medium text-slate-800">本地化部署</div>
              <div className="text-xs text-slate-500">直接在服务器运行进程</div>
            </button>
            <button
              onClick={() =>
                setForm({
                  ...form,
                  deploy_mode: 'container',
                  pre_cmd: '',
                  deploy_cmd: '',
                  post_cmd: '',
                })
              }
              className={`flex-1 p-2.5 text-sm border rounded-md text-left transition-colors ${
                form.deploy_mode === 'container' ? 'border-amber-500 bg-amber-50' : 'border-slate-200 hover:bg-slate-50'
              }`}
            >
              <div className="font-medium text-slate-800">容器化部署</div>
              <div className="text-xs text-slate-500">使用 docker-compose 构建并运行容器</div>
            </button>
          </div>

          {form.deploy_mode === 'local' && (
            <div className="mt-3 space-y-3 p-3 bg-slate-50 rounded-md border border-slate-100">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
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
                    <option value="direct">直接执行</option>
                    <option value="background">后台运行（nohup）</option>
                    <option value="systemd">systemd 服务</option>
                  </select>
                </div>
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
                  <div className="md:col-span-2">
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
                          <option key={env} value={env}>
                            {env}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => setShowAddEnv(!showAddEnv)}
                        className="px-3 py-1.5 text-xs whitespace-nowrap bg-white border border-slate-300 rounded-md hover:bg-slate-50"
                      >
                        {showAddEnv ? '取消' : '新增环境'}
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
                              ? 'v20.11.0'
                              : localConfig.env_manager === 'conda'
                              ? 'myenv'
                              : '3.11.0'
                          }
                        />
                        <button
                          type="button"
                          onClick={handleCreateEnv}
                          disabled={creatingEnv || !newEnvName.trim()}
                          className="px-3 py-1.5 text-xs whitespace-nowrap bg-amber-500 text-white rounded-md hover:bg-amber-600 disabled:opacity-50"
                        >
                          {creatingEnv ? '创建中...' : '创建'}
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {localConfig.exec_type === 'systemd' && (
                  <>
                    <div>
                      <label className={labelCls}>服务名</label>
                      <input
                        type="text"
                        value={localConfig.service_name}
                        onChange={(e) => setLocalConfig({ ...localConfig, service_name: e.target.value })}
                        className={inputCls}
                        placeholder="my-app"
                      />
                    </div>
                    <div>
                      <label className={labelCls}>运行用户</label>
                      <input
                        type="text"
                        value={localConfig.run_user}
                        onChange={(e) => setLocalConfig({ ...localConfig, run_user: e.target.value })}
                        className={inputCls}
                        placeholder="root"
                      />
                    </div>
                  </>
                )}
              </div>

              <div className="grid grid-cols-1 gap-3">
                <div>
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <label className={labelCls}>预部署命令</label>
                    <span className="text-[10px] text-slate-400">安装依赖 / 构建</span>
                  </div>
                  <textarea
                    value={form.pre_cmd}
                    onChange={(e) => setForm({ ...form, pre_cmd: e.target.value })}
                    className={textareaCls}
                    rows={2}
                    placeholder="npm install && npm run build"
                  />
                  <div className="flex items-center gap-2 mt-1.5">
                    <input
                      id="skip-pre-cmd"
                      type="checkbox"
                      checked={localConfig.skip_pre_cmd}
                      onChange={(e) => setLocalConfig({ ...localConfig, skip_pre_cmd: e.target.checked })}
                      className="h-4 w-4 text-amber-500 border-slate-300 rounded"
                    />
                    <label htmlFor="skip-pre-cmd" className="text-xs text-slate-500 cursor-pointer select-none">
                      重新部署时跳过预部署命令
                    </label>
                  </div>
                </div>
                <div>
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <label className={labelCls}>执行命令</label>
                    <span className="text-[10px] text-slate-400">启动应用，选择运行环境后自动填充</span>
                  </div>
                  <textarea
                    value={form.deploy_cmd}
                    onChange={(e) => setForm({ ...form, deploy_cmd: e.target.value })}
                    className={textareaCls}
                    rows={2}
                    placeholder="npm start"
                  />
                </div>
                <div>
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <label className={labelCls}>后部署命令</label>
                    <span className="text-[10px] text-slate-400">健康检查 / 通知</span>
                  </div>
                  <textarea
                    value={form.post_cmd}
                    onChange={(e) => setForm({ ...form, post_cmd: e.target.value })}
                    className={textareaCls}
                    rows={2}
                    placeholder="echo '部署完成'"
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={() => handleCheckEnv()}
                  disabled={checkingEnv}
                  className="px-3 py-1.5 text-xs bg-white border border-slate-300 rounded-md hover:bg-slate-50 disabled:opacity-50"
                >
                  {checkingEnv ? '检查中...' : '检查服务器环境'}
                </button>
                <div className="flex gap-2 text-xs">
                  {['nvm', 'conda', 'pyenv'].map((tool) => (
                    <span
                      key={tool}
                      className={`px-2 py-0.5 rounded ${
                        envmanTools[tool]?.installed
                          ? 'bg-green-50 text-green-600'
                          : 'bg-slate-100 text-slate-400'
                      }`}
                    >
                      {tool} {envmanTools[tool]?.installed ? '✓' : '✗'}
                    </span>
                  ))}
                </div>
              </div>

              <RuntimeEnvHint runtime={localConfig.runtime_env} />
            </div>
          )}

          {form.deploy_mode === 'container' && (
            <div className="mt-3 space-y-2 p-3 bg-slate-50 rounded-md border border-slate-100">
              <div className="text-xs text-slate-500">
                容器化部署仅支持 docker-compose。默认执行 <code className="bg-white px-1 rounded">docker-compose build</code> 和 <code className="bg-white px-1 rounded">docker-compose up -d</code>，可自行修改命令。
              </div>
              <div>
                <label className={labelCls}>compose 文件路径</label>
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
              <div className="pt-1 text-xs text-slate-500">
                sudo 权限已在
                <a href="/settings" className="font-medium text-amber-600 hover:text-amber-700 mx-0.5">
                  系统设置
                </a>
                中统一配置。
              </div>
            </div>
          )}
        </Section>

        {isEdit && (
          <>
            <Divider />

            <Section title="部署操作" id="section-deploy" sectionRef={deployRef}>
              {latestSuccessTask && (
                <div className="p-3 bg-green-50 border border-green-200 rounded-md mb-3">
                  <div className="text-xs text-green-700 font-medium mb-1">上一次成功部署</div>
                  <div className="grid grid-cols-4 gap-2 text-xs text-green-600">
                    <div>分支: <span className="font-mono text-green-800">{latestSuccessTask.branch}</span></div>
                    <div>Commit: <span className="font-mono text-green-800">{latestSuccessTask.commit_sha ? latestSuccessTask.commit_sha.slice(0, 7) : '-'}</span></div>
                    <div>时间: <span>{formatTimeText(latestSuccessTask.created_at)}</span></div>
                    <div>任务ID: <span className="font-mono">#{latestSuccessTask.id}</span></div>
                  </div>
                </div>
              )}
              <div className="flex flex-wrap items-end gap-3">
                {form.server_node_id > 0 && (
                  <div className="w-full">
                    <div className="text-xs text-slate-500 mb-1">目标服务器</div>
                    <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-md text-sm text-slate-700">
                      {(() => {
                        const node = serverNodes.find((n) => n.id === form.server_node_id)
                        return node ? (
                          <span>
                            {node.name} ({node.host}:{node.port})
                            <span className={`ml-1 inline-block w-1.5 h-1.5 rounded-full ${node.status === 'online' ? 'bg-green-500' : 'bg-red-500'}`} />
                          </span>
                        ) : (
                          <span className="text-slate-400">未知服务器 (ID: {form.server_node_id})</span>
                        )
                      })()}
                    </div>
                  </div>
                )}
                <div className="w-full md:w-56">
                  <label className={labelCls}>选择分支</label>
                  <select
                    value={branch}
                    onChange={(e) => setBranch(e.target.value)}
                    disabled={deploying}
                    className={inputCls}
                  >
                    <option value="">请选择分支</option>
                    {branches.map((b) => (
                      <option key={b} value={b}>
                        {b}
                      </option>
                    ))}
                  </select>
                </div>
                <button
                  onClick={loadBranches}
                  disabled={branchesLoading}
                  className="px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50 rounded-md border border-slate-200 disabled:opacity-50"
                >
                  {branchesLoading ? '刷新中...' : '刷新分支'}
                </button>
                <button
                  onClick={handleDeploy}
                  disabled={!branch || deploying}
                  className="flex items-center gap-1.5 px-4 py-1.5 text-sm bg-amber-600 text-white rounded-md hover:bg-amber-700 transition-colors disabled:opacity-50"
                >
                  {latestSuccessTask ? <RotateCcw size={14} /> : <Play size={14} />}
                  {deploying ? '部署中...' : latestSuccessTask ? '重新部署' : '确认部署'}
                </button>
                {status === 'running' && (
                  <button
                    onClick={handleCancel}
                    className="px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 rounded-md border border-red-200"
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
            </Section>
          </>
        )}
      </div>

      {isEdit && (
        <div ref={logSectionRef} className="bg-white rounded-lg border border-slate-200 overflow-hidden mb-20">
          <div className="flex items-center justify-between px-3 py-2 bg-slate-50 border-b border-slate-200">
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
            <div className="p-3 bg-slate-900 font-mono text-xs text-slate-300 h-[70vh] overflow-y-auto">
              {logs.length === 0 ? (
                <span className="text-slate-500">等待部署...</span>
              ) : (
                <>
                  {logs.map((log, i) => (
                    <div key={i} className="py-0.5 whitespace-pre-wrap">
                      {log}
                    </div>
                  ))}
                  <div ref={logsEndRef} />
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* 底部占位，确保日志区域可以滚动到页面最上方 */}
      {isEdit && <div className="h-[10vh]" />}
      </div>

      {/* 目录选择弹窗 */}
      {showDirPicker && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-lg shadow-lg w-full max-w-md flex flex-col max-h-[80vh]">
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200">
              <h3 className="text-sm font-semibold text-slate-800">选择代码目录</h3>
              <button
                onClick={() => setShowDirPicker(false)}
                className="p-1 text-slate-400 hover:text-slate-600 rounded"
              >
                <X size={16} />
              </button>
            </div>
            <div className="px-4 py-2 bg-slate-50 border-b border-slate-200">
              <div className="text-xs text-slate-500 truncate">当前：{currentDir}</div>
            </div>
            <div className="flex-1 overflow-y-auto p-2">
              {dirLoading ? (
                <div className="p-4 text-center text-sm text-slate-400">加载中...</div>
              ) : (
                <div className="space-y-0.5">
                  {currentDir !== '/' && (
                    <button
                      onClick={() => loadDirEntries(currentDir.split('/').slice(0, -1).join('/') || '/')}
                      className="w-full text-left px-3 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-md"
                    >
                      📁 ../
                    </button>
                  )}
                  {dirEntries.map((entry) => (
                    <div key={entry.path} className="flex items-center gap-2">
                      <button
                        onClick={() => loadDirEntries(entry.path)}
                        className="flex-1 text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-100 rounded-md"
                      >
                        📁 {entry.name}
                      </button>
                      <button
                        onClick={() => selectDir(entry.path)}
                        className="px-2 py-1 text-xs bg-amber-50 text-amber-700 rounded hover:bg-amber-100"
                      >
                        选择
                      </button>
                    </div>
                  ))}
                  {dirEntries.length === 0 && currentDir === '/' && (
                    <div className="p-4 text-center text-sm text-slate-400">暂无子目录</div>
                  )}
                </div>
              )}
            </div>
            <div className="flex items-center justify-between px-4 py-3 border-t border-slate-200">
              <button
                onClick={() => selectDir(currentDir)}
                className="px-3 py-1.5 text-sm bg-amber-600 text-white rounded-md hover:bg-amber-700"
              >
                使用当前目录
              </button>
              <button
                onClick={() => setShowDirPicker(false)}
                className="px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50 rounded-md"
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
