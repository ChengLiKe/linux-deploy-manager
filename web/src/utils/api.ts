import axios from 'axios'
import { getBackendPort, isElectron, navigateToLogin } from './electron'
import type { CreateProjectRequest, UpdateProjectRequest, Project, CreateServerNodeRequest, UpdateServerNodeRequest } from '@/types'

const api = axios.create({
  baseURL: '/api/v1',
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
})

// Electron 模式下启动时执行一次端口检测
if (isElectron()) {
  getBackendPort().then((port) => {
    api.defaults.baseURL = `http://127.0.0.1:${port}/api/v1`
  })
}

// 请求拦截器：添加 Token
api.interceptors.request.use(async (config) => {
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
      navigateToLogin()
    } else if (error.code === 'ERR_NETWORK' || error.code === 'ECONNABORTED') {
      // TODO: 可集成 toast 组件展示网络错误
      console.warn('[网络错误]', error.message)
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
  import: (data: { name: string; key_type: string; private_key: string; public_key?: string; algorithm?: string }) => api.post('/keys/import', data),
  get: (id: number) => api.get(`/keys/${id}`),
  delete: (id: number) => api.delete(`/keys/${id}`),
  test: (id: number, gitHost: string) => api.post(`/keys/${id}/test`, { git_host: gitHost }),
}

export interface ProjectItem {
  project: Project
  latest_task?: {
    id: number
    status: string
    branch: string
    commit_sha?: string
    created_at: string
  }
}

export const projectApi = {
  list: (params?: { page?: number; page_size?: number; status?: string }) =>
    api.get('/projects', { params }),
  create: (data: CreateProjectRequest) => api.post('/projects', data),
  get: (id: number) => api.get(`/projects/${id}`),
  update: (id: number, data: UpdateProjectRequest) => api.put(`/projects/${id}`, data),
  patch: (id: number, data: Partial<UpdateProjectRequest>) => api.patch(`/projects/${id}`, data),
  delete: (id: number) => api.delete(`/projects/${id}`),
  clone: (id: number, data?: { name?: string }) => api.post(`/projects/${id}/clone`, data),
  branches: (id: number) => api.get(`/projects/${id}/branches`),
  deploy: (id: number, branch: string) => api.post(`/projects/${id}/deploy`, { branch }),
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
  list: (params?: { project_id?: number; status?: string; page?: number; page_size?: number }) =>
    api.get('/tasks', { params }),
  get: (id: number) => api.get(`/tasks/${id}`),
  log: (id: number) => api.get(`/tasks/${id}/log`),
  cancel: (id: number) => api.post(`/tasks/${id}/cancel`),
  download: (id: number) => api.get(`/tasks/${id}/download`, { responseType: 'blob' }),
}

export const serverNodeApi = {
  list: () => api.get('/server-nodes'),
  create: (data: CreateServerNodeRequest) => api.post('/server-nodes', data),
  get: (id: number) => api.get(`/server-nodes/${id}`),
  update: (id: number, data: UpdateServerNodeRequest) => api.put(`/server-nodes/${id}`, data),
  delete: (id: number) => api.delete(`/server-nodes/${id}`),
  test: (id: number) => api.post(`/server-nodes/${id}/test`),
  diagnose: (id: number) => api.post(`/server-nodes/${id}/diagnose`),
  init: (id: number) => api.post(`/server-nodes/${id}/init`),
  initLog: (id: number) => api.get(`/server-nodes/${id}/init-log`),
  distributeKey: (id: number, keyId: number) =>
    api.post(`/server-nodes/${id}/distribute-key`, { key_id: keyId }),
  listDir: (id: number, path: string) =>
    api.post(`/server-nodes/${id}/list-dir`, { path }),
}

export const fixApi = {
  autoFix: (nodeId: number, fixType: string) =>
    api.post('/auto-fix', { node_id: nodeId, fix_type: fixType }),
}

export const settingsApi = {
  get: (key: string) => api.get('/settings', { params: { key } }),
  set: (key: string, value: string) => api.post('/settings', { key, value }),
}

export const systemApi = {
  version: () => api.get('/version'),
}

export const terminalApi = {
  list: () => api.get('/terminal/sessions'),
  disconnect: (sessionId: string) => api.delete(`/terminal/sessions/${sessionId}`),
}

export const urlApi = {
  list: (nodeId: number) => api.get(`/server-nodes/${nodeId}/urls`),
  create: (data: Record<string, unknown>) => api.post('/server-urls', data),
  update: (id: number, data: Record<string, unknown>) => api.put(`/server-urls/${id}`, data),
  delete: (id: number) => api.delete(`/server-urls/${id}`),
}
