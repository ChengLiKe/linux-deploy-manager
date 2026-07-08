//go:build !windows

package sysutil

import (
	"context"
	"os/exec"
)

// ShellCommand 以默认 shell 执行命令（类 Unix 系统使用 bash -c）
func ShellCommand(command string) *exec.Cmd {
	return exec.Command("bash", "-c", command)
}

// ShellCommandContext 以默认 shell 执行命令，并绑定 context（类 Unix 系统使用 bash -c）
func ShellCommandContext(ctx context.Context, command string) *exec.Cmd {
	return exec.CommandContext(ctx, "bash", "-c", command)
}

// ShellCommandWithSudo 在需要时使用 sudo -S 执行命令（类 Unix 系统）
func ShellCommandWithSudo(command, sudoPassword string) *exec.Cmd {
	if sudoPassword != "" {
		return exec.Command("sudo", "-S", "bash", "-c", command)
	}
	return exec.Command("bash", "-c", command)
}

// ShellCommandContextWithSudo 带 context 的 sudo 执行版本（类 Unix 系统）
func ShellCommandContextWithSudo(ctx context.Context, command, sudoPassword string) *exec.Cmd {
	if sudoPassword != "" {
		return exec.CommandContext(ctx, "sudo", "-S", "bash", "-c", command)
	}
	return exec.CommandContext(ctx, "bash", "-c", command)
}

// DetachProcess 类 Unix 系统无需特殊设置，进程默认不依附父进程
func DetachProcess(cmd *exec.Cmd) {
	// no-op on Unix: nohup + & already detaches
}
