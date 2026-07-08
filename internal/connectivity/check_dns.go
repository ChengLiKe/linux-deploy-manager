package connectivity

import (
	"net"
	"strings"
	"time"
)

// diagnoseDNS D1: DNS 解析检查
func diagnoseDNS(host string, hostIsIP bool) DiagnosticItem {
	start := time.Now()

	if hostIsIP {
		return passedItem("D1", "DNS 解析", "主机名为 IP 地址，跳过 DNS 解析", time.Since(start).Milliseconds())
	}

	ips, err := net.LookupHost(host)
	if err != nil {
		errStr := err.Error()
		var fixes []FixSuggestion

		switch {
		case strings.Contains(errStr, "no such host"):
			fixes = []FixSuggestion{
				{Level: "critical", Title: "检查主机名拼写", Description: "域名不存在，请确认主机名是否正确", Command: "nslookup " + host},
				{Level: "info", Title: "检查 /etc/hosts", Description: "如果使用内网主机名，检查 /etc/hosts 是否存在映射", Command: "grep " + host + " /etc/hosts"},
			}
		case strings.Contains(errStr, "timeout"):
			fixes = []FixSuggestion{
				{Level: "critical", Title: "DNS 服务器无响应", Description: "检查 DNS 服务器配置，可尝试公共 DNS (8.8.8.8)", Command: "cat /etc/resolv.conf"},
				{Level: "info", Title: "直接使用 IP 连接", Description: "可使用 IP 地址替代主机名绕过 DNS", Command: ""},
			}
		default:
			fixes = []FixSuggestion{
				{Level: "warning", Title: "DNS 解析异常", Description: "无法解析主机名: " + errStr, Command: "dig " + host + " +short"},
			}
		}

		return failedItem("D1", "DNS 解析", errStr, time.Since(start).Milliseconds(), fixes,
			"dig "+host+" +short || nslookup "+host)
	}

	detail := "解析成功: " + strings.Join(ips, ", ")
	return passedItem("D1", "DNS 解析", detail, time.Since(start).Milliseconds())
}
