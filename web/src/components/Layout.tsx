import { Link, useLocation, useNavigate, Outlet } from 'react-router-dom'
import { useAuthStore } from '@/stores/authStore'
import { LogOut, Key, LayoutTemplate, Home, Settings, Server } from 'lucide-react'
import { useEffect } from 'react'
import UpdateNotification from '@/components/UpdateNotification'

const navItems = [
  { path: '/', label: '仪表盘', icon: Home },
  { path: '/projects', label: '项目', icon: LayoutTemplate },
  { path: '/server-nodes', label: '服务器', icon: Server },
  { path: '/keys', label: '密钥', icon: Key },
  { path: '/settings', label: '设置', icon: Settings },
]

export default function Layout() {
  const location = useLocation()
  const navigate = useNavigate()
  const { token, logout } = useAuthStore()

  useEffect(() => {
    if (!token) {
      navigate('/login', { replace: true })
    }
  }, [token, navigate])

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  if (!token) {
    return null
  }

  return (
    <div className="flex flex-col h-screen bg-slate-50">
      <header className="bg-white border-b border-slate-200 shrink-0">
        <div className="flex items-center justify-between px-4 h-12 max-w-7xl mx-auto">
          <nav className="flex items-center gap-1">
            {navItems.map((item) => {
              const isActive = location.pathname === item.path
              const Icon = item.icon
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition-colors ${
                    isActive
                      ? 'bg-amber-50 text-amber-700 font-medium'
                      : 'text-slate-500 hover:text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  <Icon size={16} />
                  <span>{item.label}</span>
                </Link>
              )
            })}
          </nav>
          <button
            onClick={handleLogout}
            className="flex items-center gap-1.5 text-sm text-slate-400 hover:text-slate-600 transition-colors"
          >
            <LogOut size={15} />
            退出
          </button>
        </div>
      </header>

      <UpdateNotification />

      <main className="flex-1 overflow-auto">
        <div className="p-4 max-w-7xl mx-auto">
          <Outlet />
        </div>
      </main>
    </div>
  )
}
