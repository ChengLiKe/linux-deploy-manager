const { contextBridge, ipcRenderer } = require('electron');

/**
 * Electron 预加载脚本
 * 通过 contextBridge 将安全 API 暴露到渲染进程的 window.electronAPI
 */
contextBridge.exposeInMainWorld('electronAPI', {
  /** 获取 Go 后端实际监听的端口 */
  getBackendPort: () => ipcRenderer.invoke('get-backend-port'),

  /** 是否为开发模式 */
  isDev: process.env.LDM_IS_PACKAGED !== 'true',

  // ── 自动更新 API ────────────────────────────────
  /** 手动检查更新 */
  checkForUpdate: () => ipcRenderer.invoke('check-for-update'),

  /** 开始下载更新 */
  downloadUpdate: () => ipcRenderer.invoke('download-update'),

  /** 立即安装更新 */
  installUpdate: () => ipcRenderer.invoke('install-update'),

  /** 监听更新事件 */
  onUpdateEvent: (callback) => {
    const handlers = {
      'update-checking': () => callback({ type: 'checking' }),
      'update-available': (_event, info) => callback({ type: 'available', ...info }),
      'update-not-available': () => callback({ type: 'not-available' }),
      'update-download-progress': (_event, progress) => callback({ type: 'download-progress', ...progress }),
      'update-downloaded': () => callback({ type: 'downloaded' }),
      'update-error': (_event, err) => callback({ type: 'error', ...err }),
    };

    Object.entries(handlers).forEach(([channel, handler]) => {
      ipcRenderer.on(channel, handler);
    });

    // 返回清理函数
    return () => {
      Object.keys(handlers).forEach((channel) => {
        ipcRenderer.removeAllListeners(channel);
      });
    };
  },
});
