package connectivity

import (
	"fmt"
	"strings"
	"time"

	"github.com/linux-deploy-manager/internal/model"
	"github.com/linux-deploy-manager/internal/remote/sshclient"
)

// diagnoseAuth D4: 认证检测
func (d *ConnectivityDiagnoser) diagnoseAuth(node *model.ServerNode, client *sshclient.Client, err error) DiagnosticItem {
	start := time.Now()

	if err != nil {
		errStr := err.Error()
		var fixes []FixSuggestion

		switch {
		case strings.Contains(errStr, "unable to authenticate"):
			fixes = []FixSuggestion{
				{Level: "critical", Title: "SSH 认证失败", Description: "服务器拒绝了认证请求，请检查认证信息", Command: "ssh -vvv " + node.User + "@" + node.Host + " -p " + fmt.Sprintf("%d", node.Port) + " 2>&1 | tail -20"},
			}
			if node.AuthType == "key" {
				fixes = append(fixes,
					FixSuggestion{Level: "critical", Title: "检查公钥是否已添加到服务器", Description: "公钥未添加到 ~/.ssh/authorized_keys", Command: "ssh-copy-id -i /path/to/key.pub " + node.User + "@" + node.Host},
					FixSuggestion{Level: "warning", Title: "检查 SSH 服务端配置", Description: "确认服务端允许公钥认证", Command: "grep PubkeyAuthentication /etc/ssh/sshd_config"},
				)
			} else {
				fixes = append(fixes,
					FixSuggestion{Level: "warning", Title: "检查密码认证是否启用", Description: "确认服务端允许密码认证", Command: "grep PasswordAuthentication /etc/ssh/sshd_config"},
					FixSuggestion{Level: "info", Title: "检查用户是否被锁定", Description: "确认用户未被锁定或过期", Command: "passwd -S " + node.User + " || echo '无法在远程执行'"},
				)
			}
		case strings.Contains(errStr, "timeout"):
			fixes = []FixSuggestion{
				{Level: "critical", Title: "认证超时", Description: "SSH 认证尝试超时，可能 PAM 配置导致延迟", Command: "grep -i pam /etc/ssh/sshd_config | grep -v '^#'"},
			}
		default:
			fixes = []FixSuggestion{
				{Level: "warning", Title: "认证失败", Description: errStr, Command: "ssh -vvv " + node.User + "@" + node.Host + " -p " + fmt.Sprintf("%d", node.Port) + " 2>&1 | tail -30"},
			}
		}

		return failedItem("D4", "认证检测",
			fmt.Sprintf("认证失败: %s", errStr),
			time.Since(start).Milliseconds(), fixes,
			"ssh -vvv "+node.User+"@"+node.Host+" -p "+fmt.Sprintf("%d", node.Port)+" 2>&1 | tail -30")
	}

	return passedItem("D4", "认证检测",
		fmt.Sprintf("%s 认证成功，用户: %s", authTypeLabel(node.AuthType), node.User),
		time.Since(start).Milliseconds())
}

func authTypeLabel(authType string) string {
	switch authType {
	case "key":
		return "SSH 密钥"
	case "password":
		return "密码"
	default:
		return authType
	}
}
