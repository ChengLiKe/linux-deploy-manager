import { useState, useEffect } from 'react'
import { serverNodeApi, keyApi } from '@/utils/api'
import type { ServerNode } from '@/types'
import { Plus, Server, Trash2, RefreshCw, Edit3, Key, X } from 'lucide-react'

interface ServerKey {
  id: number
  name: string
}

export default function ServerNodeList() {
  const [nodes, setNodes] = useState<ServerNode[]>([])
  const [loading, setLoading] = useState(false)
  const [testingId, setTestingId] = useState<number | null>(null)
  const [showModal, setShowModal] = useState(false)
  const [editingNode, setEditingNode] = useState<ServerNode | null>(null)
  const [serverKeys, setServerKeys] = useState<ServerKey[]>([])
  const [distributingId, setDistributingId] = useState<number | null>(null)
  const [distributeKeyId, setDistributeKeyId] = useState<number>(0)
  const [showDistribute, setShowDistribute] = useState<number | null>(null)
  const [gitKeys, setGitKeys] = useState<ServerKey[]>([])

  const [form, setForm] = useState({
    name: '',
    host: '',
    port: 22,
    user: 'root',
    auth_type: 'key' as 'key' | 'password',
    server_key_id: 0,
    password: '',
    description: '',
  })

  const fetchNodes = async () => {
    setLoading(true)
    try {
      const res = await serverNodeApi.list()
      setNodes(res.data.data || [])
    } catch (err) {
      console.error('获取服务器节点失败', err)
    } finally {
      setLoading(false)
    }
  }

  const fetchKeys = async () => {
    try {
      const res = await keyApi.list()
      const keys = res.data.data?.keys || []
      setServerKeys(keys.filter((k: any) => k.key_type === 'server').map((k: any) => ({ id: k.id, name: k.name })))
      setGitKeys(keys.filter((k: any) => k.key_type === 'git').map((k: any) => ({ id: k.id, name: k.name })))
    } catch {
      setServerKeys([])
      setGitKeys([])
    }
  }

  useEffect(() => {
    fetchNodes()
    fetchKeys()
  }, [])

  const openCreate = () => {
    setEditingNode(null)
    setForm({
      name: '',
      host: '',
      port: 22,
      user: 'root',
      auth_type: 'key',
      server_key_id: 0,
      password: '',
      description: '',
    })
    setShowModal(true)
  }

  const openEdit = (node: ServerNode) => {
    setEditingNode(node)
    setForm({
      name: node.name,
      host: node.host,
      port: node.port || 22,
      user: node.user || 'root',
      auth_type: node.auth_type,
      server_key_id: node.server_key_id || 0,
      password: '',
      description: node.description || '',
    })
    setShowModal(true)
  }

  const handleSave = async () => {
    try {
      const payload = {
        name: form.name,
        host: form.host,
        port: form.port,
        user: form.user,
        auth_type: form.auth_type,
        server_key_id: form.auth_type === 'key' ? form.server_key_id || null : null,
        password: form.auth_type === 'password' ? form.password : undefined,
        description: form.description,
      }
      if (editingNode) {
        await serverNodeApi.update(editingNode.id, payload)
      } else {
        await serverNodeApi.create(payload)
      }
      setShowModal(false)
      fetchNodes()
    } catch (err: any) {
      alert(err.response?.data?.message || '保存失败')
    }
  }

  const handleTest = async (id: number) => {
    setTestingId(id)
    try {
      const res = await serverNodeApi.test(id)
      const updated = res.data.data?.node
      if (updated) {
        setNodes((prev) => prev.map((n) => (n.id === id ? updated : n)))
      }
    } catch (err) {
      console.error('测试连接失败', err)
    } finally {
      setTestingId(null)
    }
  }

  const handleDelete = async (id: number) => {
    if (!confirm('确定删除该服务器节点？')) return
    try {
      await serverNodeApi.delete(id)
      setNodes((prev) => prev.filter((n) => n.id !== id))
    } catch (err: any) {
      alert('删除失败: ' + (err as any)?.response?.data?.message)
    }
  }

  const handleDistribute = async (nodeId: number) => {
    if (!distributeKeyId) {
      alert('请先选择一个 Git 密钥')
      return
    }
    setDistributingId(nodeId)
    try {
      await serverNodeApi.distributeKey(nodeId, distributeKeyId)
      alert('密钥下发成功')
      setShowDistribute(null)
      setDistributeKeyId(0)
    } catch (err: any) {
      alert('下发失败: ' + (err?.response?.data?.message || err.message))
    } finally {
      setDistributingId(null)
    }
  }

  const statusDot = (status: string) => {
    const color =
      status === 'online'
        ? 'bg-green-500'
        : status === 'offline'
          ? 'bg-red-500'
          : 'bg-slate-300'
    return <span className={`inline-block w-2 h-2 rounded-full ${color}`} />
  }

  const inputCls = 'w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500'
  const labelCls = 'block text-sm font-medium text-slate-700 mb-1'

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold text-slate-800">服务器节点</h1>
        <button
          onClick={openCreate}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-600 text-white rounded-lg text-sm hover:bg-amber-700 transition-colors"
        >
          <Plus size={16} />
          添加节点
        </button>
      </div>

      {loading && nodes.length === 0 ? (
        <div className="text-center text-slate-400 py-12">加载中...</div>
      ) : nodes.length === 0 ? (
        <div className="text-center py-12">
          <Server className="mx-auto mb-3 text-slate-300" size={48} />
          <p className="text-slate-500">暂无服务器节点</p>
          <p className="text-slate-400 text-sm mt-1">点击右上角添加第一台服务器</p>
        </div>
      ) : (
        <div className="space-y-3">
          {nodes.map((node) => (
            <div
              key={node.id}
              className="bg-white border border-slate-200 rounded-lg p-4 hover:shadow-sm transition-shadow"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Server className="text-slate-400" size={20} />
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-slate-800">{node.name}</span>
                      {statusDot(node.status)}
                      <span className="text-xs text-slate-500">
                        {node.status === 'online' ? '在线' : node.status === 'offline' ? '离线' : '未知'}
                      </span>
                    </div>
                    <div className="text-sm text-slate-500 mt-0.5">
                      {node.user}@{node.host}:{node.port}
                    </div>
                    {node.description && (
                      <div className="text-xs text-slate-400 mt-1">{node.description}</div>
                    )}
                    {node.last_check_at && (
                      <div className="text-xs text-slate-400">
                        最后检查: {new Date(node.last_check_at).toLocaleString()}
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleTest(node.id)}
                    disabled={testingId === node.id}
                    className="flex items-center gap-1 px-2.5 py-1.5 text-sm rounded-lg border border-slate-200 hover:bg-slate-50 transition-colors disabled:opacity-50"
                    title="测试连接"
                  >
                    <RefreshCw size={14} className={testingId === node.id ? 'animate-spin' : ''} />
                    测试
                  </button>
                  <button
                    onClick={() => { setShowDistribute(node.id); setDistributeKeyId(0) }}
                    className="flex items-center gap-1 px-2.5 py-1.5 text-sm rounded-lg border border-slate-200 hover:bg-slate-50 transition-colors"
                    title="下发密钥"
                  >
                    <Key size={14} />
                    密钥
                  </button>
                  <button
                    onClick={() => openEdit(node)}
                    className="flex items-center gap-1 px-2.5 py-1.5 text-sm rounded-lg border border-slate-200 hover:bg-slate-50 transition-colors"
                    title="编辑"
                  >
                    <Edit3 size={14} />
                  </button>
                  <button
                    onClick={() => handleDelete(node.id)}
                    className="flex items-center gap-1 px-2.5 py-1.5 text-sm rounded-lg border border-red-200 text-red-600 hover:bg-red-50 transition-colors"
                    title="删除"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>

              {showDistribute === node.id && (
                <div className="mt-3 p-3 bg-slate-50 rounded-lg border border-slate-200">
                  <div className="flex items-center gap-3">
                    <select
                      value={distributeKeyId}
                      onChange={(e) => setDistributeKeyId(Number(e.target.value))}
                      className={`${inputCls} flex-1`}
                    >
                      <option value={0}>选择要下发的 Git 密钥</option>
                      {gitKeys.map((k) => (
                        <option key={k.id} value={k.id}>{k.name}</option>
                      ))}
                    </select>
                    <button
                      onClick={() => handleDistribute(node.id)}
                      disabled={distributingId === node.id}
                      className="px-3 py-2 text-sm bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:opacity-50"
                    >
                      {distributingId === node.id ? '下发中...' : '下发'}
                    </button>
                    <button
                      onClick={() => setShowDistribute(null)}
                      className="p-2 text-slate-400 hover:text-slate-600"
                    >
                      <X size={16} />
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg mx-4 p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-slate-800">
                {editingNode ? '编辑服务器节点' : '添加服务器节点'}
              </h2>
              <button onClick={() => setShowModal(false)} className="p-1 text-slate-400 hover:text-slate-600">
                <X size={18} />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className={labelCls}>名称</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className={inputCls}
                  placeholder="如：生产服务器"
                />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2">
                  <label className={labelCls}>主机地址</label>
                  <input
                    type="text"
                    value={form.host}
                    onChange={(e) => setForm({ ...form, host: e.target.value })}
                    className={inputCls}
                    placeholder="192.168.1.100"
                  />
                </div>
                <div>
                  <label className={labelCls}>端口</label>
                  <input
                    type="number"
                    value={form.port}
                    onChange={(e) => setForm({ ...form, port: Number(e.target.value) })}
                    className={inputCls}
                  />
                </div>
              </div>
              <div>
                <label className={labelCls}>用户名</label>
                <input
                  type="text"
                  value={form.user}
                  onChange={(e) => setForm({ ...form, user: e.target.value })}
                  className={inputCls}
                  placeholder="root"
                />
              </div>
              <div>
                <label className={labelCls}>认证方式</label>
                <div className="flex gap-3">
                  <button
                    onClick={() => setForm({ ...form, auth_type: 'key', password: '' })}
                    className={`flex-1 p-2.5 text-sm border rounded-md text-left transition-colors ${
                      form.auth_type === 'key' ? 'border-amber-500 bg-amber-50' : 'border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    <div className="font-medium text-slate-800">SSH 密钥</div>
                    <div className="text-xs text-slate-500">使用服务器密钥认证</div>
                  </button>
                  <button
                    onClick={() => setForm({ ...form, auth_type: 'password', server_key_id: 0 })}
                    className={`flex-1 p-2.5 text-sm border rounded-md text-left transition-colors ${
                      form.auth_type === 'password' ? 'border-amber-500 bg-amber-50' : 'border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    <div className="font-medium text-slate-800">密码</div>
                    <div className="text-xs text-slate-500">使用用户名密码认证</div>
                  </button>
                </div>
              </div>
              {form.auth_type === 'key' ? (
                <div>
                  <label className={labelCls}>服务器密钥</label>
                  <select
                    value={form.server_key_id}
                    onChange={(e) => setForm({ ...form, server_key_id: Number(e.target.value) })}
                    className={inputCls}
                  >
                    <option value={0}>请选择密钥</option>
                    {serverKeys.map((k) => (
                      <option key={k.id} value={k.id}>{k.name}</option>
                    ))}
                  </select>
                  {serverKeys.length === 0 && (
                    <div className="text-xs text-amber-600 mt-1">
                      暂无服务器密钥，请先到
                      <a href="/keys" className="underline hover:text-amber-700">密钥管理</a>
                      页面生成
                    </div>
                  )}
                </div>
              ) : (
                <div>
                  <label className={labelCls}>密码</label>
                  <input
                    type="password"
                    value={form.password}
                    onChange={(e) => setForm({ ...form, password: e.target.value })}
                    className={inputCls}
                    placeholder="SSH 登录密码"
                  />
                </div>
              )}
              <div>
                <label className={labelCls}>描述</label>
                <input
                  type="text"
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  className={inputCls}
                  placeholder="简要描述"
                />
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <button
                onClick={() => setShowModal(false)}
                className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 rounded-lg border border-slate-200"
              >
                取消
              </button>
              <button
                onClick={handleSave}
                className="px-4 py-2 text-sm bg-amber-600 text-white rounded-lg hover:bg-amber-700"
              >
                {editingNode ? '保存' : '添加'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
