package connectivity

import (
	"context"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/linux-deploy-manager/internal/remote/sshclient"
)

// diagnoseSystemResources D9: 系统资源检查
func diagnoseSystemResources(client *sshclient.Client) DiagnosticItem {
	start := time.Now()

	if client == nil {
		return failedItem("D9", "系统资源", "无 SSH 连接", time.Since(start).Milliseconds(), nil, "")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	// 1. 检查内存
	memCtx, memCancel := context.WithTimeout(ctx, 5*time.Second)
	defer memCancel()
	memOutput, _ := executeAndRead(client, memCtx, "free -m | grep Mem | awk '{print $2, $4}'")
	memInfo := ""
	memOK := true
	memStr := strings.TrimSpace(memOutput)
	if parts := strings.Fields(memStr); len(parts) >= 2 {
		total, _ := strconv.Atoi(parts[0])
		avail, _ := strconv.Atoi(parts[1])
		memInfo = fmt.Sprintf("内存: %dMB 总计, %dMB 可用", total, avail)
		if total < 512 {
			memOK = false
			memInfo += " ⚠️ 内存不足 (建议 >= 1GB)"
		}
	}

	// 2. 检查 CPU
	cpuCtx, cpuCancel := context.WithTimeout(ctx, 5*time.Second)
	defer cpuCancel()
	cpuOutput, _ := executeAndRead(client, cpuCtx, "nproc")
	cpuInfo := fmt.Sprintf("CPU: %s 核心", strings.TrimSpace(cpuOutput))

	// 3. 检查磁盘
	diskCtx, diskCancel := context.WithTimeout(ctx, 5*time.Second)
	defer diskCancel()
	diskOutput, _ := executeAndRead(client, diskCtx, "df -h / | tail -1 | awk '{print $2, $4, $5}'")
	diskInfo := ""
	diskOK := true
	diskStr := strings.TrimSpace(diskOutput)
	if parts := strings.Fields(diskStr); len(parts) >= 3 {
		diskInfo = fmt.Sprintf("磁盘: %s 总计, %s 可用, 使用率 %s", parts[0], parts[1], parts[2])
		usageStr := strings.TrimSuffix(parts[2], "%")
		if usage, err := strconv.Atoi(usageStr); err == nil && usage > 90 {
			diskOK = false
			diskInfo += " ⚠️ 磁盘使用率超过 90%"
		}
	}

	// 4. 检查操作系统
	osCtx, osCancel := context.WithTimeout(ctx, 5*time.Second)
	defer osCancel()
	osOutput, _ := executeAndRead(client, osCtx, "cat /etc/os-release 2>/dev/null | grep PRETTY_NAME | cut -d= -f2 | tr -d '\"' || uname -a")
	osInfo := "OS: " + strings.TrimSpace(osOutput)

	// 组装详情
	parts := []string{osInfo, cpuInfo}
	if memInfo != "" {
		parts = append(parts, memInfo)
	}
	if diskInfo != "" {
		parts = append(parts, diskInfo)
	}

	detail := strings.Join(parts, " | ")

	if !memOK || !diskOK {
		return failedItem("D9", "系统资源", detail,
			time.Since(start).Milliseconds(),
			[]FixSuggestion{
				{Level: "warning", Title: "系统资源不足", Description: "服务器资源不满足运行需求，建议升级配置", Command: "free -m && df -h"},
			},
			"free -m && df -h && nproc")
	}

	return passedItem("D9", "系统资源", detail, time.Since(start).Milliseconds())
}
