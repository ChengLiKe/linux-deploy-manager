#!/usr/bin/env node

/**
 * Electron 打包构建脚本
 *
 * 完整构建流程：
 * 1. 解析目标平台参数（--win / --mac / --linux），默认当前平台
 * 2. 安装并构建前端（web/dist）
 * 3. 拷贝前端资源到 cmd/server/web/dist（Go embed 使用）
 * 4. 为每个目标平台/架构交叉编译 Go 后端
 * 5. 准备图标资源（Linux 多分辨率目录）
 * 6. 调用 electron-builder 生成安装包
 *
 * 使用：
 *   node scripts/electron-build.js          # 打包当前平台
 *   node scripts/electron-build.js --win    # 打包 Windows
 *   node scripts/electron-build.js --mac    # 打包 macOS
 *   node scripts/electron-build.js --linux  # 打包 Linux
 *   node scripts/electron-build.js --win --mac --linux  # 全平台
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const WEB_DIR = path.join(PROJECT_ROOT, 'web');
const EMBED_DIR = path.join(PROJECT_ROOT, 'cmd', 'server', 'web', 'dist');
const BIN_DIR = path.join(PROJECT_ROOT, 'bin');
const ICON_SRC = path.join(PROJECT_ROOT, 'electron', 'assets', 'icon.png');
const ICONS_DIR = path.join(PROJECT_ROOT, 'electron', 'assets', 'icons');

// 目标平台/架构矩阵
const TARGET_MATRIX = {
  win: [{ os: 'windows', arch: 'amd64', binaryName: 'linux-deploy-manager.exe' }],
  mac: [
    { os: 'darwin', arch: 'amd64', binaryName: 'linux-deploy-manager' },
    { os: 'darwin', arch: 'arm64', binaryName: 'linux-deploy-manager' },
  ],
  linux: [{ os: 'linux', arch: 'amd64', binaryName: 'linux-deploy-manager' }],
};

const platformArgMap = {
  '--win': 'win',
  '--windows': 'win',
  '--mac': 'mac',
  '--macos': 'mac',
  '--linux': 'linux',
};

function log(...args) {
  console.log(`[builder]`, ...args);
}

function error(...args) {
  console.error(`[builder]`, ...args);
}

function run(cmd, args, options = {}) {
  return new Promise((resolve, reject) => {
    log(`> ${cmd} ${args.join(' ')}`);
    const child = spawn(cmd, args, {
      cwd: PROJECT_ROOT,
      stdio: 'inherit',
      shell: process.platform === 'win32',
      ...options,
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`Command failed with exit code ${code}: ${cmd} ${args.join(' ')}`));
      } else {
        resolve();
      }
    });
  });
}

function exists(p) {
  try {
    fs.accessSync(p);
    return true;
  } catch {
    return false;
  }
}

function ensureDir(p) {
  if (!exists(p)) {
    fs.mkdirSync(p, { recursive: true });
  }
}

function cleanDir(p) {
  if (exists(p)) {
    fs.rmSync(p, { recursive: true, force: true });
  }
  fs.mkdirSync(p, { recursive: true });
}

function copyRecursive(src, dest) {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    ensureDir(dest);
    for (const entry of fs.readdirSync(src)) {
      copyRecursive(path.join(src, entry), path.join(dest, entry));
    }
  } else {
    fs.copyFileSync(src, dest);
  }
}

/**
 * 解析命令行参数，返回目标平台列表
 */
function resolveTargets() {
  const requested = process.argv
    .slice(2)
    .map((arg) => platformArgMap[arg])
    .filter(Boolean);

  if (requested.length === 0) {
    // 默认当前平台
    const current = process.platform === 'win32' ? 'win' : process.platform === 'darwin' ? 'mac' : 'linux';
    return [current];
  }
  return [...new Set(requested)];
}

/**
 * 安装并构建前端
 */
async function buildFrontend() {
  log('安装并构建前端...');
  if (!exists(path.join(WEB_DIR, 'node_modules'))) {
    await run('npm', ['install'], { cwd: WEB_DIR });
  }
  await run('npm', ['run', 'build'], { cwd: WEB_DIR });

  const webDist = path.join(WEB_DIR, 'dist');
  if (!exists(webDist)) {
    throw new Error('前端构建失败：未生成 web/dist');
  }

  log('拷贝前端资源到 cmd/server/web/dist（Go embed 使用）...');
  cleanDir(EMBED_DIR);
  copyRecursive(webDist, EMBED_DIR);
}

