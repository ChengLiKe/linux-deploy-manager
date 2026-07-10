package service

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"time"

	"github.com/linux-deploy-manager/internal/deployer"
	"github.com/linux-deploy-manager/internal/git"
	"github.com/linux-deploy-manager/internal/model"
	"github.com/linux-deploy-manager/internal/remote"
	"github.com/linux-deploy-manager/internal/remote/sshclient"
	"github.com/linux-deploy-manager/internal/repository"
)

// DeploymentService 部署配置服务
type DeploymentService struct {
	deploymentRepo repository.DeploymentRepository
	projectRepo    repository.ProjectRepository
	serverNodeRepo repository.ServerNodeRepository
	keyRepo        repository.KeyRepository
	taskRepo       repository.TaskRepository
	taskSvc        *TaskService
	sshPool        *sshclient.Pool
	gitService     git.Service
	logDir         string
}

// NewDeploymentService 创建部署配置服务
func NewDeploymentService(
	deploymentRepo repository.DeploymentRepository,
	projectRepo repository.ProjectRepository,
	serverNodeRepo repository.ServerNodeRepository,
	keyRepo repository.KeyRepository,
	taskRepo repository.TaskRepository,
	taskSvc *TaskService,
	sshPool *sshclient.Pool,
	logDir string,
) *DeploymentService {
	return &DeploymentService{
		deploymentRepo: deploymentRepo,
		projectRepo:    projectRepo,
		serverNodeRepo: serverNodeRepo,
		keyRepo:        keyRepo,
		taskRepo:       taskRepo,
		taskSvc:        taskSvc,
		sshPool:        sshPool,
		gitService:     git.NewService(),
		logDir:         logDir,
	}
}

// CreateDeploymentRequest 创建部署配置请求
type CreateDeploymentRequest struct {
	Name            string `json:"name" binding:"required,min=1,max=100"`
	Description     string `json:"description" binding:"max=500"`
	ProjectID       uint   `json:"project_id" binding:"required"`
	ServerNodeID    *uint  `json:"server_node_id"`
	DeployMode      string `json:"deploy_mode" binding:"omitempty,oneof=local container"`
	TimeoutSec      int    `json:"timeout_sec"`
	ScriptFilename  string `json:"script_filename"`
	ContainerConfig string `json:"container_config"`
	LocalConfig     string `json:"local_config"`
	EnvFormat       string `json:"env_format"`
	EnvContent      string `json:"env_content"`
	CodeDir         string `json:"code_dir"`
	DeployDir       string `json:"deploy_dir"`
	DefaultBranch   string `json:"default_branch"`
}

// UpdateDeploymentRequest 更新部署配置请求
type UpdateDeploymentRequest struct {
	Name            *string `json:"name"`
	Description     *string `json:"description"`
	ServerNodeID    *uint   `json:"server_node_id"`
	DeployMode      *string `json:"deploy_mode"`
	TimeoutSec      *int    `json:"timeout_sec"`
	ScriptFilename  *string `json:"script_filename"`
	ContainerConfig *string `json:"container_config"`
	LocalConfig     *string `json:"local_config"`
	EnvFormat       *string `json:"env_format"`
	EnvContent      *string `json:"env_content"`
	CodeDir         *string `json:"code_dir"`
	DeployDir       *string `json:"deploy_dir"`
	DefaultBranch   *string `json:"default_branch"`
}

