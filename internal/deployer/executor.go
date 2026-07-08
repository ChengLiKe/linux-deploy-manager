package deployer

import (
	"context"
	"io"
)

// Executor 命令执行接口，支持本地和远程执行
type Executor interface {
	// Run 执行命令，将 stdout/stderr 实时写入对应的 writer
	Run(ctx context.Context, command string, stdoutWriter, stderrWriter io.Writer) error
	// SetWorkDir 设置命令执行的工作目录
	SetWorkDir(dir string)
	// SetEnv 设置环境变量
	SetEnv(env map[string]string)
	// Signal 向正在执行的进程发送信号
	Signal(sig string) error
}