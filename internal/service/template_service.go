package service

import (
	"context"
	"fmt"
	"os"
	"time"

	"github.com/linux-deploy-manager/internal/deployer"
	"github.com/linux-deploy-manager/internal/git"
	"github.com/linux-deploy-manager/internal/model"
	"github.com/linux-deploy-manager/internal/remote"
	"github.com/linux-deploy-manager/internal/remote/sshclient"
	"github.com/linux-deploy-manager/internal/repository"
)

// TemplateService 模板服务
type TemplateService struct {
	repo           repository.TemplateRepository
	keyRepo        repository.KeyRepository
	taskRepo       repository.TaskRepository
	serverNodeRepo repository.ServerNodeRepository
	sshPool        *sshclient.Pool
	gitService     git.Service
}

// NewTemplateService 创建模板服务
func NewTemplateService(repo repository.TemplateRepository, keyRepo repository.KeyRepository, taskRepo repository.TaskRepository, serverNodeRepo repository.ServerNodeRepository, sshPool *sshclient.Pool, gitService git.Service) *TemplateService {
	return &TemplateService{repo: repo, keyRepo: keyRepo, taskRepo: taskRepo, serverNodeRepo: serverNodeRepo, sshPool: sshPool, gitService: gitService}
}

// CreateTemplateRequest 创建模板请求
type CreateTemplateRequest struct {
	Name            string `json:"name" binding:"required,min=2,max=50"`
	Description     string `json:"description" binding:"max=500"`
	GitURL          string `json:"git_url" binding:"required"`
	SSHKeyID        uint   `json:"ssh_key_id" binding:"required"`
	ServerNodeID    *uint  `json:"server_node_id"`
	CodeDir         string `json:"code_dir" binding:"required"`
	DeployDir       string `json:"deploy_dir"`
	EnvFormat       string `json:"env_format" binding:"omitempty,oneof=dotenv json yaml plain"`
	EnvContent      string `json:"env_content"`
	DeployMode      string `json:"deploy_mode" binding:"required,oneof=local container"`
	PreCmd          string `json:"pre_cmd"`
	DeployCmd       string `json:"deploy_cmd"`
	PostCmd         string `json:"post_cmd"`
	TimeoutSec      int    `json:"timeout_sec"`
	ContainerConfig string `json:"container_config"`
	LocalConfig     string `json:"local_config"`
}

// Create 创建模板
func (s *TemplateService) Create(req *CreateTemplateRequest) (*model.Template, error) {
	if req.EnvFormat == "" {
		req.EnvFormat = "dotenv"
	}
	if req.TimeoutSec == 0 {
		req.TimeoutSec = 600
	}

	// 验证密钥存在
	if _, err := s.keyRepo.Get(req.SSHKeyID); err != nil {
		return nil, fmt.Errorf("ssh key not found: %w", err)
	}

	// 规范化 server_node_id: 0 视为 nil（本地部署）
	serverNodeID := req.ServerNodeID
	if serverNodeID != nil && *serverNodeID == 0 {
		serverNodeID = nil
	}

	t := &model.Template{
		Name:            req.Name,
		Description:     req.Description,
		GitURL:          req.GitURL,
		SSHKeyID:        req.SSHKeyID,
		ServerNodeID:    serverNodeID,
		CodeDir:         req.CodeDir,
		DeployDir:       req.DeployDir,
		EnvFormat:       req.EnvFormat,
		EnvContent:      req.EnvContent,
		DeployMode:      req.DeployMode,
		PreCmd:          req.PreCmd,
		DeployCmd:       req.DeployCmd,
		PostCmd:         req.PostCmd,
		TimeoutSec:      req.TimeoutSec,
		ContainerConfig: req.ContainerConfig,
		LocalConfig:     req.LocalConfig,
		Status:          "draft",
	}
	if err := s.repo.Create(t); err != nil {
		return nil, fmt.Errorf("create template: %w", err)
	}
	return t, nil
}

// Get 获取模板
func (s *TemplateService) Get(id uint) (*model.Template, error) {
	return s.repo.Get(id)
}

