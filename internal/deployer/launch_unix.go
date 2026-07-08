//go:build !windows

package deployer

import (
	"context"
	"fmt"
)

// startBackground 在类 Unix 系统上以后台模式启动部署命令。
// 使用 nohup + & + echo $! 实现后台运行与 PID 记录。
func (d *Deployer) startBackground(ctx context.Context, buf *LogBuffer, executor Executor, cfg *Config, deployCmd, codeDir, logFile string) error {
	full := fmt.Sprintf("nohup %s > %s 2>&1 & echo $! > %s", deployCmd, logFile, pidFilePath(codeDir))
	buf.Writef("[Local] 使用后台模式启动，日志输出到 %s", logFile)
	return d.runCommand(ctx, buf, executor, full, codeDir, cfg.TimeoutSec)
}