// Create 创建部署配置
func (s *DeploymentService) Create(req *CreateDeploymentRequest) (*model.Deployment, error) {
	// 验证项目存在
	project, err := s.projectRepo.Get(req.ProjectID)
	if err != nil {
		return nil, fmt.Errorf("project not found: %w", err)
	}

	// 如果提供了服务器节点，验证其存在
	if req.ServerNodeID != nil && *req.ServerNodeID > 0 {
		if _, err := s.serverNodeRepo.Get(*req.ServerNodeID); err != nil {
			return nil, fmt.Errorf("server node not found: %w", err)
		}
	}

	// 设置默认值
	deployMode := req.DeployMode
	if deployMode == "" {
		deployMode = "local"
	}
	timeoutSec := req.TimeoutSec
	if timeoutSec <= 0 {
		timeoutSec = 600
	}
	defaultBranch := req.DefaultBranch
	if defaultBranch == "" {
		defaultBranch = "main"
	}
	scriptFilename := req.ScriptFilename
	if scriptFilename == "" {
		scriptFilename = "deploy.sh"
	}

	// 规范化 server_node_id: 0 视为 nil
	serverNodeID := req.ServerNodeID
	if serverNodeID != nil && *serverNodeID == 0 {
		serverNodeID = nil
	}

	// 设置默认值：env/code 从项目继承
	envFormat := req.EnvFormat
	if envFormat == "" {
		envFormat = project.EnvFormat
	}
	envContent := req.EnvContent
	if envContent == "" {
		envContent = project.EnvContent
	}
	codeDir := req.CodeDir
	if codeDir == "" {
		codeDir = project.CodeDir
	}
	deployDir := req.DeployDir
	if deployDir == "" {
		deployDir = project.DeployDir
	}

	d := &model.Deployment{
		Name:            req.Name,
		Description:     req.Description,
		ProjectID:       project.ID,
		ServerNodeID:    serverNodeID,
		DeployMode:      deployMode,
		TimeoutSec:      timeoutSec,
		ScriptFilename:  scriptFilename,
		ContainerConfig: req.ContainerConfig,
		LocalConfig:     req.LocalConfig,
		EnvFormat:       envFormat,
		EnvContent:      envContent,
		EnvEncrypted:    project.EnvEncrypted,
		CodeDir:         codeDir,
		DeployDir:       deployDir,
		DefaultBranch:   defaultBranch,
	}
	if err := s.deploymentRepo.Create(d); err != nil {
		return nil, fmt.Errorf("create deployment: %w", err)
	}
	return d, nil
}

// Get 获取部署配置（附带 Project 和 ServerNode）
func (s *DeploymentService) Get(id uint) (*model.Deployment, error) {
	return s.deploymentRepo.Get(id)
}

// List 列出部署配置
func (s *DeploymentService) List(projectID uint, page, pageSize int) ([]model.Deployment, int64, error) {
	return s.deploymentRepo.List(projectID, page, pageSize)
}

// Update 更新部署配置（部分更新）
func (s *DeploymentService) Update(id uint, req *UpdateDeploymentRequest) (*model.Deployment, error) {
	d, err := s.deploymentRepo.Get(id)
	if err != nil {
		return nil, err
	}

	if req.Name != nil {
		d.Name = *req.Name
	}
	if req.Description != nil {
		d.Description = *req.Description
	}
	if req.ServerNodeID != nil {
		if *req.ServerNodeID == 0 {
			d.ServerNodeID = nil
		} else {
			d.ServerNodeID = req.ServerNodeID
		}
	}
	if req.DeployMode != nil {
		d.DeployMode = *req.DeployMode
	}
	if req.TimeoutSec != nil {
		d.TimeoutSec = *req.TimeoutSec
	}
	if req.ScriptFilename != nil {
		d.ScriptFilename = *req.ScriptFilename
	}
	if req.ContainerConfig != nil {
		d.ContainerConfig = *req.ContainerConfig
	}
	if req.LocalConfig != nil {
		d.LocalConfig = *req.LocalConfig
	}
	if req.DefaultBranch != nil {
		d.DefaultBranch = *req.DefaultBranch
	}
	if req.EnvFormat != nil {
		d.EnvFormat = *req.EnvFormat
	}
	if req.EnvContent != nil {
		d.EnvContent = *req.EnvContent
	}
	if req.CodeDir != nil {
		d.CodeDir = *req.CodeDir
	}
	if req.DeployDir != nil {
		d.DeployDir = *req.DeployDir
	}

	if err := s.deploymentRepo.Update(d); err != nil {
		return nil, fmt.Errorf("update deployment: %w", err)
	}
	return d, nil
}

