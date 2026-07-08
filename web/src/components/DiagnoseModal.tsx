import { useState, useCallback } from 'react'
import { X, AlertTriangle, CheckCircle, XCircle, SkipForward, Search, Wifi, Server, Key, HardDrive, Globe, Terminal, Copy, Shield, Wrench } from 'lucide-react'
import { serverNodeApi, fixApi } from '../utils/api'

interface FixSuggestion {
  level: string
  title: string
  description: string
  command: string
}

interface DiagnosticItem {
  id: string
  name: string
  status: 'pass' | 'warn' | 'fail' | 'skip'
  duration_ms: number
  detail: string
  error: string
  fixes: FixSuggestion[]
  verify_cmd: string
}

interface DiagnosticSummary {
  total: number
  passed: number
  warned: number
  failed: number
  skipped: number
}

interface ConnectivityReport {
  node_id: number
  node_name: string
  host: string
  port: number
  user: string
  auth_type: string
  start_time: string
  duration_ms: number
  overall: 'pass' | 'partial' | 'fail'
  items: DiagnosticItem[]
  summary: DiagnosticSummary
}

interface DiagnoseModalProps {
  nodeId: number
  nodeName: string
  onClose: () => void
}

const ICON_MAP: Record<string, typeof Wifi> = {
  D1: Search,
  D2: Wifi,
  D3: Terminal,
  D4: Key,
  D5: Terminal,
  D6: HardDrive,
  D7: Shield,
  D8: Globe,
  D9: Server,
}

const STATUS_ICON: Record<string, typeof CheckCircle> = {
  pass: CheckCircle,
  warn: AlertTriangle,
  fail: XCircle,
  skip: SkipForward,
}

const STATUS_COLOR: Record<string, string> = {
  pass: 'text-green-600 bg-green-50 border-green-200',
  warn: 'text-amber-600 bg-amber-50 border-amber-200',
  fail: 'text-red-600 bg-red-50 border-red-200',
  skip: 'text-slate-400 bg-slate-50 border-slate-200',
}

