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

// ProjectService 项目服务
type ProjectService struct {
	repo           repository.ProjectRepository
	keyRepo        repository.KeyRepository
	taskRepo       repository.TaskRepository
	serverNodeRepo repository.ServerNodeRepository
	sshPool        *sshclient.Pool
	gitService     git.Service
}

// NewProjectService 创建项目服务
func NewProjectService(repo repository.ProjectRepository, keyRepo repository.KeyRepository, taskRepo repository.TaskRepository, serverNodeRepo repository.ServerNodeRepository, sshPool *sshclient.Pool, gitService git.Service) *ProjectService {
	return &ProjectService{repo: repo, keyRepo: keyRepo, taskRepo: taskRepo, serverNodeRepo: serverNodeRepo, sshPool: sshPool, gitService: gitService}
}

// CreateProjectRequest 创建项目请求
type CreateProjectRequest struct {
	Name            string `json:"name" binding:"required,min=2,max=50"`
	Description     string `json:"description" binding:"max=500"`
	GitURL          string `json:"git_url" binding:"required"`
	SSHKeyID        uint   `json:"ssh_key_id"`
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

// Create 创建项目
func (s *ProjectService) Create(req *CreateProjectRequest) (*model.Project, error) {
	if req.EnvFormat == "" {
		req.EnvFormat = "dotenv"
	}
	if req.TimeoutSec == 0 {
		req.TimeoutSec = 600
	}

	// 验证密钥存在（仅当指定了密钥时）
	if req.SSHKeyID > 0 {
		if _, err := s.keyRepo.Get(req.SSHKeyID); err != nil {
			return nil, fmt.Errorf("ssh key not found: %w", err)
		}
	}

	// 规范化 server_node_id: 0 视为 nil（本地部署）
	serverNodeID := req.ServerNodeID
	if serverNodeID != nil && *serverNodeID == 0 {
		serverNodeID = nil
	}

	p := &model.Project{
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
	if err := s.repo.Create(p); err != nil {
		return nil, fmt.Errorf("create project: %w", err)
	}
	return p, nil
}

// Get 获取项目
func (s *ProjectService) Get(id uint) (*model.Project, error) {
	return s.repo.Get(id)
}

// GetWithLatestTask 获取项目及最新成功任务
func (s *ProjectService) GetWithLatestTask(id uint) (*model.Project, *model.DeployTask, error) {
	p, err := s.repo.Get(id)
	if err != nil {
		return nil, nil, err
	}
	latest, err := s.taskRepo.GetLatestByProject(id, "success")
	if err != nil {
		return nil, nil, err
	}
	return p, latest, nil
}

// List 列出项目
func (s *ProjectService) List(page, pageSize int, status string) ([]model.Project, int64, error) {
	return s.repo.List(page, pageSize, status)
}

// ProjectWithLatestTask 项目及最新任务（用于列表展示）
type ProjectWithLatestTask struct {
	Project    *model.Project   `json:"project"`
	LatestTask *model.DeployTask `json:"latest_task"`
}

// ListWithLatestTask 列出项目并附带最新一条任务
func (s *ProjectService) ListWithLatestTask(page, pageSize int, status string) ([]*ProjectWithLatestTask, int64, error) {
	projects, total, err := s.repo.List(page, pageSize, status)
	if err != nil {
		return nil, 0, err
	}
	result := make([]*ProjectWithLatestTask, 0, len(projects))
	for _, p := range projects {
		latest, err := s.taskRepo.GetLatestByProject(p.ID, "")
		if err != nil {
			return nil, 0, err
		}
		result = append(result, &ProjectWithLatestTask{
			Project:    &p,
			LatestTask: latest,
		})
	}
	return result, total, nil
}

// Update 更新项目
func (s *ProjectService) Update(id uint, req *CreateProjectRequest) (*model.Project, error) {
	p, err := s.repo.Get(id)
	if err != nil {
		return nil, err
	}

	// 更新字段
	if req.Name != "" {
		p.Name = req.Name
	}
	if req.Description != "" || req.Description == "" {
		p.Description = req.Description
	}
	if req.GitURL != "" {
		p.GitURL = req.GitURL
	}
	if req.SSHKeyID > 0 {
		p.SSHKeyID = req.SSHKeyID
	}
	// ServerNodeID: 如果请求体显式传了 null，则清空；如果传了正数，则更新
	if req.ServerNodeID != nil {
		if *req.ServerNodeID == 0 {
			p.ServerNodeID = nil
		} else {
			p.ServerNodeID = req.ServerNodeID
		}
	}
	if req.CodeDir != "" {
		p.CodeDir = req.CodeDir
	}
	if req.DeployDir != "" || req.DeployDir == "" {
		p.DeployDir = req.DeployDir
	}
	if req.EnvFormat != "" {
		p.EnvFormat = req.EnvFormat
	}
	if req.EnvContent != "" || req.EnvContent == "" {
		p.EnvContent = req.EnvContent
	}
	if req.DeployMode != "" {
		p.DeployMode = req.DeployMode
	}
	if req.PreCmd != "" || req.PreCmd == "" {
		p.PreCmd = req.PreCmd
	}
	if req.DeployCmd != "" || req.DeployCmd == "" {
		p.DeployCmd = req.DeployCmd
	}
	if req.PostCmd != "" || req.PostCmd == "" {
		p.PostCmd = req.PostCmd
	}
	if req.TimeoutSec > 0 {
		p.TimeoutSec = req.TimeoutSec
	}
	if req.ContainerConfig != "" || req.ContainerConfig == "" {
		p.ContainerConfig = req.ContainerConfig
	}
	if req.LocalConfig != "" || req.LocalConfig == "" {
		p.LocalConfig = req.LocalConfig
	}

	if err := s.repo.Update(p); err != nil {
		return nil, fmt.Errorf("update project: %w", err)
	}
	return p, nil
}

// Delete 删除项目
func (s *ProjectService) Delete(id uint) error {
	return s.repo.Delete(id)
}

// Clone 复制项目
func (s *ProjectService) Clone(id uint, name string) (*model.Project, error) {
	orig, err := s.repo.Get(id)
	if err != nil {
		return nil, err
	}

	clone := &model.Project{
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
func (s *ProjectService) Branches(id uint) ([]string, error) {
	p, err := s.repo.Get(id)
	if err != nil {
		return nil, fmt.Errorf("get project: %w", err)
	}

	key, err := s.keyRepo.Get(p.SSHKeyID)
	if err != nil {
		return nil, fmt.Errorf("get ssh key: %w", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	var branchList []git.Branch

	if p.ServerNodeID != nil && *p.ServerNodeID > 0 {
		// 远程项目：通过 SSH 在目标服务器上执行 git ls-remote
		node, err := s.serverNodeRepo.Get(*p.ServerNodeID)
		if err != nil {
			return nil, fmt.Errorf("get server node: %w", err)
		}
		if node.Status != "online" && node.Status != "unknown" {
			return nil, fmt.Errorf("目标服务器 %s 状态异常（%s），无法获取分支", node.Name, node.Status)
		}

		client, err := s.sshPool.GetOrCreate(node.ID, func() (*sshclient.Client, error) {
			return s.createSSHClient(node)
		})
		if err != nil {
			return nil, fmt.Errorf("connect to server: %w", err)
		}

		executor := deployer.NewRemoteExecutor(client, p.TimeoutSec)
		gitService := remote.NewGitService(executor)
		branchList, err = gitService.ListBranches(ctx, p.GitURL, key.PrivatePath)
		if err != nil {
			return nil, fmt.Errorf("list branches: %w", err)
		}
	} else {
		// 本地项目
		branchList, err = s.gitService.ListBranches(ctx, p.GitURL, key.PrivatePath)
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
func (s *ProjectService) createSSHClient(node *model.ServerNode) (*sshclient.Client, error) {
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
