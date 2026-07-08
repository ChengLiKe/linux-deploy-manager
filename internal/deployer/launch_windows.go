//go:build windows

package deployer

import (
	"context"
	"fmt"
	"os"
	"strconv"

	"github.com/linux-deploy-manager/internal/sysutil"
)

// startBackground 在 Windows 上以后台模式启动部署命令。
// Windows 无 nohup/&/echo $!，改为直接 spawn 分离子进程并写入 PID 文件。
// 若为远程执行器（SSH），回退到 Unix 风格 shell 命令（目标为 Linux）。
func (d *Deployer) startBackground(ctx context.Context, buf *LogBuffer, executor Executor, cfg *Config, deployCmd, codeDir, logFile string) error {
	le, ok := executor.(*LocalExecutor)
	if !ok {
		// 远程执行器：目标通常是 Linux，回退到 nohup shell 风格
		full := fmt.Sprintf("nohup %s > %s 2>&1 & echo $! > %s", deployCmd, logFile, pidFilePath(codeDir))
		return d.runCommand(ctx, buf, executor, full, codeDir, cfg.TimeoutSec)
	}

	// Windows 本地：用 Go 直接启动分离进程
	f, err := os.OpenFile(logFile, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0644)
	if err != nil {
		return fmt.Errorf("open log file: %w", err)
	}
	defer f.Close()

	cmd := sysutil.ShellCommand(deployCmd)
	cmd.Dir = codeDir
	cmd.Env = os.Environ()
	for k, v := range le.envVars {
		cmd.Env = append(cmd.Env, fmt.Sprintf("%s=%s", k, v))
	}
	cmd.Stdout = f
	cmd.Stderr = f
	sysutil.DetachProcess(cmd)

	if err := cmd.Start(); err != nil {
		return fmt.Errorf("start background: %w", err)
	}

	// 写入 PID 文件
	pidFile := pidFilePath(codeDir)
	if err := os.WriteFile(pidFile, []byte(strconv.Itoa(cmd.Process.Pid)), 0644); err != nil {
		return fmt.Errorf("write pid file: %w", err)
	}

	buf.Writef("[Local] Windows 后台模式已启动 PID=%d，日志 %s", cmd.Process.Pid, logFile)
	return nil
}
