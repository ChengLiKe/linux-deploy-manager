package connectivity

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/linux-deploy-manager/internal/remote/sshclient"
)

// diagnoseNetwork D8: 代理/网络环境检查
func diagnoseNetwork(client *sshclient.Client, gitURL string) DiagnosticItem {
	start := time.Now()

	if client == nil {
		return failedItem("D8", "代理/网络环境", "无 SSH 连接", time.Since(start).Milliseconds(), nil, "")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	// 检查代理环境变量
	proxyCtx, proxyCancel := context.WithTimeout(ctx, 10*time.Second)
	defer proxyCancel()
	proxyOutput, _ := executeAndRead(client, proxyCtx, "echo HTTP_PROXY=${HTTP_PROXY:-none} HTTPS_PROXY=${HTTPS_PROXY:-none} NO_PROXY=${NO_PROXY:-none}")
	proxyInfo := strings.TrimSpace(proxyOutput)

	detail := proxyInfo

	// 如果提供了 Git URL，检查 Git 仓库可达性
	if gitURL != "" {
		gitCtx, gitCancel := context.WithTimeout(ctx, 10*time.Second)
		defer gitCancel()
		gitOutput, _ := executeAndRead(client, gitCtx, fmt.Sprintf("git ls-remote --heads %s 2>&1 | head -3 || echo 'GIT_FAILED'", gitURL))
		gitStr := strings.TrimSpace(gitOutput)
		if gitStr == "GIT_FAILED" || strings.Contains(gitStr, "fatal:") {
			detail += " | ❌ Git 仓库不可达: " + gitURL
		} else {
			detail += " | ✅ Git 仓库可达"
		}
	}

	// 检查外部网络
	extCtx, extCancel := context.WithTimeout(ctx, 10*time.Second)
	defer extCancel()
	extOutput, _ := executeAndRead(client, extCtx, "curl -sI https://github.com --connect-timeout 5 2>&1 | head -1 || echo 'NET_FAILED'")
	extStr := strings.TrimSpace(extOutput)
	if extStr == "NET_FAILED" || extStr == "" {
		detail += " | ⚠️ 外部网络可能受限"
	} else {
		detail += " | ✅ 外网可达"
	}

	return passedItem("D8", "代理/网络环境", detail, time.Since(start).Milliseconds())
}
