<#
.SYNOPSIS
    Linux Deploy Manager - One-click dev environment launcher (Windows)
.DESCRIPTION
    Starts Go backend + Vite dev server + Electron window.
    Press Ctrl+C to stop all services.
#>

param(
    [switch]$NoBuild  # Skip Go binary build
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$AppName = "linux-deploy-manager"

# -- Helpers ----------------------------------------
function Write-Step  { Write-Host "`n==> $args" -ForegroundColor Cyan }
function Write-Info  { Write-Host "    $args" -ForegroundColor Green }
function Write-Warn  { Write-Host "    $args" -ForegroundColor Yellow }
function Write-Error { Write-Host "    [ERROR] $args" -ForegroundColor Red }

# -- Process management -----------------------------
$script:processes = @()

function Start-DevProcess {
    param($Name, $FilePath, $Arguments, $WorkingDir)

    $p = Start-Process -FilePath $FilePath -ArgumentList $Arguments `
        -WorkingDirectory $WorkingDir -NoNewWindow -PassThru
    $script:processes += @{
        Name    = $Name
        Process = $p
    }
    Write-Info "$Name started (PID: $($p.Id))"
    return $p
}

function Stop-AllProcesses {
    Write-Host "`n============================================" -ForegroundColor Yellow
    Write-Host "  Shutting down development environment..." -ForegroundColor Yellow
    Write-Host "============================================" -ForegroundColor Yellow

    for ($i = $script:processes.Count - 1; $i -ge 0; $i--) {
        $entry = $script:processes[$i]
        $p = $entry.Process
        if ($null -ne $p -and !$p.HasExited) {
            try {
                Write-Info "Stopping $($entry.Name)..."
                taskkill /PID $p.Id /T /F 2>$null | Out-Null
                $p.WaitForExit(5000) | Out-Null
                Write-Info "$($entry.Name) stopped"
            } catch {
                Write-Warn "Failed to stop $($entry.Name): $_"
            }
        }
    }

    # Fallback: kill any lingering vite/electron node processes
    Get-Process "node" -ErrorAction SilentlyContinue `
        | Where-Object { $_.MainWindowTitle -eq "" -and $_.CommandLine -match "vite|electron" } `
        | Stop-Process -Force -ErrorAction SilentlyContinue

    Write-Info "Development environment fully stopped"
    Write-Host ""
}

# -- Ctrl+C handler ---------------------------------
$null = Register-EngineEvent -SourceIdentifier PowerShell.Exiting -Action {
    Write-Host "`n[EXIT] Received shutdown signal..." -ForegroundColor Yellow
    for ($i = $script:processes.Count - 1; $i -ge 0; $i--) {
        $entry = $script:processes[$i]
        $p = $entry.Process
        if ($null -ne $p -and !$p.HasExited) {
            try {
                taskkill /PID $p.Id /T /F 2>$null | Out-Null
            } catch {}
        }
    }
}

# -- Main -------------------------------------------
try {
    # Banner
    Write-Host "============================================" -ForegroundColor Cyan
    Write-Host "  Linux Deploy Manager - Dev Environment" -ForegroundColor Cyan
    Write-Host "  Press Ctrl+C to stop all services" -ForegroundColor Cyan
    Write-Host "============================================" -ForegroundColor Cyan

    $binPath = Join-Path (Join-Path $ProjectRoot "bin") "${AppName}.exe"

    # -- Check toolchain ---------------------------
    Write-Step "Checking environment..."

    # Go
    $goVer = go version 2>$null
    if (-not $goVer) { throw "Go not found. Install Go 1.22+ first." }
    Write-Info "Go: $goVer"

    # Node
    $nodeVer = node --version 2>$null
    if (-not $nodeVer) { throw "Node.js not found." }
    Write-Info "Node: $nodeVer"

    # -- Step 1: Build Go backend ------------------
    if (-not $NoBuild) {
        Write-Step "Building Go backend..."
        Push-Location $ProjectRoot
        try {
            # 复制前端产物到 embed 目录
            $embedDir = Join-Path (Join-Path $ProjectRoot "cmd") "server"
            $embedDir = Join-Path $embedDir "web"
            $embedDist = Join-Path $embedDir "dist"
            if (Test-Path $embedDist) { Remove-Item -Recurse -Force $embedDist }
            New-Item -ItemType Directory -Path $embedDir -Force | Out-Null
            Copy-Item -Recurse (Join-Path (Join-Path $ProjectRoot "web") "dist") $embedDir

            $env:CGO_ENABLED = "0"
            $env:GOPROXY = "https://goproxy.cn,direct"
            go build -o $binPath -ldflags "-s -w" ./cmd/server
            if ($LASTEXITCODE -ne 0) { throw "Go build failed" }
            Write-Info "Go backend built: $binPath"
        } finally { Pop-Location }
    } else {
        Write-Info "Skipping Go build (-NoBuild flag)"
    }

    # -- Step 2: Check frontend dependencies -------
    $webNodeModules = Join-Path (Join-Path $ProjectRoot "web") "node_modules"
    if (-not (Test-Path $webNodeModules)) {
        Write-Step "Installing frontend dependencies..."
        Push-Location (Join-Path $ProjectRoot "web")
        try {
            npm install
            if ($LASTEXITCODE -ne 0) { throw "npm install failed" }
            Write-Info "Frontend dependencies installed"
        } finally { Pop-Location }
    }

    # Also check root node_modules for Electron
    $rootNodeModules = Join-Path $ProjectRoot "node_modules"
    if (-not (Test-Path $rootNodeModules)) {
        Write-Step "Installing Electron dependencies..."
        Push-Location $ProjectRoot
        try {
            npm install
            if ($LASTEXITCODE -ne 0) { throw "npm install failed" }
            Write-Info "Electron dependencies installed"
        } finally { Pop-Location }
    }

    # -- Step 3: Start Vite dev server -------------
    Write-Step "Starting Vite dev server (http://localhost:3000)..."
    Start-DevProcess -Name "Vite" -FilePath "npx.cmd" `
        -Arguments "vite" `
        -WorkingDir (Join-Path $ProjectRoot "web")

    Start-Sleep -Seconds 3

    # -- Step 4: Start Electron --------------------
    Write-Step "Starting Electron (auto-loads Go backend binary)..."
    Start-DevProcess -Name "Electron" -FilePath "npx.cmd" `
        -Arguments "electron electron/main.js" `
        -WorkingDir $ProjectRoot

    # -- Done --------------------------------------
    Write-Host ""
    Write-Host "============================================" -ForegroundColor Cyan
    Write-Host "  Development environment is ready!" -ForegroundColor Cyan
    Write-Host "============================================" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "  Vite:   http://localhost:3000" -ForegroundColor White
    Write-Host "  Go:     Managed by Electron automatically" -ForegroundColor White
    Write-Host "  Electron: Ctrl+Shift+I to open DevTools" -ForegroundColor White
    Write-Host ""
    Write-Host "  Press Ctrl+C to stop all services" -ForegroundColor Yellow
    Write-Host ""

    # -- Wait loop ---------------------------------
    while ($true) {
        Start-Sleep -Seconds 2
        $dead = $script:processes | Where-Object { $_.Process.HasExited }
        if ($dead.Count -gt 0) {
            $deadNames = ($dead | ForEach-Object { $_.Name }) -join ", "
            Write-Warn "$deadNames exited unexpectedly"
            $hasElectron = $dead | Where-Object { $_.Name -eq "Electron" }
            if ($hasElectron -or $dead.Count -eq $script:processes.Count) {
                break
            }
            Write-Warn "Waiting for other services..."
        }
    }

} catch {
    Write-Error "Failed to start: $_"
    Write-Host ""
    Write-Host "Troubleshooting:" -ForegroundColor Yellow
    Write-Host "  1. Go >= 1.22 required" -ForegroundColor White
    Write-Host "  2. Node.js >= 18 required" -ForegroundColor White
    Write-Host "  3. Ensure bin/linux-deploy-manager.exe exists" -ForegroundColor White
    Write-Host "  4. Try running PowerShell as Administrator" -ForegroundColor White
    Write-Host ""
    pause
} finally {
    Stop-AllProcesses
}
