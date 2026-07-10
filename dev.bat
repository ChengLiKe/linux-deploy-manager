@echo off
chcp 65001>nul
title Linux Deploy Manager - Dev Environment

echo ============================================
echo   Linux Deploy Manager - Dev Environment
echo   Press Ctrl+C to stop all services
echo ============================================
echo.

:: Find PowerShell: first try standard path, then PowerShell 7/Core
set "PWSH=%windir%\System32\WindowsPowerShell\v1.0\powershell.exe"
if not exist "%PWSH%" set "PWSH=%ProgramFiles%\PowerShell\7\pwsh.exe"
if not exist "%PWSH%" (
    echo [ERROR] PowerShell not found on this system
    echo.
    echo Tried the following locations:
    echo   %windir%\System32\WindowsPowerShell\v1.0\powershell.exe
    echo   %ProgramFiles%\PowerShell\7\pwsh.exe
    echo.
    echo Please install PowerShell or add it to your PATH.
    pause
    exit /b 1
)

"%PWSH%" -ExecutionPolicy Bypass -File "%~dp0dev.ps1" %*
if errorlevel 1 (
    echo.
    pause
)
