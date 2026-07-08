package connectivity

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/linux-deploy-manager/internal/remote/sshclient"
)

// diagnoseFilesystem D6: 文件系统权限检查
func diagnoseFilesystem(client *sshclient.Client, codeDir string) DiagnosticItem {
	start := time.Now()

	if client == nil {
		return failedItem("D6", "文件系统权限", "无 SSH 连接", time.Since(start).Milliseconds(), nil, "")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	if codeDir == "" {
		codeDir = "/root"
	}

	// 检查目录是否存在并可写
	mkdirCmd := fmt.Sprintf("mkdir -p %s && touch %s/.ldm-diag-test && rm -f %s/.ldm-diag-test", codeDir, codeDir, codeDir)
	_, err := executeAndRead(client, ctx, mkdirCmd)
	if err != nil {
		return failedItem("D6", "文件系统权限",
			fmt.Sprintf("无法写入目录 %s: %s", codeDir, err.Error()),
			time.Since(start).Milliseconds(),
			[]FixSuggestion{
				{Level: "critical", Title: "目录权限不足", Description: fmt.Sprintf("当前用户无法写入 %s", codeDir), Command: "ls -ld " + codeDir},
				{Level: "warning", Title: "修改目录所有者", Description: "将目录所有者改为当前用户", Command: "sudo chown -R $(whoami):$(whoami) " + codeDir},
			},
			"ssh user@host 'ls -ld "+codeDir+" && touch "+codeDir+"/test && rm "+codeDir+"/test'")
	}

	// 检查磁盘空间
	dfCtx, dfCancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer dfCancel()
	dfOutput, _ := executeAndRead(client, dfCtx, "df -h "+codeDir+" | tail -1")
	diskInfo := strings.TrimSpace(dfOutput)

	detail := fmt.Sprintf("目录 %s 可写", codeDir)
	if diskInfo != "" {
		detail += " | 磁盘: " + diskInfo
	}

	return passedItem("D6", "文件系统权限", detail, time.Since(start).Milliseconds())
}
