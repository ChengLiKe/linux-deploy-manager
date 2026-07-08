export interface SSHKey {
  id: number
  name: string
  algorithm: string
  public_key: string
  source: 'managed' | 'system'
  key_type: 'git' | 'server'
  created_at: string
}

export interface ServerNode {
  id: number
  name: string
  host: string
  port: number
  user: string
  auth_type: 'key' | 'password'
  server_key_id?: number
  status: 'online' | 'offline' | 'unknown'
  last_check_at?: string
  description: string
  created_at: string
  updated_at: string
}

export interface Project {
  id: number
  name: string
  description: string
  git_url: string
  ssh_key_id: number
  server_node_id?: number
  server_node?: ServerNode
  code_dir: string
  deploy_dir: string
  env_format: string
  env_content: string
  deploy_mode: string
  pre_cmd: string
  deploy_cmd: string
  post_cmd: string
  timeout_sec: number
  status: string
  created_at: string
  updated_at: string
}

export interface DeployTask {
  id: number
  project_id: number
  branch: string
  commit_sha: string
  status: string
  started_at: string
  ended_at: string
  log_path: string
  triggered_by: string
  error_msg: string
  created_at: string
}

// API 请求类型
export interface CreateProjectRequest {
  name: string
  description?: string
  git_url: string
  ssh_key_id: number
  server_node_id?: number
  code_dir?: string
  deploy_dir?: string
  env_format?: 'dotenv' | 'json'
  env_content?: string
  deploy_mode?: 'local' | 'container'
  pre_cmd?: string
  deploy_cmd?: string
  post_cmd?: string
  timeout_sec?: number
}

export type UpdateProjectRequest = Partial<CreateProjectRequest>

// API 请求类型：服务器节点
export interface CreateServerNodeRequest {
  name: string
  host: string
  port?: number
  user?: string
  auth_type: 'key' | 'password'
  server_key_id?: number | null
  password?: string
  description?: string
}

export type UpdateServerNodeRequest = Partial<CreateServerNodeRequest>

export interface APIResponse<T> {
  code: number
  message: string
  data: T
}

/** Electron Preload 注入的 API 接口 */
export interface ElectronAPI {
  getBackendPort(): Promise<number>
  isDev: boolean
  // 自动更新
  checkForUpdate(): Promise<{ ok?: boolean; error?: string }>
  downloadUpdate(): Promise<{ ok?: boolean; error?: string }>
  installUpdate(): Promise<{ ok?: boolean; error?: string }>
  onUpdateEvent(callback: (event: UpdateEvent) => void): () => void
}

export interface UpdateEvent {
  type: 'checking' | 'available' | 'not-available' | 'download-progress' | 'downloaded' | 'error'
  version?: string
  releaseDate?: string
  releaseNotes?: string
  percent?: number
  bytesPerSecond?: number
  total?: number
  transferred?: number
  message?: string
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI
  }
}
