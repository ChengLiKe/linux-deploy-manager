const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');
const { autoUpdater } = require('electron-updater');

// ── 自动更新配置 ────────────────────────────────────
autoUpdater.logger = {
  info: (msg) => console.log(`[AutoUpdater] ${msg}`),
  warn: (msg) => console.warn(`[AutoUpdater] ${msg}`),
  error: (msg) => console.error(`[AutoUpdater] ${msg}`),
};
// 开发模式不检查更新（除非强制）
autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = true;

// 标记打包状态，供 preload 读取
process.env.LDM_IS_PACKAGED = app.isPackaged ? 'true' : 'false';

// 获取 Go 后端二进制路径
function getServerBinaryPath() {
  if (!app.isPackaged) {
    const ext = process.platform === 'win32' ? '.exe' : '';
    return path.join(__dirname, '..', 'bin', `linux-deploy-manager${ext}`);
  }
  const ext = process.platform === 'win32' ? '.exe' : '';
  return path.join(process.resourcesPath, 'bin', `linux-deploy-manager${ext}`);
}

function waitForPortFile(portFile, timeout = 30000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      if (fs.existsSync(portFile)) {
        const content = fs.readFileSync(portFile, 'utf-8').trim();
        const port = parseInt(content, 10);
        if (!isNaN(port) && port > 0) {
          resolve(port);
          return;
        }
      }
      if (Date.now() - start > timeout) {
        reject(new Error(`Timeout waiting for port file: ${portFile}`));
        return;
      }
      setTimeout(check, 200);
    };
    check();
  });
}

let goProcess = null;
let backendPort = null;
let mainWindow = null;

// ── 自动更新事件 ────────────────────────────────────
function setupAutoUpdater() {
  if (!app.isPackaged) {
    console.log('[AutoUpdater] 开发模式，跳过自动更新');
    return;
  }

  // 检查更新
  autoUpdater.on('checking-for-update', () => {
    console.log('[AutoUpdater] 正在检查更新...');
    mainWindow?.webContents.send('update-checking');
  });

  // 发现更新
  autoUpdater.on('update-available', (info) => {
    console.log(`[AutoUpdater] 发现新版本: ${info.version}`);
    mainWindow?.webContents.send('update-available', {
      version: info.version,
      releaseDate: info.releaseDate,
      releaseNotes: info.releaseNotes,
    });
  });

  // 没有更新
  autoUpdater.on('update-not-available', (info) => {
    console.log(`[AutoUpdater] 当前已是最新版本: ${info.version}`);
    mainWindow?.webContents.send('update-not-available');
  });

  // 更新下载进度
  autoUpdater.on('download-progress', (progress) => {
    mainWindow?.webContents.send('update-download-progress', {
      percent: progress.percent,
      bytesPerSecond: progress.bytesPerSecond,
      total: progress.total,
      transferred: progress.transferred,
    });
  });

  // 更新下载完成
  autoUpdater.on('update-downloaded', () => {
    console.log('[AutoUpdater] 更新下载完成');
    mainWindow?.webContents.send('update-downloaded');
  });

  // 更新出错
  autoUpdater.on('error', (err) => {
    console.error('[AutoUpdater] 更新出错:', err.message);
    mainWindow?.webContents.send('update-error', { message: err.message });
  });

  // 启动后延迟 5 秒检查，避免启动时因后端初始化过载
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch((err) => {
      console.warn('[AutoUpdater] 检查更新失败:', err.message);
    });
  }, 5000);
}

// ── 启动 Go 后端 ──────────────────────────────────
async function startBackend() {
  const dataDir = app.getPath('userData');
  const logDir = path.join(dataDir, 'logs');
  const portFile = path.join(dataDir, '.ldm-port');

  try {
    if (fs.existsSync(portFile)) {
      fs.unlinkSync(portFile);
    }
  } catch (err) {
    console.warn('Failed to clean old port file:', err);
  }

  const binaryPath = getServerBinaryPath();

  if (!fs.existsSync(binaryPath)) {
    const msg = `Go 后端二进制未找到: ${binaryPath}\n请先运行: make build`;
    dialog.showErrorBox('启动失败', msg);
    throw new Error(msg);
  }

  const env = {
    ...process.env,
    LDM_DATA_DIR: dataDir,
    LDM_LOG_DIR: logDir,
    LDM_PORT_FILE: portFile,
  };

  goProcess = spawn(binaryPath, ['-bind', '127.0.0.1', '-port', '0'], {
    env,
    detached: false,
    windowsHide: process.platform === 'win32',
  });

  goProcess.on('error', (err) => {
    console.error('Go backend failed to start:', err);
    dialog.showErrorBox('后端启动失败', err.message);
  });

  goProcess.stdout?.on('data', (data) => {
    console.log(`[Go] ${data.toString().trim()}`);
  });

  goProcess.stderr?.on('data', (data) => {
    console.error(`[Go] ${data.toString().trim()}`);
  });

  goProcess.on('exit', (code) => {
    console.log(`Go backend exited with code ${code}`);
    goProcess = null;
  });

  const port = await waitForPortFile(portFile);
  backendPort = port;
  console.log(`Go backend ready on port ${port}`);
  return port;
}

// ── 创建窗口 ──────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    title: 'Linux Deploy Manager',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (!app.isPackaged) {
    mainWindow.loadURL('http://localhost:3000');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadURL(`http://127.0.0.1:${backendPort}`);
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ── 应用生命周期 ────────────────────────────────────
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
}

app.whenReady().then(async () => {
  try {
    const port = await startBackend();
    createWindow();
    setupAutoUpdater();
  } catch (err) {
    console.error('Failed to start application:', err);
    app.exit(1);
  }
});

app.on('second-instance', () => {
  const win = BrowserWindow.getAllWindows()[0];
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

app.on('window-all-closed', () => {
  if (goProcess) {
    goProcess.kill();
    goProcess = null;
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  if (goProcess) {
    goProcess.kill();
    goProcess = null;
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// ── IPC 处理 ────────────────────────────────────────
ipcMain.handle('get-backend-port', () => backendPort);

// 手动检查更新
ipcMain.handle('check-for-update', async () => {
  if (!app.isPackaged) return { error: '开发模式不支持自动更新' };
  try {
    await autoUpdater.checkForUpdates();
    return { ok: true };
  } catch (err) {
    return { error: err.message };
  }
});

// 开始下载更新
ipcMain.handle('download-update', async () => {
  try {
    autoUpdater.downloadUpdate();
    return { ok: true };
  } catch (err) {
    return { error: err.message };
  }
});

// 立即安装更新
ipcMain.handle('install-update', () => {
  setImmediate(() => {
    autoUpdater.quitAndInstall(false, true);
  });
  return { ok: true };
});
