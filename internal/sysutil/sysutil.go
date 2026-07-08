// Package sysutil 提供跨平台（Windows / Linux / macOS）的系统相关工具函数，
// 用于屏蔽部署引擎在 Shell 命令与进程管理上的平台差异。
package sysutil

import "runtime"

// IsWindows 当前是否运行在 Windows 上
func IsWindows() bool {
	return runtime.GOOS == "windows"
}

// IsUnixLike 当前是否为类 Unix 系统（Linux / macOS），即使用 bash 作为默认 shell
func IsUnixLike() bool {
	return !IsWindows()
}
