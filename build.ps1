<#
.SYNOPSIS
    Linux Deploy Manager Windows 构建脚本
.DESCRIPTION
    在 Windows 上使用 CGO_ENABLED=0 编译 Go 后端（纯 Go SQLite 驱动），
    并构建前端、拷贝静态资源。
#>

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$AppName = "linux-deploy-manager"

Write-Host "==============================" -ForegroundColor Cyan
Write-Host "  $AppName Windows 构建" -ForegroundColor Cyan
Write-Host "==============================" -ForegroundColor Cyan

# ── 检查工具链 ──────────────────────────────────────
$GoVersion = go version 2>$null
if (-not $GoVersion) {
    Write-Host "[ERROR] 未安装 Go，请先安装 Go 1.22+" -ForegroundColor Red
    exit 1
}
Write-Host "[INFO] Go: $GoVersion" -ForegroundColor Green

# ── 构建前端 ─────────────────────────────────────────
Write-Host "[INFO] 构建前端..." -ForegroundColor Green
Push-Location (Join-Path $ProjectRoot "web")
try {
    $npmBin = Get-Command "npm" -ErrorAction SilentlyContinue
    if (-not $npmBin) {
        Write-Host "[ERROR] 未安装 npm" -ForegroundColor Red
        exit 1
    }
    npm install
    npm run build
    Write-Host "[INFO] 前端构建完成" -ForegroundColor Green
} finally {
    Pop-Location
}

# 确认 web/dist 已生成
$webDist = Join-Path $ProjectRoot "web\dist"
if (-not (Test-Path $webDist)) {
    Write-Host "[ERROR] web/dist 未生成，前端构建可能失败" -ForegroundColor Red
    exit 1
}

# ── 拷贝前端静态资源到 embed 目录 ─────────────────────
Write-Host "[INFO] 拷贝前端资源到 cmd/server/web/dist..." -ForegroundColor Green
$embedDist = Join-Path $ProjectRoot "cmd\server\web\dist"
if (-not (Test-Path $embedDist)) {
    New-Item -ItemType Directory -Path $embedDist -Force | Out-Null
}
# 使用 robocopy（Windows 原生）高效拷贝，/MIR 镜像目录
robocopy $webDist $embedDist /MIR /NJH /NJS /NP /NS /NC | Out-Null
Write-Host "[INFO] 前端资源已拷贝" -ForegroundColor Green

# ── 编译 Go 后端（CGO_ENABLED=0，纯 Go 静态链接） ──────
Write-Host "[INFO] 编译 Go 后端 (windows/amd64, CGO_ENABLED=0)..." -ForegroundColor Green

$env:CGO_ENABLED = "0"
$outDir = Join-Path $ProjectRoot "bin"
if (-not (Test-Path $outDir)) {
    New-Item -ItemType Directory -Path $outDir -Force | Out-Null
}

# 设置 GOPROXY（国内镜像）
$env:GOPROXY = "https://goproxy.cn,direct"

go build -o (Join-Path $outDir "${AppName}.exe") -ldflags "-s -w" ./cmd/server
if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERROR] Go 编译失败" -ForegroundColor Red
    exit 1
}
Write-Host "[INFO] 编译成功: $outDir\${AppName}.exe" -ForegroundColor Green

# ── 编译 Linux 二进制（同架构，CGO_ENABLED=0） ────────
Write-Host "[INFO] 编译 Go 后端 (linux/amd64, CGO_ENABLED=0)..." -ForegroundColor Green
$env:GOOS = "linux"
$env:GOARCH = "amd64"
go build -o (Join-Path $outDir "${AppName}-linux-amd64") -ldflags "-s -w" ./cmd/server
if ($LASTEXITCODE -eq 0) {
    Write-Host "[INFO] 编译成功: $outDir\${AppName}-linux-amd64" -ForegroundColor Green
}
# 恢复 GOOS
$env:GOOS = "windows"

# ── 完成 ─────────────────────────────────────────────
Write-Host ""
Write-Host "==============================" -ForegroundColor Cyan
Write-Host "  Windows 构建完成！" -ForegroundColor Cyan
Write-Host "==============================" -ForegroundColor Cyan
Write-Host ""
Write-Host "输出文件:" -ForegroundColor Yellow
Write-Host "  Windows 二进制: bin\${AppName}.exe" -ForegroundColor White
Write-Host "  Linux 二进制:   bin\${AppName}-linux-amd64" -ForegroundColor White
Write-Host ""
Write-Host "启动方式:" -ForegroundColor Yellow
Write-Host "  bin\${AppName}.exe --port 8080 --data-dir data" -ForegroundColor White
Write-Host "  然后打开 http://127.0.0.1:8080" -ForegroundColor White
Write-Host ""

if (Get-Command "PowerShell.exe" -ErrorAction SilentlyContinue) {
    Pause
}
