import { AlertTriangle } from 'lucide-react'

interface ConfirmDialogProps {
  open: boolean
  title?: string
  message: string
  subtext?: string
  confirmLabel?: string
  cancelLabel?: string
  variant?: 'danger' | 'warning' | 'info'
  onConfirm: () => void
  onCancel: () => void
  loading?: boolean
}

export default function ConfirmDialog({
  open,
  title = '确认操作',
  message,
  subtext,
  confirmLabel = '确认',
  cancelLabel = '取消',
  variant = 'danger',
  onConfirm,
  onCancel,
  loading = false,
}: ConfirmDialogProps) {
  if (!open) return null

  const variantColors = {
    danger: { icon: 'bg-red-50', iconColor: 'text-red-500', btn: 'bg-red-600 hover:bg-red-700' },
    warning: { icon: 'bg-amber-50', iconColor: 'text-amber-500', btn: 'bg-amber-600 hover:bg-amber-700' },
    info: { icon: 'bg-blue-50', iconColor: 'text-blue-500', btn: 'bg-blue-600 hover:bg-blue-700' },
  }

  const colors = variantColors[variant]

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={onCancel}>
      <div
        className="bg-white rounded-xl shadow-xl w-full max-w-sm mx-4 p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3 mb-3">
          <div className={`w-10 h-10 rounded-full ${colors.icon} flex items-center justify-center shrink-0`}>
            <AlertTriangle size={20} className={colors.iconColor} />
          </div>
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-slate-800">{title}</h3>
            <p className="text-sm text-slate-500 mt-0.5">{message}</p>
          </div>
        </div>
        {subtext && (
          <p className="text-xs text-slate-400 mb-4 ml-[52px]">{subtext}</p>
        )}
        <div className="flex items-center justify-end gap-2">
          <button
            onClick={onCancel}
            disabled={loading}
            className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg transition-colors disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className={`px-4 py-2 text-sm font-medium text-white rounded-lg transition-colors disabled:opacity-50 ${colors.btn}`}
          >
            {loading ? '处理中...' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
