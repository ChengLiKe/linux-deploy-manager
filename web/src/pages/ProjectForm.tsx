import { useEffect, useState, useRef } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { Save, ArrowLeft } from 'lucide-react'
import { projectApi, keyApi } from '../utils/api'
import Select from '../components/Select'

interface SSHKey {
  id: number
  name: string
  algorithm: string
  source: 'managed' | 'system'
}

const initialForm = {
  name: '',
  description: '',
  git_url: '',
  ssh_key_id: 0,
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

export default function TemplateForm() {
  const { id } = useParams()
  const navigate = useNavigate()
  const isEdit = !!id
  const projectId = Number(id)

  const [form, setForm] = useState(initialForm)
  const [keys, setKeys] = useState<SSHKey[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const basicRef = useRef<HTMLDivElement>(null)
  const gitRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!isEdit) return
    setLoading(true)
    projectApi
      .get(projectId)
      .then((res) => {
        const d = res.data.data
        if (d) {
          const t = d.project || d
          setForm({
            name: t.name || '',
            description: t.description || '',
            git_url: t.git_url || '',
            ssh_key_id: t.ssh_key_id || 0,
          })
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
  }, [])

  const buildPayload = () => {
    return { ...form }
  }

  const handleSave = async () => {
    setSaving(true)
    setError('')
    try {
      const payload = buildPayload()
      if (isEdit) {
        await projectApi.update(projectId, payload)
        alert('保存成功')
      } else {
        await projectApi.create(payload)
        navigate('/projects')
      }
    } catch (err: any) {
      setError(err.response?.data?.message || '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const inputCls =
    'w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500 transition-colors'
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
          onClick={handleSave}
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

      {/* 主表单区域 */}
      <div>

        {/* ── 卡片：基本信息 + Git 配置 ── */}
        <div>
          {/* 基本信息 */}
          <div className="p-6 pb-4">
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
                <Select
                  label="SSH 密钥"
                  value={form.ssh_key_id}
                  onChange={(val) => setForm({ ...form, ssh_key_id: Number(val) })}
                >
                  <option value={0}>请选择密钥</option>
                  {keys.map((k) => (
                    <option key={k.id} value={k.id}>{k.name}</option>
                  ))}
                </Select>
              </div>
            </Section>
          </div>
        </div>

        {/* ── 底部导航 ── */}
        <div className="flex items-center justify-between py-4">
          <div className="text-xs text-slate-400">
            {isEdit ? 
            '修改后记得点击保存按钮' : <Link to="/deployments">创建项目后，可前往部署页面配置部署方式和目标服务器</Link>}
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate('/projects')}
              className="px-4 py-2 text-sm text-slate-600 hover:text-slate-800 hover:bg-slate-100 rounded-lg transition-colors"
            >
              返回
            </button>
            <button
              onClick={handleSave}
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
