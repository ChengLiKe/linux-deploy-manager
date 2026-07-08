package deployer

import (
	"context"
	"fmt"
	"io"
	"strings"
	"time"

	"github.com/linux-deploy-manager/internal/remote/sshclient"
)

// RemoteExecutor 远程命令执行器，通过 SSH 在目标服务器上执行命令
type RemoteExecutor struct {
	client  *sshclient.Client
	workDir string
	envVars map[string]string
	timeout time.Duration
}

// NewRemoteExecutor 创建远程执行器
func NewRemoteExecutor(client *sshclient.Client, timeoutSec int) *RemoteExecutor {
	if timeoutSec <= 0 {
		timeoutSec = 600
	}
	return &RemoteExecutor{
		client:  client,
		timeout: time.Duration(timeoutSec) * time.Second,
		envVars: make(map[string]string),
	}
}

func (e *RemoteExecutor) SetWorkDir(dir string) { e.workDir = dir }
func (e *RemoteExecutor) SetEnv(env map[string]string) {
	e.envVars = env
}

// Run 通过 SSH 执行远程命令，实时将 stdout/stderr 写入对应 writer
func (e *RemoteExecutor) Run(ctx context.Context, command string, stdoutWriter, stderrWriter io.Writer) error {
	// 注入工作目录
	if e.workDir != "" {
		command = fmt.Sprintf("cd %s && %s", e.workDir, command)
	}
	// 注入环境变量
	if len(e.envVars) > 0 {
		command = wrapRemoteEnv(command, e.envVars)
	}

	ctx, cancel := context.WithTimeout(ctx, e.timeout)
	defer cancel()

	stdout, stderr, done, err := e.client.Execute(ctx, command)
	if err != nil {
		return fmt.Errorf("execute remote: %w", err)
	}

	// 实时复制输出
	go io.Copy(stdoutWriter, stdout)
	go io.Copy(stderrWriter, stderr)

	// 等待完成或超时
	select {
	case err := <-done:
		return err
	case <-ctx.Done():
		return fmt.Errorf("command timed out after %v", e.timeout)
	}
}

// Signal 发送信号到远程进程（通过 SSH Session Signal 或 kill 命令）
// 注意：OpenSSH 服务端默认不处理 SSH Signal 消息。实际信号发送在 Deployer 层通过
// PID 文件和远程 kill 命令处理。本接口保留以符合 Executor 接口签名。
func (e *RemoteExecutor) Signal(sig string) error {
	return nil
}

// wrapRemoteEnv 将环境变量包装为远程命令前缀
func wrapRemoteEnv(command string, env map[string]string) string {
	if len(env) == 0 {
		return command
	}
	var exports []string
	for k, v := range env {
		exports = append(exports, fmt.Sprintf("export %s=%q", k, v))
	}
	return fmt.Sprintf("%s && %s", strings.Join(exports, " "), command)
}
