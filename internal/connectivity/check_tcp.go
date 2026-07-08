package connectivity

import (
	"fmt"
	"net"
	"strings"
	"time"
)

// diagnoseTCP D2: TCP 连通性检查
func diagnoseTCP(host string, port int) DiagnosticItem {
	start := time.Now()

	conn, err := rawTCPDial(host, port, 5*time.Second)
	if err != nil {
		errStr := err.Error()
		duration := time.Since(start).Milliseconds()
		var fixes []FixSuggestion

		switch {
		case strings.Contains(errStr, "connection refused"):
			fixes = []FixSuggestion{
				{Level: "critical", Title: "检查 SSH 服务是否启动", Description: fmt.Sprintf("端口 %d 连接被拒绝，SSH 服务可能未启动", port), Command: "systemctl status sshd"},
				{Level: "warning", Title: "确认端口号是否正确", Description: fmt.Sprintf("确认目标端口 %d 是否为 SSH 服务端口", port), Command: "ss -tlnp | grep " + fmt.Sprintf("%d", port)},
			}
		case strings.Contains(errStr, "timeout"):
			fixes = []FixSuggestion{
				{Level: "critical", Title: "防火墙策略拦截", Description: fmt.Sprintf("到 %s:%d 的连接超时，可能被防火墙拦截", host, port), Command: "iptables -L -n | grep " + fmt.Sprintf("%d", port)},
				{Level: "warning", Title: "云安全组检查", Description: "云服务器需检查安全组入站规则是否开放了端口 " + fmt.Sprintf("%d", port), Command: ""},
				{Level: "info", Title: "SELinux 检查", Description: "如果启用 SELinux，可能阻止了连接", Command: "ausearch -m avc -ts recent"},
			}
		case strings.Contains(errStr, "no route to host"):
			fixes = []FixSuggestion{
				{Level: "critical", Title: "网络不可达", Description: "无法路由到目标主机，检查网络配置", Command: "ping -c 3 " + host},
				{Level: "warning", Title: "路由表检查", Description: "检查本地路由表", Command: "ip route | grep default"},
			}
		default:
			fixes = []FixSuggestion{
				{Level: "warning", Title: "连接异常", Description: errStr, Command: "curl --connect-timeout 3 -v telnet://" + net.JoinHostPort(host, fmt.Sprintf("%d", port))},
			}
		}

		return failedItem("D2", "TCP 连通性", fmt.Sprintf("无法连接到 %s:%d — %s", host, port, errStr),
			duration, fixes, "curl --connect-timeout 3 -v telnet://"+net.JoinHostPort(host, fmt.Sprintf("%d", port)))
	}
	conn.Close()

	return passedItem("D2", "TCP 连通性",
		fmt.Sprintf("成功连接到 %s:%d (RTT: %dms)", host, port, time.Since(start).Milliseconds()),
		time.Since(start).Milliseconds())
}
