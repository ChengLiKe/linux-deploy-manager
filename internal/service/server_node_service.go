package service

import (
	"context"
	"encoding/base64"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/linux-deploy-manager/internal/crypto"
	"github.com/linux-deploy-manager/internal/model"
	"github.com/linux-deploy-manager/internal/remote/sshclient"
	"github.com/linux-deploy-manager/internal/repository"
	"github.com/linux-deploy-manager/internal/sysutil"
)

// ServerNodeService 服务器节点服务
type ServerNodeService struct {
	repo      repository.ServerNodeRepository
	keyRepo   repository.KeyRepository
	sshPool   *sshclient.Pool
}

// NewServerNodeService 创建服务器节点服务
func NewServerNodeService(repo repository.ServerNodeRepository, keyRepo repository.KeyRepository, sshPool *sshclient.Pool) *ServerNodeService {
	return &ServerNodeService{repo: repo, keyRepo: keyRepo, sshPool: sshPool}
}

// CreateServerNodeRequest 创建服务器节点请求
type CreateServerNodeRequest struct {
	Name        string `json:"name" binding:"required,min=1,max=50"`
	Host        string `json:"host" binding:"required"`
	Port        int    `json:"port" binding:"min=1,max=65535"`
	User        string `json:"user" binding:"required"`
	AuthType    string `json:"auth_type" binding:"required,oneof=key password"`
	ServerKeyID *uint  `json:"server_key_id"`
	Password    string `json:"password"`
	Description string `json:"description" binding:"max=500"`
}

// Create 创建服务器节点
func (s *ServerNodeService) Create(req *CreateServerNodeRequest) (*model.ServerNode, error) {
	if req.Port == 0 {
		req.Port = 22
	}
	if req.User == "" {
		req.User = "root"
	}

	node := &model.ServerNode{
		Name:        req.Name,
		Host:        req.Host,
		Port:        req.Port,
		User:        req.User,
		AuthType:    req.AuthType,
		ServerKeyID: req.ServerKeyID,
		Description: req.Description,
		Status:      "unknown",
	}
	if req.AuthType == "password" && req.Password != "" {
		encrypted, err := crypto.Encrypt([]byte(req.Password))
		if err != nil {
			return nil, fmt.Errorf("encrypt password: %w", err)
		}
		node.Password = encrypted
	}
	if err := s.repo.Create(node); err != nil {
		return nil, fmt.Errorf("create server node: %w", err)
	}
	return node, nil
}

// Get 获取服务器节点
func (s *ServerNodeService) Get(id uint) (*model.ServerNode, error) {
	return s.repo.Get(id)
}

// List 列出所有服务器节点
func (s *ServerNodeService) List() ([]model.ServerNode, error) {
	return s.repo.List()
}

// UpdateServerNodeRequest 更新服务器节点请求
type UpdateServerNodeRequest struct {
	Name        string `json:"name" binding:"required,min=1,max=50"`
	Host        string `json:"host" binding:"required"`
	Port        int    `json:"port" binding:"min=1,max=65535"`
	User        string `json:"user" binding:"required"`
	AuthType    string `json:"auth_type" binding:"required,oneof=key password"`
	ServerKeyID *uint  `json:"server_key_id"`
	Password    string `json:"password"`
	Description string `json:"description" binding:"max=500"`
}

// Update 更新服务器节点
func (s *ServerNodeService) Update(id uint, req *UpdateServerNodeRequest) (*model.ServerNode, error) {
	node, err := s.repo.Get(id)
	if err != nil {
		return nil, err
	}
	node.Name = req.Name
	node.Host = req.Host
	node.Port = req.Port
	node.User = req.User
	node.AuthType = req.AuthType
	node.ServerKeyID = req.ServerKeyID
	if req.Password != "" {
		encrypted, err := crypto.Encrypt([]byte(req.Password))
		if err != nil {
			return nil, fmt.Errorf("encrypt password: %w", err)
		}
		node.Password = encrypted
	}
	node.Description = req.Description
	if err := s.repo.Update(node); err != nil {
		return nil, fmt.Errorf("update server node: %w", err)
	}
	return node, nil
}

// Delete 删除服务器节点
func (s *ServerNodeService) Delete(id uint) error {
	count, err := s.repo.CountProjects(id)
	if err != nil {
		return fmt.Errorf("count projects: %w", err)
	}
	if count > 0 {
		return fmt.Errorf("该节点正被 %d 个项目使用，无法删除", count)
	}
	return s.repo.Delete(id)
}

