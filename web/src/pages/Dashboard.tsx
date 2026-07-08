import { Link } from 'react-router-dom'
import { LayoutTemplate, Key, Zap } from 'lucide-react'

export default function Dashboard() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-slate-800">仪表盘</h2>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="项目总数" value="0" icon={LayoutTemplate} color="bg-blue-50 text-blue-600" />
        <StatCard title="SSH 密钥" value="0" icon={Key} color="bg-green-50 text-green-600" />
        <StatCard title="部署次数" value="0" icon={Zap} color="bg-amber-50 text-amber-600" />

      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl border border-slate-200 p-6">
          <h3 className="text-lg font-semibold text-slate-800 mb-4">快捷入口</h3>
          <div className="grid grid-cols-2 gap-3">
            <Link to="/projects/new" className="flex items-center gap-3 p-4 bg-slate-50 rounded-lg hover:bg-slate-100 transition-colors">
              <LayoutTemplate size={20} className="text-amber-600" />
              <span className="text-slate-700">创建项目</span>
            </Link>
            <Link to="/keys" className="flex items-center gap-3 p-4 bg-slate-50 rounded-lg hover:bg-slate-100 transition-colors">
              <Key size={20} className="text-green-600" />
              <span className="text-slate-700">管理密钥</span>
            </Link>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-6">
          <h3 className="text-lg font-semibold text-slate-800 mb-4">最近部署</h3>
          <p className="text-slate-400 text-sm">暂无部署记录</p>
        </div>
      </div>
    </div>
  )
}

function StatCard({ title, value, icon: Icon, color }: { title: string; value: string; icon: any; color: string }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-slate-500">{title}</p>
          <p className="text-2xl font-bold text-slate-800 mt-1">{value}</p>
        </div>
        <div className={`p-3 rounded-lg ${color}`}>
          <Icon size={20} />
        </div>
      </div>
    </div>
  )
}
