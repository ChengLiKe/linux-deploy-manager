import { useState, useEffect, useCallback, useRef } from 'react'
import { Globe, Plus, ExternalLink, Edit3, Trash2, X, Check, FolderOpen, ChevronDown, ChevronRight, AlertTriangle } from 'lucide-react'
import { urlApi } from '../utils/api'

interface ServerURL {
  id: number
  node_id: number
  name: string
  url: string
  group: string
  description: string
  sort_order: number
}

interface Props {
  nodeId: number
}

export default function ServerURLs({ nodeId }: Props) {
  const [urls, setUrls] = useState<ServerURL[]>([])
  const [groups, setGroups] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set(['default']))
  const toastTimer = useRef<ReturnType<typeof setTimeout>>()

  // 表单状态
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [formName, setFormName] = useState('')
  const [formUrl, setFormUrl] = useState('')
  const [formGroup, setFormGroup] = useState('default')
  const [formDesc, setFormDesc] = useState('')
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)

  // Toast
  const [toast, setToast] = useState('')

  // 删除确认对话框
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: number; name: string } | null>(null)

  const showToast = useCallback((msg: string) => {
    setToast(msg)
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(''), 3000)
  }, [])

  const fetchUrls = useCallback(async () => {
    setLoading(true)
    try {
      const res = await urlApi.list(nodeId)
      const data = res.data.data
      setUrls(data.urls || [])
      setGroups(data.groups || [])
    } catch {
      // 静默
    } finally {
      setLoading(false)
    }
  }, [nodeId])

  useEffect(() => {
    fetchUrls()
  }, [fetchUrls])

  useEffect(() => {
    return () => {
      if (toastTimer.current) clearTimeout(toastTimer.current)
    }
  }, [])

  const grouped: Record<string, ServerURL[]> = {}
  urls.forEach((u) => {
    const g = u.group || 'default'
    if (!grouped[g]) grouped[g] = []
    grouped[g].push(u)
  })

  const groupOrder = [...new Set([...groups.filter((g) => grouped[g]), ...Object.keys(grouped)])]

  const openAddForm = () => {
    setEditingId(null)
    setFormName('')
    setFormUrl('')
    setFormGroup('default')
    setFormDesc('')
    setFormError('')
    setShowForm(true)
  }

  const openEditForm = (u: ServerURL) => {
    setEditingId(u.id)
    setFormName(u.name)
    setFormUrl(u.url)
    setFormGroup(u.group)
    setFormDesc(u.description || '')
    setFormError('')
    setShowForm(true)
  }

  const handleSave = async () => {
    setFormError('')
    if (!formName.trim()) { setFormError('请输入服务名称'); return }
    if (!formUrl.trim()) { setFormError('请输入网址'); return }

    setSaving(true)
    try {
      const payload = {
        node_id: nodeId,
        name: formName.trim(),
        url: formUrl.trim(),
        group: formGroup.trim() || 'default',
        description: formDesc.trim(),
      }

      if (editingId) {
        await urlApi.update(editingId, payload)
      } else {
        await urlApi.create(payload)
      }

      setShowForm(false)
      showToast('保存成功')
      fetchUrls()
    } catch (err: any) {
      setFormError(err.response?.data?.message || '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!deleteConfirm) return
    try {
      await urlApi.delete(deleteConfirm.id)
      setDeleteConfirm(null)
      showToast('已删除')
      fetchUrls()
    } catch {
      showToast('删除失败')
    }
  }

  const toggleGroup = (g: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(g)) next.delete(g)
      else next.add(g)
      return next
    })
  }

  const openInBrowser = (url: string) => {
    if (window.electronAPI?.openExternal) {
      window.electronAPI.openExternal(url)
    } else {
      window.open(url, '_blank')
    }
  }

  return (
    <div className="mt-4 border-t border-slate-100 pt-4">
      {/* Toast */}
      {toast && (
        <div className="mb-3 text-xs text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2 flex items-center gap-1.5 animate-fade-in">
          <Check size={12} />
          {toast}
        </div>
      )}

      {/* 标题栏 */}
      <div className="flex items-center justify-between mb-3">
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="flex items-center gap-2 text-sm font-medium text-slate-700 hover:text-slate-900 transition-colors"
        >
          {collapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
          <Globe size={15} className="text-slate-400" />
          网址管理
          {urls.length > 0 && (
            <span className="text-xs text-slate-400 font-normal">({urls.length})</span>
          )}
        </button>
        {!collapsed && (
          <button
            onClick={openAddForm}
            className="flex items-center gap-1 px-2 py-1 text-xs text-amber-600 hover:bg-amber-50 border border-amber-200 rounded-lg transition-colors"
          >
            <Plus size={12} />
            添加网址
          </button>
        )}
      </div>

      {!collapsed && (
        <>
          {/* 输入表单 */}
          {showForm && (
            <div className="mb-3 p-3 bg-slate-50 rounded-xl border border-slate-200">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-medium text-slate-700">
                  {editingId ? '编辑网址' : '添加网址'}
                </span>
                <button onClick={() => setShowForm(false)} className="p-1 text-slate-400 hover:text-slate-600">
                  <X size={16} />
                </button>
              </div>
              {formError && (
                <div className="mb-2 text-xs text-red-600 bg-red-50 px-2 py-1 rounded">{formError}</div>
              )}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">服务名称</label>
                  <input
                    type="text"
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    className="w-full px-2.5 py-1.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500/30"
                    placeholder="如：Web 管理面板"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">
                    分组
                    <span className="text-slate-400 ml-1">(可选)</span>
                  </label>
                  <input
                    type="text"
                    value={formGroup}
                    onChange={(e) => setFormGroup(e.target.value)}
                    className="w-full px-2.5 py-1.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500/30"
                    placeholder="default"
                    list="group-list"
                  />
                  <datalist id="group-list">
                    {groups.map((g) => (
                      <option key={g} value={g} />
                    ))}
                  </datalist>
                </div>
                <div className="md:col-span-2">
                  <label className="block text-xs font-medium text-slate-500 mb-1">网址</label>
                  <input
                    type="text"
                    value={formUrl}
                    onChange={(e) => setFormUrl(e.target.value)}
                    className="w-full px-2.5 py-1.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500/30 font-mono"
                    placeholder="https://example.com:8080"
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-xs font-medium text-slate-500 mb-1">
                    备注
                    <span className="text-slate-400 ml-1">(可选)</span>
                  </label>
                  <input
                    type="text"
                    value={formDesc}
                    onChange={(e) => setFormDesc(e.target.value)}
                    className="w-full px-2.5 py-1.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500/30"
                    placeholder="简要描述服务的用途"
                  />
                </div>
              </div>
              <div className="flex items-center justify-end gap-2">
                <button
                  onClick={() => setShowForm(false)}
                  className="px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                >
                  取消
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:opacity-50 transition-colors"
                >
                  <Check size={12} />
                  {saving ? '保存中...' : '保存'}
                </button>
              </div>
            </div>
          )}

          {/* 网址列表 */}
          {loading && urls.length === 0 ? (
            <div className="text-xs text-slate-400 py-4 text-center">加载中...</div>
          ) : urls.length === 0 ? (
            <div className="text-xs text-slate-400 py-4 text-center">
              暂无网址记录，点击「添加网址」添加
            </div>
          ) : (
            <div className="space-y-3">
              {groupOrder.map((group) => {
                const items = grouped[group]
                if (!items) return null
                const isExpanded = expandedGroups.has(group)

                return (
                  <div key={group}>
                    {groupOrder.length > 1 && (
                      <button
                        onClick={() => toggleGroup(group)}
                        className="flex items-center gap-1.5 mb-1.5 text-xs font-medium text-slate-500 hover:text-slate-700 transition-colors"
                      >
                        <FolderOpen size={12} />
                        {group === 'default' ? '未分组' : group}
                        <span className="text-slate-300">({items.length})</span>
                        {!isExpanded && <ChevronRight size={12} />}
                      </button>
                    )}
                    {isExpanded && (
                      <div className="space-y-1.5">
                        {items.map((u) => (
                          <div
                            key={u.id}
                            className="flex items-center gap-3 px-3 py-2 bg-white border border-slate-100 rounded-lg hover:border-slate-200 hover:shadow-sm transition-all"
                          >
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-medium text-slate-700 truncate">{u.name}</span>
                                {u.group !== 'default' && groupOrder.length > 1 && (
                                  <span className="px-1.5 py-0.5 rounded text-[10px] bg-slate-100 text-slate-500">{u.group}</span>
                                )}
                              </div>
                              <div className="flex items-center gap-2 mt-0.5">
                                <code className="text-xs text-slate-400 truncate font-mono">{u.url}</code>
                                {u.description && (
                                  <span className="text-[10px] text-slate-400 hidden md:inline">· {u.description}</span>
                                )}
                              </div>
                            </div>
                            {/* 操作按钮 — 始终显示 */}
                            <div className="flex items-center gap-1 shrink-0">
                              <button
                                onClick={() => openInBrowser(u.url)}
                                className="p-1.5 text-amber-600 hover:bg-amber-50 rounded-md transition-colors"
                                title="在默认浏览器打开"
                              >
                                <ExternalLink size={14} />
                              </button>
                              <button
                                onClick={() => openEditForm(u)}
                                className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-md transition-colors"
                                title="编辑"
                              >
                                <Edit3 size={14} />
                              </button>
                              <button
                                onClick={() => setDeleteConfirm({ id: u.id, name: u.name })}
                                className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors"
                                title="删除"
                              >
                                <Trash2 size={14} />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}

      {/* 删除确认对话框 */}
      {deleteConfirm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50"
             onClick={() => setDeleteConfirm(null)}>
          <div
            className="bg-white rounded-xl shadow-xl w-full max-w-sm mx-4 p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-full bg-red-50 flex items-center justify-center">
                <AlertTriangle size={20} className="text-red-500" />
              </div>
              <div>
                <h3 className="text-base font-semibold text-slate-800">确认删除</h3>
                <p className="text-sm text-slate-500 mt-0.5">
                  确定要删除「{deleteConfirm.name}」吗？
                </p>
              </div>
            </div>
            <p className="text-xs text-slate-400 mb-4 ml-[52px]">此操作不可撤销</p>
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={() => setDeleteConfirm(null)}
                className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleDelete}
                className="px-4 py-2 text-sm font-medium bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
              >
                删除
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