// TestConnection 测试 SSH 连通性
func (s *ServerNodeService) TestConnection(id uint) (*model.ServerNode, error) {
	node, err := s.repo.Get(id)
	if err != nil {
		return nil, err
	}

	client, err := s.createSSHClient(node)
	if err != nil {
		node.Status = "offline"
		now := time.Now()
		node.LastCheckAt = &now
		_ = s.repo.Update(node)
		return node, fmt.Errorf("ssh connect failed: %w", err)
	}
	defer client.Close()

	// 执行简单命令测试
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	stdout, _, done, err := client.Execute(ctx, "echo 'connected'")
	if err != nil {
		node.Status = "offline"
		now := time.Now()
		node.LastCheckAt = &now
		_ = s.repo.Update(node)
		return node, fmt.Errorf("execute test command failed: %w", err)
	}
	<-done
	_ = stdout

	node.Status = "online"
	now := time.Now()
	node.LastCheckAt = &now
	if err := s.repo.Update(node); err != nil {
		return node, fmt.Errorf("update node status: %w", err)
	}
	return node, nil
}

// DistributeKeyRequest 下发密钥请求
type DistributeKeyRequest struct {
	KeyID uint `json:"key_id" binding:"required"`
}

// DistributeKey 将 Git 密钥下发到目标服务器
func (s *ServerNodeService) DistributeKey(id uint, req *DistributeKeyRequest) error {
	node, err := s.repo.Get(id)
	if err != nil {
		return err
	}

	key, err := s.keyRepo.Get(req.KeyID)
	if err != nil {
		return fmt.Errorf("get key: %w", err)
	}
	if key.KeyType != "git" {
		return fmt.Errorf("key %s is not a git key", key.Name)
	}

	privateKeyData, err := os.ReadFile(key.PrivatePath)
	if err != nil {
		return fmt.Errorf("read private key: %w", err)
	}
	publicKeyData, err := os.ReadFile(key.PrivatePath + ".pub")
	if err != nil {
		return fmt.Errorf("read public key: %w", err)
	}

	client, err := s.createSSHClient(node)
	if err != nil {
		return fmt.Errorf("ssh connect: %w", err)
	}
	defer client.Close()

	ctx := context.Background()

	// 确保 ~/.ssh 目录存在
	if err := s.runRemoteCommand(ctx, client, "mkdir -p ~/.ssh && chmod 700 ~/.ssh"); err != nil {
		return fmt.Errorf("ensure .ssh dir: %w", err)
	}

	// 写入私钥和公钥
	keyName := sanitizeKeyName(key.Name)
	privatePath := fmt.Sprintf("~/.ssh/%s", keyName)
	publicPath := fmt.Sprintf("~/.ssh/%s.pub", keyName)

	if err := s.writeRemoteFile(ctx, client, privatePath, string(privateKeyData), 0600); err != nil {
		return fmt.Errorf("write private key: %w", err)
	}
	if err := s.writeRemoteFile(ctx, client, publicPath, string(publicKeyData), 0644); err != nil {
		return fmt.Errorf("write public key: %w", err)
	}

	return nil
}

func (s *ServerNodeService) runRemoteCommand(ctx context.Context, client *sshclient.Client, command string) error {
	stdout, stderr, done, err := client.Execute(ctx, command)
	if err != nil {
		return err
	}
	_ = stdout
	_ = stderr
	return <-done
}

func (s *ServerNodeService) writeRemoteFile(ctx context.Context, client *sshclient.Client, remotePath, content string, perm uint32) error {
	encoded := base64.StdEncoding.EncodeToString([]byte(content))
	cmd := fmt.Sprintf("echo '%s' | base64 -d > %s && chmod %o %s", encoded, sysutil.ShellEscape(remotePath), perm, sysutil.ShellEscape(remotePath))
	return s.runRemoteCommand(ctx, client, cmd)
}

func sanitizeKeyName(name string) string {
	// 替换空格和特殊字符为下划线
	replacer := strings.NewReplacer(" ", "_", "/", "_", "\\", "_", ":", "_")
	return replacer.Replace(name)
}

// createSSHClient 创建 SSH 客户端
func (s *ServerNodeService) createSSHClient(node *model.ServerNode) (*sshclient.Client, error) {
	password := node.Password
	if password != "" && node.AuthType == "password" {
		decrypted, err := crypto.Decrypt(password)
		if err == nil {
			password = string(decrypted)
		}
	}
	return sshclient.NewClientFromNode(node, password, s.keyRepo)
}

