import axios from 'axios'
import { getBackendPort, isElectron, navigateToLogin } from './electron'

const api = axios.create({
  baseURL: '/api/v1', // 默认 Web 模式，Electron 模式下会被动态覆盖
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
})

// Electron 模式下提前异步获取后端端口并更新 axios 默认 baseURL
let backendReady: Promise<void> | null = null
function ensureBackendReady(): Promise<void> {
  if (!isElectron()) return Promise.resolve()
  if (backendReady) return backendReady
  backendReady = getBackendPort().then((port) => {
    api.defaults.baseURL = `http://127.0.0.1:${port}/api/v1`
  })
  return backendReady
}

// 请求拦截器：添加 Token + Electron 端口就绪等待
api.interceptors.request.use(async (config) => {
  await ensureBackendReady()
  const token = localStorage.getItem('token')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

// 响应拦截器：统一错误处理
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('token')
      // HashRouter 模式下通过 hash 跳转，Web 模式下保持原有行为
      navigateToLogin()
    }
    return Promise.reject(error)
  }
)

export default api

// API 封装
export const authApi = {
  status: () => api.get('/auth/status'),
  setup: (password: string) => api.post('/auth/setup', { password }),
  login: (password: string) => api.post('/auth/login', { password }),
  changePassword: (oldPassword: string, newPassword: string) =>
    api.post('/auth/change-password', { old_password: oldPassword, new_password: newPassword }),
}

export const keyApi = {
  list: () => api.get('/keys'),
  create: (data: { name: string; algorithm?: string; key_type?: string }) => api.post('/keys', data),
  import: (data: { name: string; key_type: string; public_key: string; private_key: string; algorithm?: string }) => api.post('/keys/import', data),
  get: (id: number) => api.get(`/keys/${id}`),
  delete: (id: number) => api.delete(`/keys/${id}`),
  test: (id: number, gitHost: string) => api.post(`/keys/${id}/test`, { git_host: gitHost }),
}

export interface TemplateItem {
  template: any
  latest_task?: {
    id: number
    status: string
    branch: string
    commit_sha?: string
    created_at: string
  }
}

export const templateApi = {
  list: (params?: { page?: number; page_size?: number; status?: string }) =>
    api.get('/templates', { params }),
  create: (data: object) => api.post('/templates', data),
  get: (id: number) => api.get(`/templates/${id}`),
  update: (id: number, data: object) => api.put(`/templates/${id}`, data),
  patch: (id: number, data: object) => api.patch(`/templates/${id}`, data),
  delete: (id: number) => api.delete(`/templates/${id}`),
  clone: (id: number, data?: { name?: string }) => api.post(`/templates/${id}/clone`, data),
  branches: (id: number) => api.get(`/templates/${id}/branches`),
  deploy: (id: number, branch: string) => api.post(`/templates/${id}/deploy`, { branch }),
}

export const fsApi = {
  listDir: (path: string) => api.get('/fs/list', { params: { path } }),
  checkDir: (data: { code_dir: string; name: string; git_url: string }) =>
    api.post('/fs/check-dir', data),
}

export const envmanApi = {
  detect: () => api.get('/envman/detect'),
  listEnvs: (tool: string) => api.get('/envman/envs', { params: { tool } }),
  createEnv: (tool: string, env: string) => api.post('/envman/envs', { tool, env }),
}

export const taskApi = {
  list: (params?: { template_id?: number; status?: string; page?: number; page_size?: number }) =>
    api.get('/tasks', { params }),
  get: (id: number) => api.get(`/tasks/${id}`),
  log: (id: number) => api.get(`/tasks/${id}/log`),
  cancel: (id: number) => api.post(`/tasks/${id}/cancel`),
  download: (id: number) => api.get(`/tasks/${id}/download`, { responseType: 'blob' }),
}

export const serverNodeApi = {
  list: () => api.get('/server-nodes'),
  create: (data: object) => api.post('/server-nodes', data),
  get: (id: number) => api.get(`/server-nodes/${id}`),
  update: (id: number, data: object) => api.put(`/server-nodes/${id}`, data),
  delete: (id: number) => api.delete(`/server-nodes/${id}`),
  test: (id: number) => api.post(`/server-nodes/${id}/test`),
  distributeKey: (id: number, keyId: number) =>
    api.post(`/server-nodes/${id}/distribute-key`, { key_id: keyId }),
}

export const settingsApi = {
  get: (key: string) => api.get('/settings', { params: { key } }),
  set: (key: string, value: string) => api.post('/settings', { key, value }),
}

export const systemApi = {
  version: () => api.get('/version'),
}
