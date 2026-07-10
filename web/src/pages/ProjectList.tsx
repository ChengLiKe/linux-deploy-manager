import { useEffect, useState, useRef } from 'react'
import { Link } from 'react-router-dom'
import { Plus, Trash2, Rocket, RotateCcw, Clock, FolderOpen, GitBranch, X, Pencil, Check } from 'lucide-react'
import { projectApi, type ProjectItem } from '../utils/api'
import HistoryDrawer from '../components/HistoryDrawer'

export default function ProjectList() {
  const [items, setItems] = useState<ProjectItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const [historyTarget, setHistoryTarget] = useState<{ id: number; name: string } | null>(null)

  // Create dropdown
  const [showCreateDropdown, setShowCreateDropdown] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Folder import (browser mode)
  const [showFolderModal, setShowFolderModal] = useState(false)
  const [folderPath, setFolderPath] = useState('')

  // Git import modal
  const [showGitModal, setShowGitModal] = useState(false)
  const [gitUrl, setGitUrl] = useState('')

  // Shared submission state
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')

  // Inline rename
  const [renamingId, setRenamingId] = useState<number | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const renameInputRef = useRef<HTMLInputElement>(null)

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

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowCreateDropdown(false)
      }
    }
    if (showCreateDropdown) {
      document.addEventListener('mousedown', handler)
    }
    return () => document.removeEventListener('mousedown', handler)
  }, [showCreateDropdown])

  // Focus rename input when it appears
  useEffect(() => {
    if (renamingId !== null && renameInputRef.current) {
      renameInputRef.current.focus()
      renameInputRef.current.select()
    }
  }, [renamingId])

  const handleDelete = async (id: number) => {
    if (!confirm('确定要删除这个项目吗？')) return
    try {
      await projectApi.delete(id)
      fetchProjects()
    } catch (err: any) {
      setError(err.response?.data?.message || '删除失败')
    }
  }

  // ── Folder import ──
  const handleImportFolderClick = async () => {
    setShowCreateDropdown(false)
    if (window.electronAPI) {
      // Electron mode: native folder picker
      const folder = await window.electronAPI.selectDirectory()
      if (!folder) return
      setSubmitting(true)
      setSubmitError('')
      try {
        await projectApi.importFolder(folder)
        fetchProjects()
      } catch (err: any) {
        setSubmitError(err.response?.data?.message || '导入失败')
      } finally {
        setSubmitting(false)
      }
    } else {
      // Browser mode: show modal
      setFolderPath('')
      setSubmitError('')
      setShowFolderModal(true)
    }
  }

  const handleFolderConfirm = async () => {
    if (!folderPath.trim()) return
    setSubmitting(true)
    setSubmitError('')
    try {
      await projectApi.importFolder(folderPath.trim())
      setShowFolderModal(false)
      setFolderPath('')
      fetchProjects()
    } catch (err: any) {
      setSubmitError(err.response?.data?.message || '导入失败')
    } finally {
      setSubmitting(false)
    }
  }

  // ── Git import ──
  const handleImportGitClick = () => {
    setShowCreateDropdown(false)
    setGitUrl('')
    setSubmitError('')
    setShowGitModal(true)
  }

  const handleGitConfirm = async () => {
    if (!gitUrl.trim()) return
    setSubmitting(true)
    setSubmitError('')
    try {
      await projectApi.importGit(gitUrl.trim())
      setShowGitModal(false)
      setGitUrl('')
      fetchProjects()
    } catch (err: any) {
      setSubmitError(err.response?.data?.message || '导入失败')
    } finally {
      setSubmitting(false)
    }
  }

  // ── Inline rename ──
  const startRename = (id: number, name: string) => {
    setRenamingId(id)
    setRenameValue(name)
  }

  const cancelRename = () => {
    setRenamingId(null)
    setRenameValue('')
  }

  const saveRename = async () => {
    const id = renamingId
    if (id === null) return
    const trimmed = renameValue.trim()
    if (!trimmed) {
      cancelRename()
      return
    }
    try {
      await projectApi.patch(id, { name: trimmed })
      setRenamingId(null)
      setRenameValue('')
      fetchProjects()
    } catch (err: any) {
      setError(err.response?.data?.message || '重命名失败')
      cancelRename()
    }
  }

  const handleRenameKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      saveRename()
    } else if (e.key === 'Escape') {
      cancelRename()
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

        {/* Create button dropdown */}
        <div className="relative" ref={dropdownRef}>
          <button
            onClick={() => setShowCreateDropdown((v) => !v)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors text-sm"
          >
            <Plus size={15} />
            创建项目
          </button>

          {showCreateDropdown && (
            <div className="absolute right-0 top-full mt-1 w-48 bg-white border border-slate-200 rounded-lg shadow-lg z-50 py-1 text-sm">
              <button
                onClick={handleImportFolderClick}
                className="flex items-center gap-2 w-full px-3 py-2 text-slate-700 hover:bg-slate-50 transition-colors"
              >
                <FolderOpen size={15} />
                从文件夹导入
              </button>
              <button
                onClick={handleImportGitClick}
                className="flex items-center gap-2 w-full px-3 py-2 text-slate-700 hover:bg-slate-50 transition-colors"
              >
                <GitBranch size={15} />
                从Git导入
              </button>
            </div>
          )}
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded-lg text-xs">
          {error}
        </div>
      )}
      {submitError && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded-lg text-xs">
          {submitError}
        </div>
      )}

      {loading ? (
        <div className="text-sm text-slate-500 py-4 text-center">加载中...</div>
      ) : items.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-6 text-center text-slate-400 text-sm">
          你的项目列表比脸还干净 😄 快去右上角「创建项目」打破这份宁静吧！
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
                      {renamingId === p.id ? (
                        <div className="flex items-center gap-1">
                          <input
                            ref={renameInputRef}
                            type="text"
                            value={renameValue}
                            onChange={(e) => setRenameValue(e.target.value)}
                            onKeyDown={handleRenameKeyDown}
                            onBlur={saveRename}
                            className="text-sm font-semibold text-slate-800 border border-amber-300 rounded px-1 py-0.5 w-32 outline-none focus:ring-1 focus:ring-amber-400"
                          />
                          <button
                            onClick={saveRename}
                            className="p-0.5 text-green-600 hover:text-green-700"
                            title="保存"
                          >
                            <Check size={13} />
                          </button>
                          <button
                            onClick={cancelRename}
                            className="p-0.5 text-slate-400 hover:text-slate-600"
                            title="取消"
                          >
                            <X size={13} />
                          </button>
                        </div>
                      ) : (
                        <h3
                          className="font-semibold text-slate-800 text-sm truncate cursor-pointer hover:text-amber-700 flex items-center gap-1"
                          onClick={() => startRename(p.id, p.name)}
                        >
                          {p.name}
                          <Pencil size={11} className="text-slate-300 hover:text-slate-500 shrink-0" />
                        </h3>
                      )}
                    </div>
                    <p className="text-xs text-slate-400 mt-0.5 truncate">{p.description || '暂无描述'}</p>
                  </div>
                </div>

                <div className="flex items-center gap-2 text-xs text-slate-400">
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
                  <Link
                    to={`/deployments?project_id=${p.id}`}
                    className="flex-1 flex items-center justify-center gap-1 py-1.5 bg-amber-50 text-amber-700 rounded-lg hover:bg-amber-100 transition-colors text-xs"
                  >
                    {hasSuccess ? <RotateCcw size={12} /> : <Rocket size={12} />}
                    {hasSuccess ? '重新部署' : '部署'}
                  </Link>
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
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* ── Folder import modal (browser mode) ── */}
      {showFolderModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4 p-6 space-y-4">
            <h3 className="text-base font-semibold text-slate-800">从文件夹导入</h3>
            <div>
              <label className="block text-xs text-slate-500 mb-1">文件夹路径</label>
              <input
                type="text"
                value={folderPath}
                onChange={(e) => setFolderPath(e.target.value)}
                placeholder="/home/user/project"
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-amber-400 focus:border-amber-400"
                disabled={submitting}
                onKeyDown={(e) => e.key === 'Enter' && handleFolderConfirm()}
              />
            </div>
            {submitError && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded-lg text-xs">
                {submitError}
              </div>
            )}
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={() => { setShowFolderModal(false); setSubmitError('') }}
                className="px-4 py-1.5 text-sm text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                disabled={submitting}
              >
                取消
              </button>
              <button
                onClick={handleFolderConfirm}
                disabled={submitting || !folderPath.trim()}
                className="px-4 py-1.5 text-sm bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:opacity-50 transition-colors"
              >
                {submitting ? '导入中...' : '确认'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Git import modal ── */}
      {showGitModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4 p-6 space-y-4">
            <h3 className="text-base font-semibold text-slate-800">从 Git 导入项目</h3>
            <div>
              <label className="block text-xs text-slate-500 mb-1">Git 仓库地址</label>
              <input
                type="text"
                value={gitUrl}
                onChange={(e) => setGitUrl(e.target.value)}
                placeholder="git@github.com:owner/repo.git"
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-amber-400 focus:border-amber-400"
                disabled={submitting}
                onKeyDown={(e) => e.key === 'Enter' && handleGitConfirm()}
              />
            </div>
            {submitError && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded-lg text-xs">
                {submitError}
              </div>
            )}
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={() => { setShowGitModal(false); setSubmitError('') }}
                className="px-4 py-1.5 text-sm text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                disabled={submitting}
              >
                取消
              </button>
              <button
                onClick={handleGitConfirm}
                disabled={submitting || !gitUrl.trim()}
                className="px-4 py-1.5 text-sm bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:opacity-50 transition-colors"
              >
                {submitting ? '导入中...' : '确认'}
              </button>
            </div>
          </div>
        </div>
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
