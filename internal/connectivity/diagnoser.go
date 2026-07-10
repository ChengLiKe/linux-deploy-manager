package connectivity

import (
	"fmt"
	"net"
	"time"

	"github.com/linux-deploy-manager/internal/model"
	"github.com/linux-deploy-manager/internal/repository"
	"github.com/linux-deploy-manager/internal/remote/sshclient"
)

// DiagnoseOptions 诊断选项
type DiagnoseOptions struct {
	CodeDir string // 部署代码目录（用于 D6 文件系统检查）
	GitURL  string // Git 仓库 URL（用于 D8 网络检查）
}

// skipRule 定义诊断项的跳过规则
type skipRule struct {
	dependsOn string          // 依赖的诊断项 ID
	skipWhen  func(string) bool // 当依赖项状态匹配此条件时跳过
}

// DiagnosticStep 诊断步骤
type DiagnosticStep struct {
	ID   string
	Name string
	Skip *skipRule
	Run  func(report *ConnectivityReport) DiagnosticItem
}

// ConnectivityDiagnoser 连通性诊断器
type ConnectivityDiagnoser struct {
	repo    repository.ServerNodeRepository
	keyRepo repository.KeyRepository
}

// NewConnectivityDiagnoser 创建连通性诊断器
func NewConnectivityDiagnoser(repo repository.ServerNodeRepository, keyRepo repository.KeyRepository) *ConnectivityDiagnoser {
	return &ConnectivityDiagnoser{repo: repo, keyRepo: keyRepo}
}

// Diagnose 执行完整诊断流程
func (d *ConnectivityDiagnoser) Diagnose(nodeID uint, opts *DiagnoseOptions) (*ConnectivityReport, error) {
	node, err := d.repo.Get(nodeID)
	if err != nil {
		return nil, fmt.Errorf("get node: %w", err)
	}

	report := &ConnectivityReport{
		NodeID:    nodeID,
		NodeName:  node.Name,
		Host:      node.Host,
		Port:      node.Port,
		User:      node.User,
		AuthType:  node.AuthType,
		StartTime: time.Now(),
	}

	if opts == nil {
		opts = &DiagnoseOptions{}
	}

	hostIsIP := net.ParseIP(node.Host) != nil

	// 只有认证通过后才创建 SSH 客户端（给后续诊断项复用）
	var sshClient *sshclient.Client

	steps := []DiagnosticStep{
		{
			ID: "D1", Name: "DNS 解析",
			Run: func(r *ConnectivityReport) DiagnosticItem {
				return diagnoseDNS(node.Host, hostIsIP)
			},
		},
		{
			ID: "D2", Name: "TCP 连通性",
			Skip: &skipRule{
				dependsOn: "D1",
				skipWhen:  func(s string) bool { return s == "skip" && hostIsIP },
			},
			Run: func(r *ConnectivityReport) DiagnosticItem {
				return diagnoseTCP(node.Host, node.Port)
			},
		},
		{
			ID: "D3", Name: "SSH 协议协商",
			Skip: &skipRule{
				dependsOn: "D2",
				skipWhen:  func(s string) bool { return s != "pass" },
			},
			Run: func(r *ConnectivityReport) DiagnosticItem {
				return diagnoseSSHProtocol(node.Host, node.Port)
			},
		},
		{
			ID: "D4", Name: "认证检测",
			Skip: &skipRule{
				dependsOn: "D3",
				skipWhen:  func(s string) bool { return s != "pass" },
			},
			Run: func(r *ConnectivityReport) DiagnosticItem {
				client, err := d.createSSHClient(node)
				sshClient = client
				return d.diagnoseAuth(node, client, err)
			},
		},
	}

	// 仅 D4 通过时才添加登录后诊断步骤
	loginSteps := []DiagnosticStep{
		{
			ID: "D5", Name: "Shell 可用性",
			Skip: &skipRule{
				dependsOn: "D4",
				skipWhen:  func(s string) bool { return s != "pass" },
			},
			Run: func(r *ConnectivityReport) DiagnosticItem {
				return diagnoseShell(sshClient, node.User)
			},
		},
		{
			ID: "D6", Name: "文件系统权限",
			Skip: &skipRule{
				dependsOn: "D4",
				skipWhen:  func(s string) bool { return s != "pass" },
			},
			Run: func(r *ConnectivityReport) DiagnosticItem {
				return diagnoseFilesystem(sshClient, opts.CodeDir)
			},
		},
		{
			ID: "D7", Name: "密钥分发检查",
			Skip: &skipRule{
				dependsOn: "D4",
				skipWhen:  func(s string) bool { return s != "pass" },
			},
			Run: func(r *ConnectivityReport) DiagnosticItem {
				return diagnoseKeyDistribution(sshClient, node)
			},
		},
		{
			ID: "D8", Name: "代理/网络环境",
			Skip: &skipRule{
				dependsOn: "D4",
				skipWhen:  func(s string) bool { return s != "pass" },
			},
			Run: func(r *ConnectivityReport) DiagnosticItem {
				return diagnoseNetwork(sshClient, opts.GitURL)
			},
		},
		{
			ID: "D9", Name: "系统资源",
			Skip: &skipRule{
				dependsOn: "D4",
				skipWhen:  func(s string) bool { return s != "pass" },
			},
			Run: func(r *ConnectivityReport) DiagnosticItem {
				return diagnoseSystemResources(sshClient)
			},
		},
	}
	steps = append(steps, loginSteps...)

	// 按序执行
	for _, step := range steps {
		if step.Skip != nil {
			depStatus := report.getItemStatus(step.Skip.dependsOn)
			if step.Skip.skipWhen(depStatus) {
				report.Items = append(report.Items, skippedItem(step.ID, step.Name,
					fmt.Sprintf("因 %s (%s) 跳过", step.Skip.dependsOn, depStatus)))
				continue
			}
		}
		item := step.Run(report)
		report.Items = append(report.Items, item)
	}

	// 关闭 SSH 连接（只要 client 已创建就关闭，不论认证是否成功）
	if sshClient != nil {
		sshClient.Close()
	}

	report.Finalize()
	return report, nil
}

// getItemStatus 获取指定 ID 的诊断项状态
func (r *ConnectivityReport) getItemStatus(id string) string {
	for _, item := range r.Items {
		if item.ID == id {
			return item.Status
		}
	}
	return ""
}

// createSSHClient 创建 SSH 客户端（诊断专用，每次新建连接）
func (d *ConnectivityDiagnoser) createSSHClient(node *model.ServerNode) (*sshclient.Client, error) {
	return sshclient.NewClientFromNode(node, d.keyRepo)
}

// rawTCPDial 尝试原始 TCP 连接（用于 D2 诊断）
func rawTCPDial(host string, port int, timeout time.Duration) (net.Conn, error) {
	addr := net.JoinHostPort(host, fmt.Sprintf("%d", port))
	return net.DialTimeout("tcp", addr, timeout)
}

// readSSHBanner 读取 SSH 服务 banner（用于 D3 诊断）
func readSSHBanner(host string, port int, timeout time.Duration) (string, error) {
	conn, err := rawTCPDial(host, port, timeout)
	if err != nil {
		return "", err
	}
	defer conn.Close()

	buf := make([]byte, 255)
	conn.SetReadDeadline(time.Now().Add(timeout))
	n, err := conn.Read(buf)
	if err != nil {
		return "", fmt.Errorf("读取 banner 失败: %w", err)
	}
	return string(buf[:n]), nil
}
