package service

import (
	"context"
	"encoding/base64"
	"fmt"
	"os"
	"time"

	"github.com/linux-deploy-manager/internal/model"
	"github.com/linux-deploy-manager/internal/remote/sshclient"
	"github.com/linux-deploy-manager/internal/repository"
)

// FixService 一键修复服务
type FixService struct {
	serverNodeRepo repository.ServerNodeRepository
	keyRepo        repository.KeyRepository
}

// NewFixService 创建修复服务
func NewFixService(serverNodeRepo repository.ServerNodeRepository, keyRepo repository.KeyRepository) *FixService {
	return &FixService{serverNodeRepo: serverNodeRepo, keyRepo: keyRepo}
}

// AutoFixRequest 一键修复请求
type AutoFixRequest struct {
	NodeID  uint   `json:"node_id" binding:"required"`
	FixType string `json:"fix_type" binding:"required"` // fix_ssh_permissions / setup_authorized_keys
}

// AutoFixResult 修复结果
type AutoFixResult struct {
	FixType string `json:"fix_type"`
	Success bool   `json:"success"`
	Message string `json:"message"`
	Output  string `json:"output,omitempty"`
}

// ExecuteFix 执行一键修复
func (s *FixService) ExecuteFix(nodeID uint, fixType string) (*AutoFixResult, error) {
	node, err := s.serverNodeRepo.Get(nodeID)
	if err != nil {
		return nil, fmt.Errorf("获取节点失败: %w", err)
	}

	client, err := s.createSSHClient(node)
	if err != nil {
		return &AutoFixResult{
			FixType: fixType,
			Success: false,
			Message: fmt.Sprintf("SSH 连接失败，无法执行远程修复: %s", err.Error()),
		}, nil
	}
	defer client.Close()

	switch fixType {
	case "fix_ssh_permissions":
		return s.fixSSHPermissions(client), nil
	case "setup_authorized_keys":
		return s.setupAuthorizedKeys(client, node), nil
	default:
		return &AutoFixResult{
			FixType: fixType,
			Success: false,
			Message: fmt.Sprintf("不支持的修复类型: %s", fixType),
		}, nil
	}
}

// fixSSHPermissions 修复 SSH 目录和文件权限
func (s *FixService) fixSSHPermissions(client *sshclient.Client) *AutoFixResult {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	cmds := []struct {
		desc string
		cmd  string
	}{
		{"设置 ~/.ssh 权限为 700", "chmod 700 ~/.ssh"},
		{"设置 authorized_keys 权限为 600", "chmod 600 ~/.ssh/authorized_keys 2>/dev/null; true"},
		{"设置密钥文件权限为 600", "chmod 600 ~/.ssh/id_* ~/.ssh/*.key ~/.ssh/*.pem 2>/dev/null; true"},
	}

	allOutput := ""
	for _, c := range cmds {
		stdout, _, done, err := client.Execute(ctx, c.cmd)
		if err != nil {
			return &AutoFixResult{
				FixType: "fix_ssh_permissions",
				Success: false,
				Message: fmt.Sprintf("%s 失败: %s", c.desc, err.Error()),
			}
		}
		execErr := <-done
		_ = execErr
		allOutput += fmt.Sprintf("[%s] 执行完成\n", c.desc)
		_ = stdout
	}

	return &AutoFixResult{
		FixType: "fix_ssh_permissions",
		Success: true,
		Message: "SSH 目录和文件权限已修复",
		Output:  allOutput,
	}
}

// setupAuthorizedKeys 将公钥添加到远程 authorized_keys
func (s *FixService) setupAuthorizedKeys(client *sshclient.Client, node *model.ServerNode) *AutoFixResult {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	if node.ServerKeyID == nil {
		return &AutoFixResult{
			FixType: "setup_authorized_keys",
			Success: false,
			Message: "节点未配置服务器密钥，无法设置 authorized_keys",
		}
	}

	key, err := s.keyRepo.Get(*node.ServerKeyID)
	if err != nil {
		return &AutoFixResult{
			FixType: "setup_authorized_keys",
			Success: false,
			Message: fmt.Sprintf("获取密钥失败: %s", err.Error()),
		}
	}

	pubKeyData, err := os.ReadFile(key.PrivatePath + ".pub")
	if err != nil {
		return &AutoFixResult{
			FixType: "setup_authorized_keys",
			Success: false,
			Message: fmt.Sprintf("读取公钥文件失败: %s", err.Error()),
		}
	}

	pubKeyStr := string(pubKeyData)

	// 1. 确保 .ssh 目录存在
	_, _, done1, err1 := client.Execute(ctx, "mkdir -p ~/.ssh && chmod 700 ~/.ssh")
	if err1 != nil {
		return &AutoFixResult{
			FixType: "setup_authorized_keys",
			Success: false,
			Message: fmt.Sprintf("创建 .ssh 目录失败: %s", err1.Error()),
		}
	}
	<-done1

	// 2. 检查公钥是否已存在
	checkCmd := fmt.Sprintf("grep -qF '%s' ~/.ssh/authorized_keys 2>/dev/null && echo 'EXISTS' || echo 'NOT_FOUND'", pubKeyStr)
	checkOut, _, checkDone, checkErr := client.Execute(ctx, checkCmd)
	if checkErr == nil {
		<-checkDone
		// 读取 checkOut 内容
		buf := make([]byte, 32)
		n, _ := checkOut.Read(buf)
		result := string(buf[:n])
		if result == "EXISTS\n" || result == "EXISTS" {
			return &AutoFixResult{
				FixType: "setup_authorized_keys",
				Success: true,
				Message: "公钥已存在于 authorized_keys，无需重复添加",
			}
		}
	}

	// 3. 通过 base64 编码安全写入公钥
	encoded := base64.StdEncoding.EncodeToString(pubKeyData)
	addCmd := fmt.Sprintf("echo '%s' | base64 -d >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys", encoded)
	_, _, addDone, addErr := client.Execute(ctx, addCmd)
	if addErr != nil {
		return &AutoFixResult{
			FixType: "setup_authorized_keys",
			Success: false,
			Message: fmt.Sprintf("添加公钥到 authorized_keys 失败: %s", addErr.Error()),
		}
	}
	<-addDone

	return &AutoFixResult{
		FixType: "setup_authorized_keys",
		Success: true,
		Message: "公钥已成功添加到 authorized_keys",
	}
}

// createSSHClient 创建 SSH 连接
func (s *FixService) createSSHClient(node *model.ServerNode) (*sshclient.Client, error) {
	return sshclient.NewClientFromNode(node, node.Password, s.keyRepo)
}
