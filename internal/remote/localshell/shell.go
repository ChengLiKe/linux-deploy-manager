package localshell

import (
	"io"
	"os/exec"
	"runtime"

	"github.com/linux-deploy-manager/internal/sysutil"
)

// Shell 本地 Shell 进程，提供与 SSH ShellSession 兼容的接口
type Shell struct {
	cmd    *exec.Cmd
	stdin  io.WriteCloser
	stdout io.Reader
	stderr io.Reader
}

// New 启动一个本地 Shell 进程
func New() (*Shell, error) {
	var cmd *exec.Cmd
	if runtime.GOOS == "windows" {
		cmd = exec.Command("cmd.exe")
	} else {
		cmd = exec.Command("bash")
		// Unix 上设置进程组，确保 Kill 时子进程一并终止
		cmd.SysProcAttr = sysutil.ProcAttr()
	}

	stdin, err := cmd.StdinPipe()
	if err != nil {
		return nil, err
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, err
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return nil, err
	}

	if err := cmd.Start(); err != nil {
		return nil, err
	}

	return &Shell{cmd: cmd, stdin: stdin, stdout: stdout, stderr: stderr}, nil
}

// Stdin 返回 stdin 写入器
func (s *Shell) Stdin() io.WriteCloser {
	return s.stdin
}

// Stdout 返回 stdout 读取器
func (s *Shell) Stdout() io.Reader {
	return s.stdout
}

// Stderr 返回 stderr 读取器
func (s *Shell) Stderr() io.Reader {
	return s.stderr
}

// Resize 调整终端大小（本地 shell 不支持，空操作）
func (s *Shell) Resize(rows, cols int) error {
	return nil
}

// Close 关闭 Shell 进程
func (s *Shell) Close() error {
	if s.cmd != nil && s.cmd.Process != nil {
		return sysutil.TerminateProcess(s.cmd)
	}
	return nil
}

// Wait 等待 Shell 进程退出
func (s *Shell) Wait() error {
	return s.cmd.Wait()
}
