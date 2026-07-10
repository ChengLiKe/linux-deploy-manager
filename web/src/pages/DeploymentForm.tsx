import { useEffect, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { Save, ArrowLeft, Edit3, Check, X } from 'lucide-react'
import Select from '../components/Select'
import { deploymentApi, projectApi, serverNodeApi } from '../utils/api'
import type { Deployment, CreateDeploymentRequest, Project, ServerNode } from '../types'

const initialForm = {
  name: '',
  description: '',
  project_id: 0,
  server_node_id: 0,
  default_branch: '',
  deploy_mode: 'local' as 'local' | 'container',
  script_filename: 'deploy.sh',
  timeout_sec: 600,
  container_config: '',
  local_config: '',
}

export default function DeploymentForm() {
  const { id } = useParams()
  const navigate = useNavigate()
  const isEdit = !!id
  const deploymentId = Number(id)

  const [form, setForm] = useState(initialForm)
  const [projects, setProjects] = useState<Project[]>([])
  const [serverNodes, setServerNodes] = useState<ServerNode[]>([])
  const [branches, setBranches] = useState<string[]>([])
  const [branchesLoading, setBranchesLoading] = useState(false)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Script editor state for local deploy
  const [localScriptContent, setLocalScriptContent] = useState('')
  const [originalLocalContent, setOriginalLocalContent] = useState('')
  const [isEditingLocal, setIsEditingLocal] = useState(false)

  // Script editor state for container deploy
  const [containerComposeContent, setContainerComposeContent] = useState('')
  const [originalContainerContent, setOriginalContainerContent] = useState('')
  const [isEditingContainer, setIsEditingContainer] = useState(false)

  // Load projects and server nodes
  useEffect(() => {
    projectApi.list({ page_size: 100 }).then((res) => {
      setProjects(res.data.data?.items || [])
    }).catch(() => {})

    serverNodeApi.list().then((res) => {
      setServerNodes(res.data.data || [])
    }).catch(() => {})
  }, [])

  // Load deployment for editing
  useEffect(() => {
    if (!isEdit) return
    setLoading(true)
    deploymentApi.get(deploymentId)
      .then((res) => {
        const d: Deployment = res.data.data
        if (d) {
          setForm({
            name: d.name || '',
            description: d.description || '',
            project_id: d.project_id || 0,
            server_node_id: d.server_node_id || 0,
            default_branch: d.default_branch || '',
            deploy_mode: d.deploy_mode || 'local',
            script_filename: d.script_filename || 'deploy.sh',
            timeout_sec: d.timeout_sec || 600,
            container_config: d.container_config || '',
            local_config: d.local_config || '',
          })

          // Parse local_config for script content
          if (d.local_config) {
            try {
              const lc = JSON.parse(d.local_config)
              const content = lc.script_content || ''
              setLocalScriptContent(content)
              setOriginalLocalContent(content)
            } catch {
              // If not valid JSON, use raw string
              setLocalScriptContent(d.local_config)
              setOriginalLocalContent(d.local_config)
            }
          }

          // Parse container_config for compose content
          if (d.container_config) {
            try {
              const cc = JSON.parse(d.container_config)
              const content = cc.compose_content || ''
              setContainerComposeContent(content)
              setOriginalContainerContent(content)
            } catch {
              setContainerComposeContent(d.container_config)
              setOriginalContainerContent(d.container_config)
            }
          }
        }
      })
      .catch((err) => setError(err.response?.data?.message || '加载部署配置失败'))
      .finally(() => setLoading(false))
  }, [isEdit, deploymentId])

  // Fetch branches when project changes
  useEffect(() => {
    if (form.project_id > 0) {
      setBranchesLoading(true)
      projectApi.branches(form.project_id)
        .then((res) => {
          setBranches(res.data.data || [])
        })
        .catch(() => setBranches([]))
        .finally(() => setBranchesLoading(false))
    } else {
      setBranches([])
    }
  }, [form.project_id])

  const handleSave = async () => {
    setSaving(true)
    setError('')
    try {
      const localConfig = form.deploy_mode === 'local'
        ? JSON.stringify({ script_content: localScriptContent })
        : ''
      const containerConfig = form.deploy_mode === 'container'
        ? JSON.stringify({ compose_content: containerComposeContent })
        : ''

      const payload: CreateDeploymentRequest = {
        ...form,
        server_node_id: form.server_node_id || null,
        local_config: localConfig,
        container_config: containerConfig,
      }

      if (isEdit) {
        await deploymentApi.update(deploymentId, payload)
      } else {
        const res = await deploymentApi.create(payload)
        navigate(`/deployments/${res.data.data?.id}`)
        return
      }
      navigate(`/deployments/${deploymentId}`)
    } catch (err: any) {
      setError(err.response?.data?.message || '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const inputCls = 'w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500 transition-colors'
  const textareaCls = 'w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500 transition-colors font-mono'
  const labelCls = 'block text-sm font-medium text-slate-600 mb-1'

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
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Link
            to="/deployments"
            className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
          >
            <ArrowLeft size={20} />
          </Link>
          <div>
            <h1 className="text-xl font-bold text-slate-800">
              {isEdit ? '编辑部署配置' : '创建部署配置'}
            </h1>
            <p className="text-sm text-slate-400 mt-0.5">
              {isEdit ? '修改部署配置后记得保存' : '配置项目的部署方式和目标服务器'}
            </p>
          </div>
        </div>
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors disabled:opacity-50 shadow-sm"
        >
          <Save size={16} />
          {saving ? '保存中...' : '保存'}
        </button>
      </div>

      {error && (
        <div className="mb-6 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm flex items-center gap-2">
          <span className="w-1.5 h-1.5 bg-red-500 rounded-full shrink-0" />
          {error}
        </div>
      )}

      <div className="space-y-6">
        {/* Section 1: Basic Info */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
          <h3 className="text-base font-semibold text-slate-800 mb-4 flex items-center gap-2">
            <span className="w-1 h-4 bg-amber-500 rounded-full inline-block" />
            基本信息
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div>
              <label className={labelCls}>部署名称 <span className="text-red-500">*</span></label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className={inputCls}
                placeholder="如：生产环境部署"
              />
            </div>
            <div>
              <label className={labelCls}>描述</label>
              <input
                type="text"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                className={inputCls}
                placeholder="部署配置描述（可选）"
              />
            </div>
            <Select
              label="默认分支"
              value={form.default_branch}
              onChange={(val) => setForm({ ...form, default_branch: val })}
            >
              {branchesLoading ? (
                <option value="">加载分支中...</option>
              ) : branches.length === 0 ? (
                <option value="">请先选择项目</option>
              ) : (
                <>
                  <option value="">请选择分支</option>
                  {branches.map((b) => (
                    <option key={b} value={b}>{b}</option>
                  ))}
                </>
              )}
            </Select>
          </div>
        </div>

        {/* Section 2: Associated Resources */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
          <h3 className="text-base font-semibold text-slate-800 mb-4 flex items-center gap-2">
            <span className="w-1 h-4 bg-amber-500 rounded-full inline-block" />
            关联资源
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <Select
              label="关联项目"
              value={form.project_id}
              onChange={(val) => {
                setForm({ ...form, project_id: Number(val), default_branch: '' })
              }}
            >
              <option value={0}>请选择项目</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </Select>
            <Select
              label="目标服务器"
              value={form.server_node_id}
              onChange={(val) => setForm({ ...form, server_node_id: Number(val) })}
            >
              <option value={0}>本地部署</option>
              {serverNodes.map((n) => (
                <option key={n.id} value={n.id}>{n.name} ({n.host})</option>
              ))}
            </Select>
          </div>
        </div>

        {/* Section 3: Deploy Mode & Deploy Command */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
          <h3 className="text-base font-semibold text-slate-800 mb-4 flex items-center gap-2">
            <span className="w-1 h-4 bg-amber-500 rounded-full inline-block" />
            部署方式与脚本配置
          </h3>
          <div className="space-y-5">
            {/* Deploy Mode radio */}
            <div>
              <label className={labelCls}>部署模式</label>
              <div className="flex gap-4 mt-1">
                {(['local', 'container'] as const).map((m) => (
                  <label key={m} className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="deploy_mode"
                      value={m}
                      checked={form.deploy_mode === m}
                      onChange={(e) => setForm({ ...form, deploy_mode: e.target.value as any })}
                      className="w-4 h-4 text-amber-600 focus:ring-amber-500"
                    />
                    <span className="text-sm text-slate-600">
                      {m === 'local' ? '本地部署' : '容器部署'}
                    </span>
                  </label>
                ))}
              </div>
            </div>

            {/* Local deploy: script filename + editor */}
            {form.deploy_mode === 'local' && (
              <div className="bg-slate-50/50 rounded-xl border border-slate-100 p-5 space-y-4">
                <div>
                  <label className={labelCls}>脚本文件名</label>
                  <input
                    type="text"
                    value={form.script_filename}
                    onChange={(e) => setForm({ ...form, script_filename: e.target.value })}
                    className={inputCls}
                    placeholder="deploy.sh"
                  />
                </div>
                <div>
                  <label className={labelCls}>脚本内容</label>
                  {isEditingLocal ? (
                    <textarea
                      value={localScriptContent}
                      onChange={(e) => setLocalScriptContent(e.target.value)}
                      className={textareaCls}
                      rows={12}
                      placeholder="# 在此编写部署脚本..."
                    />
                  ) : (
                    <pre className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-slate-50 font-mono overflow-auto max-h-80 whitespace-pre-wrap">
                      {localScriptContent || '（暂无脚本内容）'}
                    </pre>
                  )}
                  <div className="flex gap-2 mt-2">
                    <button
                      onClick={() => {
                        setOriginalLocalContent(localScriptContent)
                        setIsEditingLocal(true)
                      }}
                      disabled={isEditingLocal}
                      className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-slate-600 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors disabled:opacity-40"
                    >
                      <Edit3 size={14} />
                      编辑
                    </button>
                    <button
                      onClick={() => {
                        setLocalScriptContent(originalLocalContent)
                        setIsEditingLocal(false)
                      }}
                      disabled={!isEditingLocal}
                      className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-red-600 bg-white border border-red-300 rounded-lg hover:bg-red-50 transition-colors disabled:opacity-40"
                    >
                      <X size={14} />
                      取消
                    </button>
                    <button
                      onClick={() => setIsEditingLocal(false)}
                      disabled={!isEditingLocal}
                      className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-green-600 bg-white border border-green-300 rounded-lg hover:bg-green-50 transition-colors disabled:opacity-40"
                    >
                      <Check size={14} />
                      确认
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Container deploy: compose file path + editor */}
            {form.deploy_mode === 'container' && (
              <div className="bg-slate-50/50 rounded-xl border border-slate-100 p-5 space-y-4">
                <div>
                  <label className={labelCls}>Docker Compose 文件路径</label>
                  <input
                    type="text"
                    value={form.script_filename}
                    onChange={(e) => setForm({ ...form, script_filename: e.target.value })}
                    className={inputCls}
                    placeholder="docker-compose.yml"
                  />
                </div>
                <div>
                  <label className={labelCls}>Compose 文件内容</label>
                  {isEditingContainer ? (
                    <textarea
                      value={containerComposeContent}
                      onChange={(e) => setContainerComposeContent(e.target.value)}
                      className={textareaCls}
                      rows={12}
                      placeholder="# 在此编写 docker-compose 配置..."
                    />
                  ) : (
                    <pre className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-slate-50 font-mono overflow-auto max-h-80 whitespace-pre-wrap">
                      {containerComposeContent || '（暂无文件内容）'}
                    </pre>
                  )}
                  <div className="flex gap-2 mt-2">
                    <button
                      onClick={() => {
                        setOriginalContainerContent(containerComposeContent)
                        setIsEditingContainer(true)
                      }}
                      disabled={isEditingContainer}
                      className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-slate-600 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors disabled:opacity-40"
                    >
                      <Edit3 size={14} />
                      编辑
                    </button>
                    <button
                      onClick={() => {
                        setContainerComposeContent(originalContainerContent)
                        setIsEditingContainer(false)
                      }}
                      disabled={!isEditingContainer}
                      className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-red-600 bg-white border border-red-300 rounded-lg hover:bg-red-50 transition-colors disabled:opacity-40"
                    >
                      <X size={14} />
                      取消
                    </button>
                    <button
                      onClick={() => setIsEditingContainer(false)}
                      disabled={!isEditingContainer}
                      className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-green-600 bg-white border border-green-300 rounded-lg hover:bg-green-50 transition-colors disabled:opacity-40"
                    >
                      <Check size={14} />
                      确认
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Timeout */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
          <h3 className="text-base font-semibold text-slate-800 mb-4 flex items-center gap-2">
            <span className="w-1 h-4 bg-amber-500 rounded-full inline-block" />
            其他配置
          </h3>
          <div className="flex items-center gap-5">
            <div className="w-40">
              <label className={labelCls}>部署超时（秒）</label>
              <input
                type="number"
                value={form.timeout_sec}
                onChange={(e) => setForm({ ...form, timeout_sec: Number(e.target.value) })}
                className={inputCls}
              />
            </div>
            <div className="text-xs text-slate-400 leading-relaxed">
              超过设定时间未完成的部署将被自动终止。
            </div>
          </div>
        </div>

        {/* Bottom save and back */}
        <div className="flex items-center justify-between py-4">
          <div className="text-xs text-slate-400">
            {isEdit ? '修改后记得点击保存按钮' : '创建后可在详情页进行部署操作'}
          </div>
          <div className="flex items-center gap-3">
            <Link
              to="/deployments"
              className="px-4 py-2 text-sm text-slate-600 hover:text-slate-800 hover:bg-slate-100 rounded-lg transition-colors"
            >
              返回
            </Link>
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-2 px-5 py-2 text-sm font-medium bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors disabled:opacity-50 shadow-sm"
            >
              <Save size={16} />
              {saving ? '保存中...' : '保存'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
