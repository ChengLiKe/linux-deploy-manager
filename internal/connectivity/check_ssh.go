package connectivity

import (
	"fmt"
	"strings"
	"time"
)

// diagnoseSSHProtocol D3: SSH 协议协商检查
func diagnoseSSHProtocol(host string, port int) DiagnosticItem {
	start := time.Now()

	banner, err := readSSHBanner(host, port, 5*time.Second)
	if err != nil {
		return failedItem("D3", "SSH 协议协商",
			fmt.Sprintf("读取 SSH banner 失败: %s", err.Error()),
			time.Since(start).Milliseconds(),
			[]FixSuggestion{
				{Level: "critical", Title: "确认端口是否为 SSH 服务", Description: fmt.Sprintf("端口 %d 未返回 SSH 协议标识", port), Command: "nc -v " + host + " " + fmt.Sprintf("%d", port)},
				{Level: "info", Title: "检查端口映射", Description: "确认目标端口是否正确配置为 SSH 服务", Command: "ssh -v -p " + fmt.Sprintf("%d", port) + " " + host + " 2>&1 | grep 'remote software version'"},
			},
			"nc -v "+host+" "+fmt.Sprintf("%d", port))
	}

	// 检查是否以 SSH-2.0 开头
	if !strings.HasPrefix(banner, "SSH-2.0-") && !strings.HasPrefix(banner, "SSH-1.99-") {
		return failedItem("D3", "SSH 协议协商",
			fmt.Sprintf("返回内容不是 SSH 协议: %s", banner),
			time.Since(start).Milliseconds(),
			[]FixSuggestion{
				{Level: "critical", Title: "端口不是 SSH 服务", Description: fmt.Sprintf("端口 %d 返回了非 SSH 协议内容，可能是其他服务占用了该端口", port), Command: "curl -v http://" + host + ":" + fmt.Sprintf("%d", port)},
			},
			"ssh -v root@"+host+" -p "+fmt.Sprintf("%d", port)+" 2>&1 | head -5")
	}

	// 提取 SSH 版本号
	version := strings.TrimPrefix(banner, "SSH-2.0-")
	version = strings.TrimPrefix(version, "SSH-1.99-")

	return passedItem("D3", "SSH 协议协商",
		fmt.Sprintf("服务端: %s, 协议: SSH-2.0", version),
		time.Since(start).Milliseconds())
}
