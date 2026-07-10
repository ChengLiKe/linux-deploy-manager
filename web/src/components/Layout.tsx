import { Link, useLocation, useNavigate, Outlet } from 'react-router-dom'
import { useAuthStore } from '@/stores/authStore'
import { LogOut, Key, LayoutTemplate, Settings, Server, Terminal, Rocket, PanelLeftClose, PanelLeft } from 'lucide-react'
import { useEffect, useState, useRef, useCallback } from 'react'
import UpdateNotification from '@/components/UpdateNotification'

const navItems = [
  { path: '/', label: '项目', icon: LayoutTemplate },
  { path: '/deployments', label: '部署', icon: Rocket },
  { path: '/server-nodes', label: '服务器', icon: Server },
  { path: '/terminal', label: '终端', icon: Terminal },
  { path: '/keys', label: '密钥', icon: Key },
  { path: '/settings', label: '设置', icon: Settings },
]

const SIDEBAR_EXPANDED = 224
const SIDEBAR_COLLAPSED = 60
const SIDEBAR_MIN = 60
const SIDEBAR_MAX = 400

export default function Layout() {
  const location = useLocation()
  const navigate = useNavigate()
  const { token, logout } = useAuthStore()
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('sidebar_collapsed') === 'true')
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = localStorage.getItem('sidebar_width')
    return saved ? Number(saved) : SIDEBAR_EXPANDED
  })
  const [resizing, setResizing] = useState(false)
  const sidebarRef = useRef<HTMLDivElement>(null)

  // 展开/折叠切换
  const toggleCollapse = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev
      localStorage.setItem('sidebar_collapsed', String(next))
      if (next) {
        localStorage.setItem('sidebar_width', String(SIDEBAR_COLLAPSED))
        setSidebarWidth(SIDEBAR_COLLAPSED)
      } else {
        const restored = Number(localStorage.getItem('sidebar_width_expanded')) || SIDEBAR_EXPANDED
        setSidebarWidth(restored)
      }
      return next
    })
  }, [])

  // 拖拽调整宽度
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setResizing(true)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    const handleMouseMove = (ev: MouseEvent) => {
      const newWidth = Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, ev.clientX))
      setSidebarWidth(newWidth)
    }

    const handleMouseUp = () => {
      setResizing(false)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
  }, [sidebarWidth, collapsed])

  // 拖拽完成后更新存储（用 useEffect 监听 sidebarWidth 变化后保存）
  useEffect(() => {
    if (!resizing) {
      localStorage.setItem('sidebar_width', String(sidebarWidth))
      if (!collapsed) {
        localStorage.setItem('sidebar_width_expanded', String(sidebarWidth))
      }
    }
  }, [resizing, sidebarWidth, collapsed])

  useEffect(() => {
    if (!token) {
      navigate('/login', { replace: true })
    }
  }, [token, navigate])

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  if (!token) return null

  const isActive = (path: string) => {
    if (path === '/') return location.pathname === '/' || location.pathname.startsWith('/projects')
    return location.pathname.startsWith(path)
  }

  const width = collapsed ? SIDEBAR_COLLAPSED : sidebarWidth

  return (
    <div className="flex h-screen">
      {/* ── 左侧边栏 ── */}
      <aside
        ref={sidebarRef}
        className="relative shrink-0 bg-[#F3F3F3] border-r border-slate-200 flex flex-col overflow-hidden transition-[width] duration-200 ease-out"
        style={{ width }}
      >
        {/* 折叠/展开 按钮 */}
        <div className="flex items-center justify-end h-12 px-2 shrink-0">
          <button
            onClick={toggleCollapse}
            className="p-1.5 rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-200/60 transition-colors"
            title={collapsed ? '展开侧栏' : '收起侧栏'}
          >
            {collapsed ? <PanelLeft size={17} /> : <PanelLeftClose size={17} />}
          </button>
        </div>

        {/* 导航项 */}
        <nav className="flex-1 overflow-y-auto px-2 pb-2 space-y-0.5">
          {navItems.map((item) => {
            const active = isActive(item.path)
            const Icon = item.icon
            return (
              <Link
                key={item.path}
                to={item.path}
                className={`
                  flex items-center gap-3 rounded-lg transition-all duration-150 whitespace-nowrap
                  ${active
                    ? 'bg-amber-50 text-amber-700 font-medium'
                    : 'text-slate-500 hover:text-slate-700 hover:bg-slate-50'
                  }
                  ${collapsed ? 'justify-center px-0 py-2' : 'px-3 py-2'}
                `}
                title={collapsed ? item.label : undefined}
              >
                <div className="relative shrink-0">
                  <Icon size={18} strokeWidth={active ? 2.5 : 2} />
                  {active && collapsed && (
                    <div className="absolute -right-1.5 -top-1 w-2 h-2 rounded-full bg-amber-500" />
                  )}
                </div>
                {!collapsed && (
                  <>
                    <span className="text-sm truncate">{item.label}</span>
                    {active && <div className="ml-auto w-1 h-4 rounded-full bg-amber-500 shrink-0" />}
                  </>
                )}
              </Link>
            )
          })}
        </nav>

        {/* 底部：退出 */}
        <div className={`border-t border-slate-200 p-2 shrink-0 ${collapsed ? 'flex justify-center' : ''}`}>
          <button
            onClick={handleLogout}
            className={`
              flex items-center gap-3 rounded-lg text-sm transition-colors
              text-slate-400 hover:text-red-600 hover:bg-red-50
              ${collapsed ? 'justify-center p-2 w-auto' : 'w-full px-3 py-2'}
            `}
            title={collapsed ? '退出登录' : undefined}
          >
            <LogOut size={16} />
            {!collapsed && <span>退出登录</span>}
          </button>
        </div>

        {/* ── 拖拽手柄 ── */}
        <div
          className={`absolute top-0 right-0 bottom-0 w-2 cursor-col-resize z-20 flex items-center justify-center transition-colors ${resizing ? 'bg-amber-400/20' : 'hover:bg-amber-50'}`}
          onMouseDown={handleMouseDown}
        >
          <div className={`w-0.5 h-8 rounded-full transition-colors ${resizing ? 'bg-amber-500' : 'bg-slate-300'}`} />
        </div>
      </aside>

      {/* ── 右侧主内容 ── */}
      <div className="flex-1 flex flex-col min-w-0 bg-white">
        <UpdateNotification />

        <main className="flex-1 overflow-auto">
          <div className="p-6 max-w-7xl mx-auto">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  )
}
