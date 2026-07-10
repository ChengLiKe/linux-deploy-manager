import { useState, useRef, useEffect, useCallback, Children, isValidElement } from 'react'

interface SelectOption {
  value: string
  label: string
  disabled?: boolean
}

interface SelectProps {
  label?: string
  error?: string
  compact?: boolean
  value?: string | number
  onChange?: (value: string) => void
  disabled?: boolean
  placeholder?: string
  className?: string
  children?: React.ReactNode
}

export default function Select({
  label,
  error,
  compact,
  value,
  onChange,
  disabled,
  placeholder = '请选择',
  className = '',
  children,
}: SelectProps) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  // 从 children 中提取选项
  const options: SelectOption[] = []
  Children.forEach(children, (child) => {
    if (isValidElement(child) && child.type === 'option') {
      options.push({
        value: String(child.props.value),
        label: child.props.children as string,
        disabled: child.props.disabled,
      })
    }
  })

  const selected = options.find((o) => String(o.value) === String(value))
  const displayText = selected?.label || placeholder

  // 点击外部关闭
  useEffect(() => {
    if (!open) return
    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  // 键盘导航
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (disabled) return
      switch (e.key) {
        case 'Enter':
        case ' ':
          e.preventDefault()
          setOpen((v) => !v)
          break
        case 'Escape':
          setOpen(false)
          break
        case 'ArrowDown':
          e.preventDefault()
          if (!open) {
            setOpen(true)
          } else {
            const idx = options.findIndex((o) => String(o.value) === String(value))
            const next = options.findIndex((o, i) => i > idx && !o.disabled)
            if (next !== -1) onChange?.(options[next].value)
          }
          break
        case 'ArrowUp':
          e.preventDefault()
          if (open) {
            const idx = options.findIndex((o) => String(o.value) === String(value))
            const prev = [...options].reverse().findIndex((o, i) => options.length - 1 - i < idx && !o.disabled)
            if (prev !== -1) onChange?.(options[options.length - 1 - prev].value)
          }
          break
      }
    },
    [disabled, open, options, value, onChange]
  )

  const handleSelect = (opt: SelectOption) => {
    if (opt.disabled) return
    onChange?.(opt.value)
    setOpen(false)
  }

  const triggerCls = `
    w-full flex items-center justify-between border transition-all duration-150
    ${compact ? 'px-2.5 py-1.5 text-xs' : 'px-3 py-2 text-sm'}
    ${disabled
      ? 'bg-slate-50 text-slate-400 border-slate-200 cursor-not-allowed'
      : error
        ? 'bg-white text-red-600 border-red-300 focus-within:ring-2 focus-within:ring-red-500/20 focus-within:border-red-500'
        : 'bg-white text-slate-700 border-slate-300 hover:border-slate-400 focus-within:ring-2 focus-within:ring-amber-500/25 focus-within:border-amber-500 cursor-pointer'
    }
    ${open && !disabled && !error ? 'ring-2 ring-amber-500/25 border-amber-500' : ''}
    rounded-md ${className}
  `
    .replace(/\s+/g, ' ')
    .trim()

  return (
    <div className="w-full" ref={containerRef}>
      {label && (
        <label className="block text-sm font-medium text-slate-600 mb-1.5">{label}</label>
      )}
      <div className="relative" onKeyDown={handleKeyDown}>
        {/* Trigger */}
        <div
          role="combobox"
          aria-expanded={open}
          aria-haspopup="listbox"
          tabIndex={disabled ? -1 : 0}
          className={triggerCls}
          onClick={() => !disabled && setOpen((v) => !v)}
        >
          <span className={selected ? 'text-slate-700' : 'text-slate-400'}>{displayText}</span>
          <svg
            className={`w-4 h-4 shrink-0 ml-2 transition-transform duration-150 ${open ? 'rotate-180' : ''} ${disabled ? 'opacity-40' : 'text-slate-400'}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </div>

        {/* Dropdown */}
        {open && !disabled && (
          <div className="absolute z-50 left-0 right-0 mt-1 bg-white border border-slate-200 rounded-md shadow-lg overflow-hidden">
            {options.length === 0 ? (
              <div className="px-3 py-2 text-sm text-slate-400">暂无选项</div>
            ) : (
              <div className="max-h-60 overflow-y-auto" role="listbox">
                {options.map((opt) => {
                  const isSelected = String(opt.value) === String(value)
                  return (
                    <div
                      key={opt.value}
                      role="option"
                      aria-selected={isSelected}
                      className={`
                        px-3 py-2 text-sm cursor-pointer flex items-center justify-between transition-colors
                        ${opt.disabled
                          ? 'text-slate-300 cursor-not-allowed'
                          : isSelected
                            ? 'bg-amber-50 text-amber-700 font-medium'
                            : 'text-slate-700 hover:bg-slate-50'
                        }
                      `}
                      onClick={() => handleSelect(opt)}
                    >
                      <span>{opt.label}</span>
                      {isSelected && (
                        <svg className="w-4 h-4 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}
      </div>
      {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
    </div>
  )
}