// Delete 删除部署配置
func (s *DeploymentService) Delete(id uint) error {
	return s.deploymentRepo.Delete(id)
}

// Deploy 触发部署
func (s *DeploymentService) Deploy(deploymentID uint, branch string) (*model.DeployTask, error) {
	d, err := s.deploymentRepo.Get(deploymentID)
	if err != nil {
		return nil, fmt.Errorf("get deployment: %w", err)
	}

	// 获取项目以确认分支
	project, err := s.projectRepo.Get(d.ProjectID)
	if err != nil {
		return nil, fmt.Errorf("get project: %w", err)
	}

	if branch == "" {
		branch = d.DefaultBranch
		if branch == "" {
			branch = "main"
		}
	}

	// 创建部署任务
	logPath := filepath.Join(s.logDir, "deploy", fmt.Sprintf("deploy_%d_task_%d.log", deploymentID, time.Now().Unix()))
	task := &model.DeployTask{
		ProjectID:    project.ID,
		DeploymentID: &deploymentID,
		Branch:       branch,
		Status:       "pending",
		StartedAt:    nil,
		LogPath:      logPath,
		TriggeredBy:  "root",
	}
	if err := s.taskRepo.Create(task); err != nil {
		return nil, fmt.Errorf("create task: %w", err)
	}

	// 异步执行部署
	go func() {
		defer func() {
			if r := recover(); r != nil {
				errMsg := fmt.Sprintf("部署 goroutine panic: %v", r)
				slog.Error(errMsg)
				task.Status = "failed"
				task.ErrorMsg = errMsg
				now := time.Now()
				task.EndedAt = &now
				_ = s.taskRepo.Update(task)
			}
		}()
		now := time.Now()
		task.StartedAt = &now
		task.Status = "running"
		_ = s.taskRepo.Update(task)

		if err := s.taskSvc.ExecuteDeployFromDeployment(task.ID, d); err != nil {
			task.Status = "failed"
			task.ErrorMsg = err.Error()
			ended := time.Now()
			task.EndedAt = &ended
			_ = s.taskRepo.Update(task)
		} else {
			task.Status = "success"
			ended := time.Now()
			task.EndedAt = &ended
			_ = s.taskRepo.Update(task)
		}
	}()

	return task, nil
}

// Branches 获取关联项目的 Git 分支
func (s *DeploymentService) Branches(deploymentID uint) ([]string, error) {
	d, err := s.deploymentRepo.Get(deploymentID)
	if err != nil {
		return nil, fmt.Errorf("get deployment: %w", err)
	}

	project, err := s.projectRepo.Get(d.ProjectID)
	if err != nil {
		return nil, fmt.Errorf("get project: %w", err)
	}

	key, err := s.keyRepo.Get(project.SSHKeyID)
	if err != nil {
		return nil, fmt.Errorf("get ssh key: %w", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	var branchList []git.Branch

	// 使用部署配置的 ServerNodeID 决定远程或本地
	targetNodeID := d.ServerNodeID
	if targetNodeID == nil || *targetNodeID == 0 {
		// 如果部署配置没有指定，回退到项目级别
		targetNodeID = project.ServerNodeID
	}

	if targetNodeID != nil && *targetNodeID > 0 {
		node, err := s.serverNodeRepo.Get(*targetNodeID)
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

		executor := deployer.NewRemoteExecutor(client, d.TimeoutSec)
		gitService := remote.NewGitService(executor)
		branchList, err = gitService.ListBranches(ctx, project.GitURL, key.PrivatePath)
		if err != nil {
			return nil, fmt.Errorf("list branches: %w", err)
		}
	} else {
		branchList, err = s.gitService.ListBranches(ctx, project.GitURL, key.PrivatePath)
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
func (s *DeploymentService) createSSHClient(node *model.ServerNode) (*sshclient.Client, error) {
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