export default function DiagnoseModal({ nodeId, nodeName, onClose }: DiagnoseModalProps) {
  const [report, setReport] = useState<ConnectivityReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set())
  const [copied, setCopied] = useState(false)
  const [fixingItems, setFixingItems] = useState<Set<string>>(new Set())
  const [fixResults, setFixResults] = useState<Record<string, { success: boolean; message: string }>>({})

  const autoFix = useCallback(async (fixType: string) => {
    setFixingItems((prev) => new Set(prev).add(fixType))
    try {
      const res = await fixApi.autoFix(nodeId, fixType)
      const result = res.data.data
      setFixResults((prev) => ({ ...prev, [fixType]: { success: result.success, message: result.message } }))
    } catch (err: any) {
      setFixResults((prev) => ({ ...prev, [fixType]: { success: false, message: err.response?.data?.message || '修复请求失败' } }))
    } finally {
      setFixingItems((prev) => {
        const next = new Set(prev)
        next.delete(fixType)
        return next
      })
    }
  }, [nodeId])

  const runDiagnose = useCallback(async () => {
    setLoading(true)
    setError('')
    setReport(null)
    try {
      const res = await serverNodeApi.diagnose(nodeId)
      setReport(res.data.data?.report || null)
    } catch (err: any) {
      setError(err.response?.data?.message || '诊断执行失败')
    } finally {
      setLoading(false)
    }
  }, [nodeId])

  const toggleExpand = (id: string) => {
    setExpandedItems((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const copyReport = () => {
    if (!report) return
    const text = `连通性诊断报告 - ${nodeName} (${report.host})
诊断时间: ${report.start_time}
总体结果: ${report.overall === 'pass' ? '✅ 通过' : report.overall === 'partial' ? '⚠️ 部分通过' : '❌ 失败'}
通过: ${report.summary.passed} | 警告: ${report.summary.warned} | 失败: ${report.summary.failed} | 跳过: ${report.summary.skipped}
---
${report.items.map((item) => {
  const statusLabel = { pass: '✅', warn: '⚠️', fail: '❌', skip: '⏭️' }[item.status]
  return `${statusLabel} [${item.id}] ${item.name}: ${item.status === 'pass' ? item.detail : item.error || item.detail}`
}).join('\n')}`
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const overallBadge = () => {
    if (!report) return null
    switch (report.overall) {
      case 'pass': return <span className="flex items-center gap-1 px-3 py-1 bg-green-50 text-green-700 rounded-full text-sm font-medium"><CheckCircle size={14} /> 全部通过</span>
      case 'partial': return <span className="flex items-center gap-1 px-3 py-1 bg-amber-50 text-amber-700 rounded-full text-sm font-medium"><AlertTriangle size={14} /> 部分异常</span>
      case 'fail': return <span className="flex items-center gap-1 px-3 py-1 bg-red-50 text-red-700 rounded-full text-sm font-medium"><XCircle size={14} /> 连接失败</span>
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[5vh] bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-lg w-full max-w-2xl flex flex-col max-h-[90vh]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 shrink-0">
          <div className="flex items-center gap-2">
            <Wifi size={18} className="text-amber-600" />
            <h3 className="font-semibold text-slate-800">连通性诊断 — {nodeName}</h3>
          </div>
          <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg">
            <X size={18} />
          </button>
        </div>

        <div className="px-5 py-3 border-b border-slate-100 shrink-0 flex items-center justify-between">
          {report ? (
            <div className="flex items-center gap-3">
              {overallBadge()}
              <span className="text-xs text-slate-400">{report.duration_ms}ms</span>
            </div>
          ) : (
            <span className="text-sm text-slate-500">诊断将检查 DNS、TCP、SSH、认证等 9 项</span>
          )}
          <div className="flex items-center gap-2">
            {report && (
              <button onClick={copyReport} className="flex items-center gap-1 px-2.5 py-1.5 text-xs text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-md">
                <Copy size={13} />
                {copied ? '已复制' : '复制报告'}
              </button>
            )}
            <button
              onClick={runDiagnose}
              disabled={loading}
              className="flex items-center gap-1.5 px-4 py-1.5 bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:opacity-50 text-sm"
            >
              {loading ? (
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <Terminal size={14} />
              )}
              {loading ? '诊断中...' : report ? '重新诊断' : '开始诊断'}
            </button>
          </div>
        </div>

        {error && (
          <div className="mx-5 mt-3 px-3 py-2 bg-red-50 border border-red-200 text-red-700 rounded-lg text-xs">
            {error}
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-2">
          {!report && !loading && (
            <div className="text-sm text-slate-400 py-12 text-center">
              点击"开始诊断"执行 9 项连通性检查
            </div>
          )}
          {loading && !report && (
            <div className="text-sm text-slate-400 py-12 text-center">
              <div className="w-8 h-8 border-3 border-amber-200 border-t-amber-600 rounded-full animate-spin mx-auto mb-3" />
              正在执行诊断...
            </div>
          )}
          {report?.items.map((item) => {
            const Icon = ICON_MAP[item.id] || Terminal
            const StatusIcon = STATUS_ICON[item.status]
            const isExpanded = expandedItems.has(item.id)
            const hasFixes = item.fixes && item.fixes.length > 0
            return (
              <div key={item.id} className={`border rounded-lg overflow-hidden ${STATUS_COLOR[item.status]}`}>
                <button
                  onClick={() => toggleExpand(item.id)}
                  className="w-full flex items-center gap-3 px-3 py-2.5 text-left"
                >
                  <Icon size={16} className="shrink-0 opacity-70" />
                  <StatusIcon size={16} className="shrink-0" />
                  <span className="text-sm font-medium shrink-0">{item.id}</span>
                  <span className="text-sm">{item.name}</span>
                  <span className="text-xs opacity-60 ml-auto">{item.duration_ms}ms</span>
                </button>
                {isExpanded && (
                  <div className="px-3 pb-3 space-y-2">
                    <div className="text-xs leading-relaxed">
                      {item.status === 'pass' ? (
                        <span className="text-green-700">{item.detail}</span>
                      ) : item.status === 'skip' ? (
                        <span className="text-slate-500">{item.detail}</span>
                      ) : (
                        <>
                          <div className="text-red-700 font-medium mb-1">{item.error}</div>
                          <div className="text-slate-600">{item.detail}</div>
                        </>
                      )}
                    </div>
                    {item.verify_cmd && (
                      <div className="bg-slate-800 text-slate-200 text-xs font-mono p-2 rounded flex items-center gap-2">
                        <Terminal size={12} className="shrink-0" />
                        <code className="flex-1">{item.verify_cmd}</code>
                        <button
                          onClick={() => { navigator.clipboard.writeText(item.verify_cmd); setCopied(true); setTimeout(() => setCopied(false), 2000) }}
                          className="text-slate-400 hover:text-white shrink-0"
                        >
                          <Copy size={12} />
                        </button>
                      </div>
                    )}
                    {hasFixes && (
                      <div className="space-y-1.5">
                        {item.fixes.map((fix, i) => {
                          const fixKey = `${item.id}_fix_${i}`
                          const fr = fixResults[fixKey]
                          return (
                          <div key={i} className={`text-xs p-2 rounded border ${fix.level === 'critical' ? 'bg-red-50 border-red-200' : fix.level === 'warning' ? 'bg-amber-50 border-amber-200' : 'bg-slate-50 border-slate-200'}`}>
                            <div className="font-medium mb-0.5">{fix.level === 'critical' ? '🔴' : fix.level === 'warning' ? '🟡' : '🔵'} {fix.title}</div>
                            <div className="text-slate-600 mb-1">{fix.description}</div>
                            {fix.command && (
                              <div className="flex items-center gap-2">
                                <code className="flex-1 block bg-slate-800 text-slate-200 p-1.5 rounded text-[11px]">{fix.command}</code>
                              </div>
                            )}
                            {fr && (
                              <div className={`mt-1.5 p-1.5 rounded text-[11px] ${fr.success ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                                {fr.success ? '✅ ' : '❌ '}{fr.message}
                              </div>
                            )}
                          </div>
                          )
                        })}
                        {/* 一键修复按钮 */}
                        {item.id === 'D4' && (
                          <button
                            onClick={() => autoFix('setup_authorized_keys')}
                            disabled={fixingItems.has('setup_authorized_keys')}
                            className="flex items-center gap-1 px-2.5 py-1.5 text-xs bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:opacity-50"
                          >
                            <Wrench size={12} />
                            {fixingItems.has('setup_authorized_keys') ? '修复中...' : '一键修复: 添加公钥到服务器'}
                          </button>
                        )}
                        {item.id === 'D7' && (
                          <button
                            onClick={() => autoFix('fix_ssh_permissions')}
                            disabled={fixingItems.has('fix_ssh_permissions')}
                            className="flex items-center gap-1 px-2.5 py-1.5 text-xs bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:opacity-50"
                          >
                            <Wrench size={12} />
                            {fixingItems.has('fix_ssh_permissions') ? '修复中...' : '一键修复: 修复 SSH 目录权限'}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {report && (
          <div className="px-5 py-3 border-t border-slate-100 shrink-0 flex items-center justify-between text-xs text-slate-400">
            <span>诊断时间: {new Date(report.start_time).toLocaleString()}</span>
            <span>通过 {report.summary.passed}/{report.summary.total} 项</span>
          </div>
        )}
      </div>
    </div>
  )
}
