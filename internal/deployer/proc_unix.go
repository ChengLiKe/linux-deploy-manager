//go:build !windows

package deployer

import (
	"fmt"
	"os"
	"os/exec"
	"syscall"
	"time"
)

// terminateCmd 终止命令进程。graceful=true 时先发送 SIGTERM，等待 10 秒后 SIGKILL。
func terminateCmd(cmd *exec.Cmd, graceful bool) {
	if cmd.Process == nil {
		return
	}
	if graceful {
		_ = cmd.Process.Signal(syscall.SIGTERM)
		time.Sleep(10 * time.Second)
	}
	_ = cmd.Process.Kill()
}

// sendSignal 向进程发送 POSIX 信号
func sendSignal(proc *os.Process, sig string) error {
	var s syscall.Signal
	switch sig {
	case "SIGTERM", "TERM":
		s = syscall.SIGTERM
	case "SIGKILL", "KILL":
		s = syscall.SIGKILL
	case "SIGINT", "INT":
		s = syscall.SIGINT
	default:
		return fmt.Errorf("unsupported signal: %s", sig)
	}
	return proc.Signal(s)
}
