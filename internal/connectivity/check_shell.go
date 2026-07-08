package connectivity

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/linux-deploy-manager/internal/remote/sshclient"
)

// diagnoseShell D5: Shell 可用性检查
func diagnoseShell(client *sshclient.Client, user string) DiagnosticItem {
	start := time.Now()

	if client == nil {
		return failedItem("D5", "Shell 可用性", "无 SSH 连接", time.Since(start).Milliseconds(), nil, "")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	output, err := executeAndRead(client, ctx, "id")
	if err != nil {
		return failedItem("D5", "Shell 可用性",
			fmt.Sprintf("无法执行命令: %s", err.Error()),
			time.Since(start).Milliseconds(),
			[]FixSuggestion{
				{Level: "critical", Title: "检查用户默认 Shell", Description: fmt.Sprintf("用户 %s 可能没有有效的默认 Shell", user), Command: "grep \"^" + user + ":\" /etc/passwd"},
				{Level: "warning", Title: "检查是否被 restricted shell 限制", Description: "检查用户 shell 是否被限制 (rbash)", Command: "echo $SHELL"},
			},
			"ssh "+user+"@host 'id && echo $SHELL'")
	}

	uidInfo := strings.TrimSpace(output)

	// 检查登录用户
	whoCtx, whoCancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer whoCancel()
	whoOutput, whoErr := executeAndRead(client, whoCtx, "whoami")
	if whoErr == nil {
		uidInfo += " | 登录用户: " + strings.TrimSpace(whoOutput)
	}

	// 检查 sudo 权限
	sudoCtx, sudoCancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer sudoCancel()
	sudoOutput, _ := executeAndRead(client, sudoCtx, "sudo -n true 2>&1; echo $?")
	if strings.TrimSpace(sudoOutput) == "0" {
		uidInfo += " | 有 sudo 权限"
	} else {
		uidInfo += " | 无 sudo 权限"
	}

	return passedItem("D5", "Shell 可用性", uidInfo, time.Since(start).Milliseconds())
}
