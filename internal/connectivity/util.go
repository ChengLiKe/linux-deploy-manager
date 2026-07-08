package connectivity

import (
	"context"
	"fmt"
	"io"
	"os"
	"time"

	"github.com/linux-deploy-manager/internal/remote/sshclient"
)

// TimeoutContext 创建带超时的 context
// cancel 会在超时到达时自动被调用
func TimeoutContext(timeout time.Duration) context.Context {
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	go func() {
		<-ctx.Done()
		cancel()
	}()
	return ctx
}

// readFileFromPath 读取文件内容
func readFileFromPath(path string) ([]byte, error) {
	return os.ReadFile(path)
}

// executeAndRead 在 SSH 客户端执行命令并读取完整输出
func executeAndRead(client *sshclient.Client, ctx context.Context, command string) (string, error) {
	stdout, _, done, err := client.Execute(ctx, command)
	if err != nil {
		return "", fmt.Errorf("execute failed: %w", err)
	}

	out, readErr := io.ReadAll(stdout)
	if readErr != nil {
		return "", fmt.Errorf("read stdout: %w", readErr)
	}

	execErr := <-done
	if execErr != nil {
		// 命令本身返回非零退出码，但 stdout 可能仍有内容
		return string(out), execErr
	}
	return string(out), nil
}