/**
 * 为指定平台编译 Go 后端
 */
async function buildGoBinary(os, arch, binaryName) {
  // electron-builder 的 ${platform} 变量映射：win32 / darwin / linux
  const outDir = path.join(BIN_DIR, os === 'windows' ? 'win32' : os === 'darwin' ? 'darwin' : 'linux');
  ensureDir(outDir);
  const outPath = path.join(outDir, binaryName);

  log(`编译 Go 后端：${os}/${arch} -> ${outPath}`);

  const env = {
    ...process.env,
    CGO_ENABLED: '0',
    GOOS: os,
    GOARCH: arch,
    GOPROXY: 'https://goproxy.cn,direct',
    GOSUMDB: 'off',
  };

  // Windows 上交叉编译 darwin 需要额外处理（需要 osxcross 等），这里仅尝试
  // 若用户环境不支持，会给出友好提示
  try {
    await run(
      'go',
      ['build', '-o', outPath, '-ldflags', '-s -w', './cmd/server'],
      { env, shell: false }
    );
  } catch (err) {
    error(`交叉编译 ${os}/${arch} 失败，可能缺少对应平台的 C 工具链或 SDK`);
    error(err.message);
    throw err;
  }
}

/**
 * 准备图标资源
 */
function prepareIcons() {
  if (!exists(ICON_SRC)) {
    throw new Error(`未找到应用图标：${ICON_SRC}`);
  }

  log('准备 Linux 多分辨率图标...');
  cleanDir(ICONS_DIR);

  // electron-builder 会从该目录读取任意尺寸的 PNG
  // 我们生成常见的尺寸命名，便于后续替换为真实多分辨率图标
  const sizes = [16, 32, 48, 64, 128, 256, 512, 1024];
  for (const size of sizes) {
    fs.copyFileSync(ICON_SRC, path.join(ICONS_DIR, `${size}x${size}.png`));
  }

  log('图标资源准备完成');
}

/**
 * 调用 electron-builder
 */
async function runElectronBuilder(targets) {
  const platformArgs = [];
  if (targets.includes('win')) platformArgs.push('--win');
  if (targets.includes('mac')) platformArgs.push('--mac');
  if (targets.includes('linux')) platformArgs.push('--linux');

  if (platformArgs.length === 0) {
    throw new Error('没有可打包的目标平台');
  }

  log('调用 electron-builder...');
  const env = {
    ...process.env,
    // 国内镜像加速 Electron 与 electron-builder 二进制下载
    ELECTRON_MIRROR: process.env.ELECTRON_MIRROR || 'https://npmmirror.com/mirrors/electron/',
    ELECTRON_BUILDER_BINARIES_MIRROR: process.env.ELECTRON_BUILDER_BINARIES_MIRROR || 'https://npmmirror.com/mirrors/electron-builder-binaries/',
  };
  await run('npx', ['electron-builder', ...platformArgs, '--publish', 'never'], { env });
}

async function main() {
  const targets = resolveTargets();
  log('目标平台：', targets.join(', '));

  // 0. 检查 Go 环境
  try {
    await run('go', ['version']);
  } catch {
    throw new Error('未检测到 Go，请先安装 Go 1.22+');
  }

  // 1. 构建前端并拷贝到 embed 目录
  await buildFrontend();

  // 2. 准备图标
  prepareIcons();

  // 3. 为每个目标平台编译 Go 后端
  for (const target of targets) {
    const matrix = TARGET_MATRIX[target];
    if (!matrix) continue;
    for (const { os, arch, binaryName } of matrix) {
      // 当前为 Windows 时，跨平台编译 macOS 通常需要额外配置
      // 这里仍然尝试，失败则停止
      await buildGoBinary(os, arch, binaryName);
    }
  }

  // 4. 运行 electron-builder
  await runElectronBuilder(targets);

  log('打包完成，产物在 dist-electron/ 目录');
}

main().catch((err) => {
  error(err.message);
  process.exit(1);
});
