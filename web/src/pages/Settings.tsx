import { useEffect, useState } from 'react'
import { authApi, settingsApi } from '@/utils/api'

export default function Settings() {
  const [oldPassword, setOldPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [sudoEnabled, setSudoEnabled] = useState(false)
  const [sudoPassword, setSudoPassword] = useState('')
  const [sudoSaved, setSudoSaved] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    Promise.all([
      settingsApi.get('sudo_enabled'),
      settingsApi.get('sudo_password'),
    ])
      .then(([enabledRes, pwRes]) => {
        setSudoEnabled(enabledRes.data.data?.value === 'true')
        const value = pwRes.data.data?.value || ''
        setSudoPassword(value)
        setSudoSaved(!!value)
      })
      .catch(() => {
        setSudoSaved(false)
      })
  }, [])

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault()
    setMessage('')
    setError('')

    if (newPassword !== confirmPassword) {
      setError('两次输入的新密码不一致')
      return
    }
    if (newPassword.length < 8) {
      setError('新密码长度至少 8 位')
      return
    }

    try {
      await authApi.changePassword(oldPassword, newPassword)
      setMessage('密码修改成功')
      setOldPassword('')
      setNewPassword('')
      setConfirmPassword('')
    } catch (err: any) {
      setError(err.response?.data?.message || '修改失败')
    }
  }

  const handleSaveSudoPassword = async () => {
    setMessage('')
    setError('')
    try {
      await settingsApi.set('sudo_enabled', sudoEnabled ? 'true' : 'false')
      await settingsApi.set('sudo_password', sudoPassword)
      setMessage('部署设置已保存')
      setSudoSaved(!!sudoPassword)
    } catch (err: any) {
      setError(err.response?.data?.message || '保存部署设置失败')
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-slate-800">系统设置</h2>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-6">
        <h3 className="text-lg font-semibold text-slate-800 mb-4">修改密码</h3>

        {message && (
          <div className="mb-4 p-3 bg-green-50 text-green-600 rounded-lg text-sm">{message}</div>
        )}
        {error && (
          <div className="mb-4 p-3 bg-red-50 text-red-600 rounded-lg text-sm">{error}</div>
        )}

        <form onSubmit={handleChangePassword} className="space-y-4 max-w-md">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">旧密码</label>
            <input
              type="password"
              value={oldPassword}
              onChange={(e) => setOldPassword(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">新密码</label>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">确认新密码</label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500"
            />
          </div>
          <button
            type="submit"
            className="px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors"
          >
            修改密码
          </button>
        </form>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-6">
        <h3 className="text-lg font-semibold text-slate-800 mb-4">容器部署设置</h3>
        <div className="space-y-4 max-w-md">
          <div className="flex items-start gap-3 pt-1">
            <input
              id="sudo-enabled"
              type="checkbox"
              checked={sudoEnabled}
              onChange={(e) => setSudoEnabled(e.target.checked)}
              className="mt-0.5 h-4 w-4 text-amber-500 border-slate-300 rounded"
            />
            <label htmlFor="sudo-enabled" className="text-sm text-slate-700 cursor-pointer">
              使用 sudo 执行 docker 命令
            </label>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">sudo 密码</label>
            <input
              type="password"
              value={sudoPassword}
              onChange={(e) => setSudoPassword(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500 disabled:opacity-50"
              placeholder={sudoEnabled ? '输入当前系统用户的 sudo 密码' : '先勾选启用 sudo'}
              disabled={!sudoEnabled}
            />
            <p className="mt-1 text-xs text-slate-500">
              密码保存在本地数据库，不会打印到日志。
            </p>
          </div>
          <button
            onClick={handleSaveSudoPassword}
            className="px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors"
          >
            保存
          </button>
          {sudoSaved && <p className="text-xs text-green-600">已配置</p>}
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-6">
        <h3 className="text-lg font-semibold text-slate-800 mb-4">系统信息</h3>
        <div className="space-y-2 text-sm text-slate-600">
          <div className="flex justify-between max-w-md">
            <span>版本</span>
            <span className="font-mono text-slate-800">v1.0.0</span>
          </div>
          <div className="flex justify-between max-w-md">
            <span>数据目录</span>
            <span className="font-mono text-slate-800">/var/lib/linux-deploy-manager</span>
          </div>
          <div className="flex justify-between max-w-md">
            <span>日志目录</span>
            <span className="font-mono text-slate-800">/var/log/linux-deploy-manager</span>
          </div>
        </div>
      </div>
    </div>
  )
}
