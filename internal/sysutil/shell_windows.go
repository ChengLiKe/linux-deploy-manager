//go:build windows

package sysutil

import (
	"context"
	"os/exec"
	"syscall"
)

// ShellCommand 以默认 shell 执行命令（Windows 使用 cmd /C）
func ShellCommand(command string) *exec.Cmd {
	return exec.Command("cmd", "/C", command)
}

// ShellCommandContext 以默认 shell 执行命令，并绑定 context（Windows 使用 cmd /C）
func ShellCommandContext(ctx context.Context, command string) *exec.Cmd {
	return exec.CommandContext(ctx, "cmd", "/C", command)
}

// ShellCommandWithSudo Windows 没有 sudo，直接以 cmd /C 执行；sudoPassword 被忽略
func ShellCommandWithSudo(command, sudoPassword string) *exec.Cmd {
	return exec.Command("cmd", "/C", command)
}

// ShellCommandContextWithSudo Windows 没有 sudo，直接以 cmd /C 执行；sudoPassword 被忽略
func ShellCommandContextWithSudo(ctx context.Context, command, sudoPassword string) *exec.Cmd {
	return exec.CommandContext(ctx, "cmd", "/C", command)
}

// DetachProcess 设置进程属性，使其不依附于父进程（使用 CREATE_NEW_PROCESS_GROUP + DETACHED_PROCESS）
func DetachProcess(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{
		CreationFlags: syscall.CREATE_NEW_PROCESS_GROUP | 0x00000008, // DETACHED_PROCESS
	}
}

// ProcAttr 返回进程属性（Windows 上无需特殊设置）
func ProcAttr() *syscall.SysProcAttr {
	return nil
}

// TerminateProcess 终止进程（Windows 使用 TerminateProcess）
func TerminateProcess(cmd *exec.Cmd) error {
	if cmd == nil || cmd.Process == nil {
		return nil
	}
	return cmd.Process.Kill()
}
