import { useState } from 'react'
import { Eye, Download } from 'lucide-react'

export default function TaskList() {
  const [tasks] = useState<any[]>([])
  const [filter, setFilter] = useState({ branch: '', status: '' })

  const statuses = [
    { value: '', label: '全部' },
    { value: 'success', label: '成功' },
    { value: 'failed', label: '失败' },
    { value: 'running', label: '进行中' },
  ]

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-slate-800">部署历史</h2>
      </div>

      <div className="flex gap-3">
        <input
          type="text"
          placeholder="分支名"
          value={filter.branch}
          onChange={(e) => setFilter({ ...filter, branch: e.target.value })}
          className="px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500"
        />
        <select
          value={filter.status}
          onChange={(e) => setFilter({ ...filter, status: e.target.value })}
          className="px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500"
        >
          {statuses.map((s) => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </select>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="text-left px-4 py-3 text-sm font-medium text-slate-600">ID</th>
              <th className="text-left px-4 py-3 text-sm font-medium text-slate-600">模板</th>
              <th className="text-left px-4 py-3 text-sm font-medium text-slate-600">分支</th>
              <th className="text-left px-4 py-3 text-sm font-medium text-slate-600">状态</th>
              <th className="text-left px-4 py-3 text-sm font-medium text-slate-600">时间</th>
              <th className="text-right px-4 py-3 text-sm font-medium text-slate-600">操作</th>
            </tr>
          </thead>
          <tbody>
            {tasks.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
                  暂无部署记录
                </td>
              </tr>
            ) : (
              tasks.map((task) => (
                <tr key={task.id} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="px-4 py-3 text-sm text-slate-800">#{task.id}</td>
                  <td className="px-4 py-3 text-sm text-slate-800">{task.project_name || `项目 #${task.project_id}`}</td>
                  <td className="px-4 py-3 text-sm text-slate-600">{task.branch}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 text-xs rounded-full ${
                      task.status === 'success' ? 'bg-green-50 text-green-600' :
                      task.status === 'failed' ? 'bg-red-50 text-red-600' :
                      'bg-blue-50 text-blue-600'
                    }`}>
                      {task.status === 'success' ? '成功' : task.status === 'failed' ? '失败' : '进行中'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-500">{task.created_at}</td>
                  <td className="px-4 py-3 text-right">
                    <button className="p-1.5 text-slate-400 hover:text-blue-600" title="查看">
                      <Eye size={16} />
                    </button>
                    <button className="p-1.5 text-slate-400 hover:text-blue-600" title="下载日志">
                      <Download size={16} />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
