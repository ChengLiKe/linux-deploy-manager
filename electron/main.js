const { app, BrowserWindow, ipcMain, dialog, Menu, Tray, nativeImage, shell } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');

// electron-updater 在 setupAutoUpdater 中懒加载
let autoUpdater = null;

// 标记打包状态——在 app ready 后调用
function markPackaged() {
  if (!process.env.LDM_IS_PACKAGED) {
    process.env.LDM_IS_PACKAGED = app.isPackaged ? 'true' : 'false';
  }
}

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
let tray = null;
let goStderr = '';  // 捕获 Go 后端 stderr 用于诊断

// ── 自动更新事件 ────────────────────────────────────
function setupAutoUpdater() {
  markPackaged();

  // 懒加载 autoUpdater
  autoUpdater = require('electron-updater').autoUpdater;
  autoUpdater.logger = {
    info: (msg) => console.log(`[AutoUpdater] ${msg}`),
    warn: (msg) => console.warn(`[AutoUpdater] ${msg}`),
    error: (msg) => console.error(`[AutoUpdater] ${msg}`),
  };
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

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
    const text = data.toString();
    console.error(`[Go] ${text.trim()}`);
    goStderr += text;
    // 只保留最近 2KB
    if (goStderr.length > 2048) {
      goStderr = goStderr.slice(-2048);
    }
  });

  goProcess.on('exit', (code) => {
    console.log(`Go backend exited with code ${code}`);
    goProcess = null;
  });

  const port = await waitForPortFile(portFile).catch((err) => {
    // 超时时附带 Go stderr 以辅助诊断
    const stderrInfo = goStderr
      ? `\n\nGo 后端输出:\n${goStderr.slice(-1024)}`
      : '\n\n提示: Go 后端未产生任何输出，可能二进制文件无法运行';
    throw new Error(err.message + stderrInfo);
  });
  backendPort = port;
  console.log(`Go backend ready on port ${port}`);
  return port;
}

// ── 菜单栏 ─────────────────────────────────────────
function setupMenu() {
  const isMac = process.platform === 'darwin';

  if (isMac) {
    // macOS：保留最精简的菜单（应用名称 + 基本的 Cmd+C/V/Q 能工作）
    // 去掉 File/Edit/View/Window/Help 等杂项，只保留 app 子菜单
    const macTemplate = [
      {
        label: app.name,
        submenu: [
          { role: 'about' },
          { type: 'separator' },
          { role: 'hide', label: '隐藏' },
          { role: 'hideOthers', label: '隐藏其他' },
          { role: 'unhide', label: '显示全部' },
          { type: 'separator' },
          { role: 'quit', label: '退出' },
        ],
      },
      {
        label: 'Edit',
        submenu: [
          { role: 'undo', label: '撤销' },
          { role: 'redo', label: '重做' },
          { type: 'separator' },
          { role: 'cut', label: '剪切' },
          { role: 'copy', label: '复制' },
          { role: 'paste', label: '粘贴' },
          { role: 'selectAll', label: '全选' },
        ],
      },
      {
        label: 'View',
        submenu: [
          { role: 'reload', label: '重新加载' },
          { role: 'forceReload', label: '强制重新加载' },
          { role: 'toggleDevTools', label: '开发者工具' },
          { type: 'separator' },
          { role: 'resetZoom', label: '重置缩放' },
          { role: 'zoomIn', label: '放大' },
          { role: 'zoomOut', label: '缩小' },
          { type: 'separator' },
          { role: 'togglefullscreen', label: '全屏' },
        ],
      },
      {
        label: 'Window',
        submenu: [
          { role: 'minimize', label: '最小化' },
          { role: 'close', label: '关闭' },
        ],
      },
    ];
    const menu = Menu.buildFromTemplate(macTemplate);
    Menu.setApplicationMenu(menu);
  } else {
    // Windows / Linux：完全隐藏菜单栏
    // 用户仍可通过 Alt 键临时呼出默认菜单（Electron 内置行为）
    Menu.setApplicationMenu(null);
  }
}

// ── 系统托盘 ─────────────────────────────────────
function createTray() {
  const iconPath = path.join(__dirname, 'assets', 'icon.png');
  let trayIcon;
  try {
    trayIcon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
  } catch (e) {
    // 图标加载失败时使用空图标（不阻塞应用）
    return;
  }

  tray = new Tray(trayIcon);
  tray.setToolTip('Linux Deploy Manager');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: '打开主界面',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      },
    },
    { type: 'separator' },
    {
      label: '彻底退出',
      click: () => {
        app.isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);
  tray.on('double-click', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

function destroyTray() {
  if (tray) {
    tray.destroy();
    tray = null;
  }
}

// ── 获取关闭行为设置 ─────────────────────────────
function getCloseBehaviorSetting() {
  try {
    const userDataPath = app.getPath('userData');
    const dbPath = path.join(userDataPath, 'db.sqlite');
    if (!fs.existsSync(dbPath)) return 'quit';
    // 通过 Go 后端 API 读取，这里作为后备从进程启动参数获取
    return 'quit';
  } catch (e) {
    return 'quit';
  }
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

  // 拦截关闭事件
  mainWindow.on('close', (event) => {
    // 如果是通过 app.quit() 触发的（托盘"彻底退出"），则真正退出
    if (app.isQuitting) {
      return;
    }

    // 通过 IPC 读取关闭行为设置
    const closeBehavior = global.closeBehavior || 'quit';

    if (closeBehavior === 'minimize') {
      event.preventDefault();
      mainWindow.hide();
      createTray();
    }
    // closeBehavior === 'quit' 则直接关闭
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ── IPC 处理器 ────────────────────────────────────
ipcMain.handle('set-close-behavior', (_event, behavior) => {
  global.closeBehavior = behavior;
});

ipcMain.handle('get-close-behavior', () => {
  return global.closeBehavior || 'quit';
});

ipcMain.handle('show-main-window', () => {
  if (mainWindow) {
    mainWindow.show();
    mainWindow.focus();
  }
});

// 在系统默认浏览器中打开 URL
ipcMain.handle('open-external', (_event, url) => {
  if (typeof url === 'string' && url.startsWith('http')) {
    shell.openExternal(url);
  }
});

// ── 应用生命周期 ────────────────────────────────────
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
}

app.whenReady().then(async () => {
  try {
    setupMenu();
    const port = await startBackend();
    createWindow();
    setupAutoUpdater();
  } catch (err) {
    console.error('Failed to start application:', err);
    const userDataPath = app.getPath('userData');
    dialog.showErrorBox('启动失败',
      `应用启动失败\n\n${err.message}\n\n` +
      `请检查日志目录:\n${userDataPath}\\logs\n\n` +
      `或删除数据目录重新初始化:\n${userDataPath}`);
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
  // 有托盘时，窗口关闭不退出应用
  if (tray) {
    return;
  }
  if (goProcess) {
    goProcess.kill();
    goProcess = null;
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  app.isQuitting = true;
  destroyTray();
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

// 打开文件夹选择器
ipcMain.handle('select-directory', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory'],
    title: '选择项目文件夹',
  });
  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }
  return result.filePaths[0];
});

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
