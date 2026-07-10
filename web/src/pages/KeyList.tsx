import { useEffect, useState, useRef } from 'react'
import { Plus, Trash2, TestTube, RefreshCw, HelpCircle, ChevronDown, ChevronUp, Copy, Check, Upload } from 'lucide-react'
import { keyApi } from '../utils/api'
import type { SSHKey } from '../types'
import Select from '../components/Select'

export default function KeyList() {
  const [keys, setKeys] = useState<SSHKey[]>([])
  const [loading, setLoading] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [newKeyName, setNewKeyName] = useState('')
  const [algorithm, setAlgorithm] = useState('ed25519')
  const [keyType, setKeyType] = useState<'git' | 'server'>('git')
  const [activeTab, setActiveTab] = useState<'git' | 'server'>('git')
  const [error, setError] = useState('')
  const [showHelp, setShowHelp] = useState(true)
  const [copiedId, setCopiedId] = useState<number | null>(null)
  // 生成/导入模式切换
  const [createMode, setCreateMode] = useState<'generate' | 'import'>('generate')
  // 导入模式字段
  const [importPrivateKey, setImportPrivateKey] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const fetchKeys = async () => {
    setLoading(true)
    setError('')
    try {
      const res = await keyApi.list()
      setKeys(res.data.data.keys || [])
    } catch (err: any) {
      setError(err.response?.data?.message || '获取密钥列表失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchKeys()
  }, [])

  const handleCreate = async () => {
    if (!newKeyName.trim()) return
    try {
      await keyApi.create({ name: newKeyName.trim(), algorithm, key_type: keyType })
      setShowCreate(false)
      setNewKeyName('')
      fetchKeys()
    } catch (err: any) {
      setError(err.response?.data?.message || '创建密钥失败')
    }
  }

  const handleImport = async () => {
    if (!newKeyName.trim() || !importPrivateKey.trim()) {
      setError('请填写名称和私钥（PEM 文件内容）')
      return
    }
    try {
      await keyApi.import({
        name: newKeyName.trim(),
        key_type: keyType,
        private_key: importPrivateKey.trim(),
        algorithm,
      })
      setShowCreate(false)
      setNewKeyName('')
      setImportPrivateKey('')
      fetchKeys()
    } catch (err: any) {
      setError(err.response?.data?.message || '导入密钥失败')
    }
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      setImportPrivateKey(ev.target?.result as string)
    }
    reader.readAsText(file)
  }

  const handleDelete = async (id: number) => {
    if (!confirm('确定要删除这个密钥吗？')) return
    try {
      await keyApi.delete(id)
      fetchKeys()
    } catch (err: any) {
      setError(err.response?.data?.message || '删除密钥失败')
    }
  }

  const handleCopy = async (key: SSHKey) => {
    try {
      await navigator.clipboard.writeText(key.public_key)
      setCopiedId(key.id)
      setTimeout(() => setCopiedId(null), 2000)
    } catch {
      setError('复制失败，请手动复制公钥')
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-slate-800">SSH 密钥</h2>
        <div className="flex gap-3">
          <button
            onClick={fetchKeys}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors disabled:opacity-50"
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
            刷新
          </button>
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors"
          >
            <Plus size={16} />
            生成密钥
          </button>
        </div>
      </div>

      <div className="flex border-b border-slate-200">
        <button
          onClick={() => setActiveTab('git')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'git'
              ? 'border-amber-500 text-amber-700'
              : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          Git 密钥（用于拉取代码）
        </button>
        <button
          onClick={() => setActiveTab('server')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'server'
              ? 'border-amber-500 text-amber-700'
              : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          服务器密钥（用于 SSH 连接）
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
          {error}
        </div>
      )}

      <div className="bg-amber-50 border border-amber-200 rounded-xl overflow-hidden">
        <button
          onClick={() => setShowHelp(!showHelp)}
          className="w-full flex items-center justify-between px-4 py-3 text-left"
        >
          <div className="flex items-center gap-2 text-amber-800 font-medium">
            <HelpCircle size={18} />
            <span>SSH 密钥使用说明</span>
          </div>
          {showHelp ? <ChevronUp size={18} className="text-amber-600" /> : <ChevronDown size={18} className="text-amber-600" />}
        </button>
        {showHelp && (
          <div className="px-4 pb-4 text-sm text-amber-900 space-y-3">
            {activeTab === 'git' ? (
              <>
                <p>
                  <span className="font-semibold">系统密钥：</span>
                  来自当前用户 <code className="bg-amber-100 px-1 py-0.5 rounded">~/.ssh/</code> 目录下已存在的密钥。
                  如果目标 Git 仓库（GitHub/GitLab/Gitee 等）已经信任这台机器，可直接选用。
                </p>
                <p>
                  <span className="font-semibold">生成新密钥：</span>
                  点击"生成密钥"创建。创建后需要把公钥添加到 Git 平台：
                </p>
                <ol className="list-decimal list-inside space-y-1 ml-1">
                  <li>复制公钥内容</li>
                  <li>进入 Git 平台的 Settings → SSH and GPG keys → New SSH key</li>
                  <li>粘贴公钥并保存</li>
                </ol>
                <p>
                  <span className="font-semibold">导入已有密钥：</span>
                  如果你已有一对密钥文件，可以粘贴私钥内容导入，公钥会自动从私钥中提取。
                </p>
                <p className="text-xs text-amber-700">
                  部署时在模板中选择 Git 密钥，拉取代码时会通过 <code className="bg-amber-100 px-1 py-0.5 rounded">GIT_SSH_COMMAND</code> 自动使用。
                </p>
              </>
            ) : (
              <>
                <p>
                  <span className="font-semibold">服务器密钥</span>用于通过 SSH 连接到远程服务器节点（如目标部署服务器），
                  是添加「服务器节点」时的认证凭证。
                </p>
                <p>
                  <span className="font-semibold">生成新密钥：</span>
                  点击"生成密钥"创建一对新密钥。创建后需要将公钥添加到远程服务器：
                </p>
                <ol className="list-decimal list-inside space-y-1 ml-1">
                  <li>复制公钥内容</li>
                  <li>登录到远程服务器，执行：<code className="bg-amber-100 px-1 py-0.5 rounded">echo '公钥内容' &gt;&gt; ~/.ssh/authorized_keys</code></li>
                  <li>确保 <code className="bg-amber-100 px-1 py-0.5 rounded">~/.ssh/</code> 权限为 700，<code className="bg-amber-100 px-1 py-0.5 rounded">authorized_keys</code> 权限为 600</li>
                </ol>
                <p>
                  <span className="font-semibold">导入已有密钥：</span>
                  上传或粘贴 PEM 格式的私钥文件（如云服务器下发的 <code className="bg-amber-100 px-1 py-0.5 rounded">.pem</code> 文件），系统会自动提取对应的公钥。
                </p>
                <p className="text-xs text-amber-700">
                  添加「服务器节点」时，选择认证方式为"SSH 密钥"，然后从下拉列表中选择此密钥。
                </p>
              </>
            )}
          </div>
        )}
      </div>

      {showCreate && (
        <div className="bg-white rounded-xl border border-slate-200 p-6">
          <h3 className="text-lg font-semibold text-slate-800 mb-4">
            {createMode === 'generate' ? '生成新密钥' : '导入密钥'}
          </h3>

          {/* 生成/导入模式切换 */}
          <div className="flex gap-2 mb-4 p-1 bg-slate-100 rounded-lg">
            <button
              onClick={() => setCreateMode('generate')}
              className={`flex-1 px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                createMode === 'generate'
                  ? 'bg-white text-slate-800 shadow-sm'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              生成密钥
            </button>
            <button
              onClick={() => setCreateMode('import')}
              className={`flex-1 px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                createMode === 'import'
                  ? 'bg-white text-slate-800 shadow-sm'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              导入已有密钥
            </button>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">密钥名称</label>
              <input
                type="text"
                value={newKeyName}
                onChange={(e) => setNewKeyName(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500"
                placeholder={createMode === 'generate' ? '如：github-key' : '如：my-server-key'}
              />
            </div>

            {createMode === 'generate' && (
              <Select
                label="算法"
                value={algorithm}
                onChange={(val) => setAlgorithm(val)}
              >
                <option value="ed25519">Ed25519（推荐）</option>
                <option value="rsa">RSA 4096</option>
              </Select>
            )}

            {createMode === 'import' && (
              <>
                <Select
                  label="算法（选填）"
                  value={algorithm}
                  onChange={(val) => setAlgorithm(val)}
                >
                  <option value="ed25519">Ed25519</option>
                  <option value="rsa">RSA</option>
                  <option value="ecdsa">ECDSA</option>
                  <option value="dsa">DSA</option>
                </Select>
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-sm font-medium text-slate-700">私钥文件（PEM）</label>
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className="flex items-center gap-1 text-xs text-amber-600 hover:text-amber-700"
                    >
                      <Upload size={14} />
                      选择文件
                    </button>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".pem,.key,.ppk,*"
                      onChange={handleFileSelect}
                      className="hidden"
                    />
                  </div>
                  <textarea
                    value={importPrivateKey}
                    onChange={(e) => setImportPrivateKey(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500 font-mono text-xs"
                    rows={6}
                    placeholder="-----BEGIN OPENSSH PRIVATE KEY-----
&#10;将私钥内容粘贴至此...
&#10;-----END OPENSSH PRIVATE KEY-----"
                  />
                </div>
              </>
            )}

            <Select
              label="密钥用途"
              value={keyType}
              onChange={(val) => setKeyType(val as 'git' | 'server')}
            >
              <option value="git">Git 拉取代码</option>
              <option value="server">连接服务器</option>
            </Select>

            <div className="flex gap-3">
              {createMode === 'generate' ? (
                <button onClick={handleCreate} className="px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700">生成</button>
              ) : (
                <button onClick={handleImport} className="px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700">导入</button>
              )}
              <button onClick={() => { setShowCreate(false); setCreateMode('generate'); setImportPrivateKey(''); }} className="px-4 py-2 text-slate-600 hover:bg-slate-50 rounded-lg">取消</button>
            </div>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="text-left px-4 py-3 text-sm font-medium text-slate-600">名称</th>
              <th className="text-left px-4 py-3 text-sm font-medium text-slate-600">来源</th>
              <th className="text-left px-4 py-3 text-sm font-medium text-slate-600">算法</th>
              <th className="text-right px-4 py-3 text-sm font-medium text-slate-600">操作</th>
            </tr>
          </thead>
          <tbody>
            {keys.filter((k) => k.key_type === activeTab).length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-slate-400">
                  暂无{activeTab === 'git' ? 'Git' : '服务器'}密钥，点击"生成密钥"创建第一个密钥
                </td>
              </tr>
            ) : (
              keys
                .filter((k) => k.key_type === activeTab)
                .map((key) => (
                  <tr key={key.id} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="px-4 py-3 text-sm text-slate-800">{key.name}</td>
                    <td className="px-4 py-3 text-sm">
                      {key.source === 'system' ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-50 text-blue-700">
                          系统
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-600">
                          应用生成
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-600">{key.algorithm}</td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => handleCopy(key)}
                        className={`p-1.5 mr-1 transition-colors ${
                          copiedId === key.id ? 'text-green-600' : 'text-slate-400 hover:text-green-600'
                        }`}
                        title={copiedId === key.id ? '已复制' : '复制公钥'}
                      >
                        {copiedId === key.id ? <Check size={16} /> : <Copy size={16} />}
                      </button>
                      <button className="p-1.5 text-slate-400 hover:text-blue-600 mr-1" title="测试连通性">
                        <TestTube size={16} />
                      </button>
                      {key.source !== 'system' && (
                        <button onClick={() => handleDelete(key.id)} className="p-1.5 text-slate-400 hover:text-red-600" title="删除">
                          <Trash2 size={16} />
                        </button>
                      )}
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