// GetWithLatestTask 获取模板及最新成功任务
func (s *TemplateService) GetWithLatestTask(id uint) (*model.Template, *model.DeployTask, error) {
	t, err := s.repo.Get(id)
	if err != nil {
		return nil, nil, err
	}
	latest, err := s.taskRepo.GetLatestByTemplate(id, "success")
	if err != nil {
		return nil, nil, err
	}
	return t, latest, nil
}

// List 列出模板
func (s *TemplateService) List(page, pageSize int, status string) ([]model.Template, int64, error) {
	return s.repo.List(page, pageSize, status)
}

// TemplateWithLatestTask 模板及最新任务（用于列表展示）
type TemplateWithLatestTask struct {
	Template *model.Template `json:"template"`
	LatestTask *model.DeployTask `json:"latest_task"`
}

// ListWithLatestTask 列出模板并附带最新一条任务
func (s *TemplateService) ListWithLatestTask(page, pageSize int, status string) ([]*TemplateWithLatestTask, int64, error) {
	templates, total, err := s.repo.List(page, pageSize, status)
	if err != nil {
		return nil, 0, err
	}
	result := make([]*TemplateWithLatestTask, 0, len(templates))
	for _, t := range templates {
		latest, err := s.taskRepo.GetLatestByTemplate(t.ID, "")
		if err != nil {
			return nil, 0, err
		}
		result = append(result, &TemplateWithLatestTask{
			Template:   &t,
			LatestTask: latest,
		})
	}
	return result, total, nil
}

// Update 更新模板
func (s *TemplateService) Update(id uint, req *CreateTemplateRequest) (*model.Template, error) {
	t, err := s.repo.Get(id)
	if err != nil {
		return nil, err
	}

	// 更新字段
	if req.Name != "" {
		t.Name = req.Name
	}
	if req.Description != "" || req.Description == "" {
		t.Description = req.Description
	}
	if req.GitURL != "" {
		t.GitURL = req.GitURL
	}
	if req.SSHKeyID > 0 {
		t.SSHKeyID = req.SSHKeyID
	}
	// ServerNodeID: 如果请求体显式传了 null，则清空；如果传了正数，则更新
	if req.ServerNodeID != nil {
		if *req.ServerNodeID == 0 {
			t.ServerNodeID = nil
		} else {
			t.ServerNodeID = req.ServerNodeID
		}
	}
	if req.CodeDir != "" {
		t.CodeDir = req.CodeDir
	}
	if req.DeployDir != "" || req.DeployDir == "" {
		t.DeployDir = req.DeployDir
	}
	if req.EnvFormat != "" {
		t.EnvFormat = req.EnvFormat
	}
	if req.EnvContent != "" || req.EnvContent == "" {
		t.EnvContent = req.EnvContent
	}
	if req.DeployMode != "" {
		t.DeployMode = req.DeployMode
	}
	if req.PreCmd != "" || req.PreCmd == "" {
		t.PreCmd = req.PreCmd
	}
	if req.DeployCmd != "" || req.DeployCmd == "" {
		t.DeployCmd = req.DeployCmd
	}
	if req.PostCmd != "" || req.PostCmd == "" {
		t.PostCmd = req.PostCmd
	}
	if req.TimeoutSec > 0 {
		t.TimeoutSec = req.TimeoutSec
	}
	if req.ContainerConfig != "" || req.ContainerConfig == "" {
		t.ContainerConfig = req.ContainerConfig
	}
	if req.LocalConfig != "" || req.LocalConfig == "" {
		t.LocalConfig = req.LocalConfig
	}

	if err := s.repo.Update(t); err != nil {
		return nil, fmt.Errorf("update template: %w", err)
	}
	return t, nil
}

// Delete 删除模板
func (s *TemplateService) Delete(id uint) error {
	return s.repo.Delete(id)
}

