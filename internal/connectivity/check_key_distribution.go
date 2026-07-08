package connectivity

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/linux-deploy-manager/internal/model"
	"github.com/linux-deploy-manager/internal/remote/sshclient"
)

// diagnoseKeyDistribution D7: 密钥分发检查
func diagnoseKeyDistribution(client *sshclient.Client, node *model.ServerNode) DiagnosticItem {
	start := time.Now()

	if client == nil {
		return failedItem("D7", "密钥分发检查", "无 SSH 连接", time.Since(start).Milliseconds(), nil, "")
	}

	if node.AuthType != "key" || node.ServerKeyID == nil {
		return skippedItem("D7", "密钥分发检查", "非密钥认证模式，无需检查")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	// 检查 ~/.ssh 目录
	output, err := executeAndRead(client, ctx, "ls -la ~/.ssh/ 2>&1")
	if err != nil {
		return failedItem("D7", "密钥分发检查",
			fmt.Sprintf("无法访问 ~/.ssh: %s", err.Error()),
			time.Since(start).Milliseconds(),
			[]FixSuggestion{
				{Level: "warning", Title: "创建 ~/.ssh 目录", Description: "远程服务器没有 .ssh 目录", Command: "mkdir -p ~/.ssh && chmod 700 ~/.ssh"},
			},
			"ssh user@host 'ls -la ~/.ssh/'")
	}

	// 检查 authorized_keys
	if !strings.Contains(output, "authorized_keys") {
		return failedItem("D7", "密钥分发检查",
			"~/.ssh/authorized_keys 不存在",
			time.Since(start).Milliseconds(),
			[]FixSuggestion{
				{Level: "critical", Title: "配置公钥认证", Description: "需要将公钥添加到 authorized_keys", Command: "cat ~/.ssh/id_*.pub >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys"},
				{Level: "info", Title: "使用 ssh-copy-id", Description: "一键复制公钥到服务器", Command: "ssh-copy-id " + node.User + "@" + node.Host},
			},
			"ssh user@host 'cat ~/.ssh/authorized_keys | head -5'")
	}

	// 检查权限
	permCtx, permCancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer permCancel()
	permOutput, permErr := executeAndRead(client, permCtx, "stat -c '%a' ~/.ssh 2>/dev/null; echo '---'; stat -c '%a' ~/.ssh/authorized_keys 2>/dev/null")
	if permErr == nil {
		parts := strings.Split(strings.TrimSpace(permOutput), "---")
		if len(parts) >= 2 {
			dirPerm := strings.TrimSpace(parts[0])
			keyPerm := strings.TrimSpace(parts[1])
			if dirPerm != "" && dirPerm != "700" {
				return failedItem("D7", "密钥分发检查",
					fmt.Sprintf("~/.ssh 目录权限为 %s，应为 700", dirPerm),
					time.Since(start).Milliseconds(),
					[]FixSuggestion{
						{Level: "warning", Title: "修复目录权限", Description: "~/.ssh 目录权限需要为 700", Command: "chmod 700 ~/.ssh"},
					},
					"ls -la ~/.ssh/")
			}
			if keyPerm != "" && keyPerm != "600" {
				return failedItem("D7", "密钥分发检查",
					fmt.Sprintf("authorized_keys 权限为 %s，应为 600", keyPerm),
					time.Since(start).Milliseconds(),
					[]FixSuggestion{
						{Level: "warning", Title: "修复文件权限", Description: "authorized_keys 权限需要为 600", Command: "chmod 600 ~/.ssh/authorized_keys"},
					},
					"ls -la ~/.ssh/authorized_keys")
			}
		}
	}

	return passedItem("D7", "密钥分发检查",
		"SSH 目录配置正常: ~/.ssh/authorized_keys 已存在，权限正确",
		time.Since(start).Milliseconds())
}
