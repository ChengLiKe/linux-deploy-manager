package deployer

import (
	"context"
	"fmt"
	"io"
	"os"
	"os/exec"
	"time"

	"github.com/linux-deploy-manager/internal/sysutil"
)

// LocalExecutor 本地命令执行器，通过 exec.Command 执行系统命令
type LocalExecutor struct {
	workDir string
	envVars map[string]string
	timeout time.Duration
	cmd     *exec.Cmd
}

// NewLocalExecutor 创建本地执行器
func NewLocalExecutor(timeoutSec int) *LocalExecutor {
	if timeoutSec <= 0 {
		timeoutSec = 600
	}
	return &LocalExecutor{
		timeout: time.Duration(timeoutSec) * time.Second,
		envVars: make(map[string]string),
	}
}

func (e *LocalExecutor) SetWorkDir(dir string) { e.workDir = dir }
func (e *LocalExecutor) SetEnv(env map[string]string) {
	e.envVars = env
}

// Run 执行本地命令，实时将 stdout/stderr 写入对应 writer
func (e *LocalExecutor) Run(ctx context.Context, command string, stdoutWriter, stderrWriter io.Writer) error {
	ctx, cancel := context.WithTimeout(ctx, e.timeout)
	defer cancel()

	cmd := sysutil.ShellCommandContext(ctx, command)
	cmd.Dir = e.workDir

	// 注入环境变量
	cmd.Env = os.Environ()
	for k, v := range e.envVars {
		cmd.Env = append(cmd.Env, fmt.Sprintf("%s=%s", k, v))
	}

	// 捕获输出
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return fmt.Errorf("create stdout pipe: %w", err)
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return fmt.Errorf("create stderr pipe: %w", err)
	}

	e.cmd = cmd

	if err := cmd.Start(); err != nil {
		return fmt.Errorf("start command: %w", err)
	}

	// 实时复制输出
	go io.Copy(stdoutWriter, stdout)
	go io.Copy(stderrWriter, stderr)

	// 等待命令完成
	err = cmd.Wait()
	if ctx.Err() == context.DeadlineExceeded {
		// 超时：优雅终止（SIGTERM / 关闭进程树），10 秒后强制结束
		terminateCmd(cmd, true)
		return fmt.Errorf("command timed out after %v", e.timeout)
	}
	if err != nil {
		return fmt.Errorf("command failed: %w", err)
	}
	return nil
}

// Signal 发送信号到正在执行的进程
// 注意：Windows 仅支持终止进程，会忽略具体信号类型
func (e *LocalExecutor) Signal(sig string) error {
	if e.cmd == nil || e.cmd.Process == nil {
		return fmt.Errorf("no running process")
	}
	return sendSignal(e.cmd.Process, sig)
}