// Clone 复制模板
func (s *TemplateService) Clone(id uint, name string) (*model.Template, error) {
	orig, err := s.repo.Get(id)
	if err != nil {
		return nil, err
	}

	clone := &model.Template{
		Name:            name,
		Description:     orig.Description,
		GitURL:          orig.GitURL,
		SSHKeyID:        orig.SSHKeyID,
		ServerNodeID:    orig.ServerNodeID,
		CodeDir:         orig.CodeDir,
		DeployDir:       orig.DeployDir,
		EnvFormat:       orig.EnvFormat,
		EnvContent:      orig.EnvContent,
		DeployMode:      orig.DeployMode,
		PreCmd:          orig.PreCmd,
		DeployCmd:       orig.DeployCmd,
		PostCmd:         orig.PostCmd,
		TimeoutSec:      orig.TimeoutSec,
		ContainerConfig: orig.ContainerConfig,
		LocalConfig:     orig.LocalConfig,
		Status:          "draft",
	}
	if err := s.repo.Create(clone); err != nil {
		return nil, fmt.Errorf("create clone: %w", err)
	}
	return clone, nil
}

// Branches 获取远程分支
func (s *TemplateService) Branches(id uint) ([]string, error) {
	t, err := s.repo.Get(id)
	if err != nil {
		return nil, fmt.Errorf("get template: %w", err)
	}

	key, err := s.keyRepo.Get(t.SSHKeyID)
	if err != nil {
		return nil, fmt.Errorf("get ssh key: %w", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	var branchList []git.Branch

	if t.ServerNodeID != nil && *t.ServerNodeID > 0 {
		// 远程模板：通过 SSH 在目标服务器上执行 git ls-remote
		node, err := s.serverNodeRepo.Get(*t.ServerNodeID)
		if err != nil {
			return nil, fmt.Errorf("get server node: %w", err)
		}
		if node.Status != "online" {
			return nil, fmt.Errorf("目标服务器 %s 离线，无法获取分支", node.Name)
		}

		client, err := s.sshPool.GetOrCreate(node.ID, func() (*sshclient.Client, error) {
			return s.createSSHClient(node)
		})
		if err != nil {
			return nil, fmt.Errorf("connect to server: %w", err)
		}

		executor := deployer.NewRemoteExecutor(client, t.TimeoutSec)
		gitService := remote.NewGitService(executor)
		branchList, err = gitService.ListBranches(ctx, t.GitURL, key.PrivatePath)
		if err != nil {
			return nil, fmt.Errorf("list branches: %w", err)
		}
	} else {
		// 本地模板
		branchList, err = s.gitService.ListBranches(ctx, t.GitURL, key.PrivatePath)
		if err != nil {
			return nil, fmt.Errorf("list branches: %w", err)
		}
	}

	names := make([]string, len(branchList))
	for i, b := range branchList {
		names[i] = b.Name
	}
	return names, nil
}

// createSSHClient 根据服务器节点配置创建 SSH 客户端
func (s *TemplateService) createSSHClient(node *model.ServerNode) (*sshclient.Client, error) {
	ctx := context.Background()
	var client *sshclient.Client
	var err error

	switch node.AuthType {
	case "key":
		if node.ServerKeyID == nil {
			return nil, fmt.Errorf("server node %s: key auth but no server_key_id", node.Name)
		}
		key, err := s.keyRepo.Get(*node.ServerKeyID)
		if err != nil {
			return nil, fmt.Errorf("get server key: %w", err)
		}
		privateKeyData, err := os.ReadFile(key.PrivatePath)
		if err != nil {
			return nil, fmt.Errorf("read private key: %w", err)
		}
		client, err = sshclient.NewClientWithKey(node.Host, node.Port, node.User, privateKeyData)
		if err != nil {
			return nil, err
		}
	case "password":
		client, err = sshclient.NewClientWithPassword(node.Host, node.Port, node.User, node.Password)
		if err != nil {
			return nil, err
		}
	default:
		return nil, fmt.Errorf("unsupported auth type: %s", node.AuthType)
	}

	if err := client.Connect(ctx); err != nil {
		return nil, fmt.Errorf("ssh connect: %w", err)
	}
	return client, nil
}
