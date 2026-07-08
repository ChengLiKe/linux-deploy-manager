//go:build windows

package deployer

import (
	"fmt"
	"os"
	"os/exec"
)

// terminateCmd 在 Windows 上终止由 cmd /C 启动的整个进程树。
// Windows 没有 SIGTERM 优雅信号概念，这里直接用 taskkill 结束进程树，
// 兜底再调用 Process.Kill。graceful 参数在此忽略（Windows 统一强制结束）。
func terminateCmd(cmd *exec.Cmd, graceful bool) {
	if cmd.Process == nil {
		return
	}
	// /T 结束进程树，/F 强制
	_ = exec.Command("taskkill", "/T", "/F", "/PID", fmt.Sprint(cmd.Process.Pid)).Run()
	_ = cmd.Process.Kill()
}

// sendSignal Windows 仅支持终止进程，忽略具体信号类型，统一强制结束。
func sendSignal(proc *os.Process, sig string) error {
	if sig == "SIGTERM" || sig == "TERM" || sig == "SIGINT" || sig == "INT" {
		// 对 SIGTERM/SIGINT 仍使用 taskkill 结束进程树，避免残留子进程
		_ = exec.Command("taskkill", "/T", "/F", "/PID", fmt.Sprint(proc.Pid)).Run()
	}
	return proc.Kill()
}
