import { useNavigate } from 'react-router-dom'
import { Terminal, Server, Laptop } from 'lucide-react'

export default function TerminalManage() {
  const navigate = useNavigate()

  return (
    <div className="flex items-center justify-center h-full bg-slate-50">
      <div className="text-center max-w-sm">
        <Terminal size={40} className="mx-auto mb-4 text-slate-300" />
        <h3 className="text-base font-semibold text-slate-600 mb-2">终端管理</h3>
        <p className="text-sm text-slate-400 mb-6">
          从左侧列表选择已打开的终端会话，或创建新的连接
        </p>
        <div className="flex flex-col gap-2 items-center">
          <button
            onClick={() => navigate('/terminal/local')}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors"
          >
            <Laptop size={16} />
            开启本地终端
          </button>
          <button
            onClick={() => navigate('/server-nodes')}
            className="flex items-center gap-2 px-4 py-2 text-sm text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
          >
            <Server size={16} />
            从服务器节点连接
          </button>
        </div>
      </div>
    </div>
  )
}
