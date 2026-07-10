package service

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/linux-deploy-manager/internal/deployer"
	"github.com/linux-deploy-manager/internal/git"
	"github.com/linux-deploy-manager/internal/model"
	"github.com/linux-deploy-manager/internal/remote"
	"github.com/linux-deploy-manager/internal/remote/sshclient"
	"github.com/linux-deploy-manager/internal/repository"
)

// TaskService 部署任务服务
type TaskService struct {
	repo           repository.TaskRepository
	serverNodeRepo repository.ServerNodeRepository
	keyRepo        repository.KeyRepository
	projectRepo    repository.ProjectRepository
	sshPool        *sshclient.Pool
	deployer       *deployer.Deployer
	logDir         string
	settingService *SettingService
}

// NewTaskService 创建任务服务
func NewTaskService(repo repository.TaskRepository, serverNodeRepo repository.ServerNodeRepository, keyRepo repository.KeyRepository, projectRepo repository.ProjectRepository, sshPool *sshclient.Pool, deployer *deployer.Deployer, logDir string, settingService *SettingService) *TaskService {
	return &TaskService{repo: repo, serverNodeRepo: serverNodeRepo, keyRepo: keyRepo, projectRepo: projectRepo, sshPool: sshPool, deployer: deployer, logDir: logDir, settingService: settingService}
}

// CreateTaskRequest 创建任务请求
type CreateTaskRequest struct {
	ProjectID uint   `json:"project_id" binding:"required"`
	Branch    string `json:"branch" binding:"required"`
	LogPath   string `json:"log_path" binding:"required"`
}

// Create 创建部署任务
func (s *TaskService) Create(req *CreateTaskRequest) (*model.DeployTask, error) {
	now := time.Now()
	task := &model.DeployTask{
		ProjectID:   req.ProjectID,
		Branch:      req.Branch,
		Status:      "pending",
		StartedAt:   &now,
		LogPath:     req.LogPath,
		TriggeredBy: "root",
	}
	if err := s.repo.Create(task); err != nil {
		return nil, fmt.Errorf("create task: %w", err)
	}
	return task, nil
}

// Get 获取任务
func (s *TaskService) Get(id uint) (*model.DeployTask, error) {
	return s.repo.Get(id)
}

// List 列出任务
func (s *TaskService) List(projectID uint, status string, page, pageSize int) ([]model.DeployTask, int64, error) {
	return s.repo.List(projectID, status, page, pageSize)
}

// UpdateStatus 更新任务状态
func (s *TaskService) UpdateStatus(id uint, status string, errorMsg string) error {
	task, err := s.repo.Get(id)
	if err != nil {
		return err
	}
	task.Status = status
	task.ErrorMsg = errorMsg
	if status == "success" || status == "failed" || status == "cancelled" {
		now := time.Now()
		task.EndedAt = &now
	}
	return s.repo.Update(task)
}

// ExecuteDeploy 执行部署
func (s *TaskService) ExecuteDeploy(taskID uint, project *model.Project, key *model.SSHKey) error {
	// 获取任务以取得分支信息
	task, err := s.repo.Get(taskID)
	if err != nil {
		return fmt.Errorf("get task: %w", err)
	}

	// 创建 Executor
	executor, err := s.createExecutor(project)
	if err != nil {
		return fmt.Errorf("create executor: %w", err)
	}

	// 创建 Git 服务（本地或远程）
	var gitService git.Service
	if project.ServerNodeID != nil && *project.ServerNodeID > 0 {
		gitService = remote.NewGitService(executor)
	} else {
		gitService = git.NewService()
	}

	// 解析环境变量
	envVars := make(map[string]string)
	// TODO: 解析 project.EnvContent 根据 project.EnvFormat

	cfg := &deployer.Config{
		Name:            project.Name,
		GitURL:          project.GitURL,
		SSHKeyPath:      key.PrivatePath,
		CodeDir:         project.CodeDir,
		DeployDir:       project.DeployDir,
		Branch:          task.Branch,
		EnvVars:         envVars,
		PreDeployCmd:    project.PreCmd,
		DeployCmd:       project.DeployCmd,
		PostDeployCmd:   project.PostCmd,
		DeployMode:      project.DeployMode,
		ContainerConfig: project.ContainerConfig,
		LocalConfig:     project.LocalConfig,
		TimeoutSec:      project.TimeoutSec,
		LogDir:          s.logDir,
	}

	ctx := context.Background()
	return s.deployer.Execute(ctx, fmt.Sprintf("%d", taskID), cfg, executor, gitService)
}

// ExecuteDeployFromDeployment 通过部署配置执行部署
func (s *TaskService) ExecuteDeployFromDeployment(taskID uint, deployment *model.Deployment) error {
	// 获取任务
	task, err := s.repo.Get(taskID)
	if err != nil {
		return fmt.Errorf("get task: %w", err)
	}

	// 获取项目
	project, err := s.projectRepo.Get(deployment.ProjectID)
	if err != nil {
		return fmt.Errorf("get project: %w", err)
	}

	// 获取 SSH 密钥
	key, err := s.keyRepo.Get(project.SSHKeyID)
	if err != nil {
		return fmt.Errorf("get ssh key: %w", err)
	}

	// 创建 Executor（使用部署配置的 ServerNodeID 和 TimeoutSec）
	executor, err := s.createDeploymentExecutor(deployment)
	if err != nil {
		return fmt.Errorf("create executor: %w", err)
	}

	// 创建 Git 服务
	var gitService git.Service
	targetNodeID := deployment.ServerNodeID
	if targetNodeID == nil || *targetNodeID == 0 {
		targetNodeID = project.ServerNodeID
	}
	if targetNodeID != nil && *targetNodeID > 0 {
		gitService = remote.NewGitService(executor)
	} else {
		gitService = git.NewService()
	}

	// 解析环境变量
	envVars := make(map[string]string)
	// TODO: 解析 project.EnvContent 根据 project.EnvFormat

	// 使用分支：优先使用任务分支，再使用部署配置的默认分支
	branch := task.Branch
	if branch == "" {
		branch = deployment.DefaultBranch
		if branch == "" {
			branch = "main"
		}
	}

	// 代码部署目录：优先使用部署配置的值，再回退到项目配置
	codeDir := deployment.CodeDir
	if codeDir == "" {
		codeDir = project.CodeDir
	}
	deployDir := deployment.DeployDir
	if deployDir == "" {
		deployDir = project.DeployDir
	}

	cfg := &deployer.Config{
		Name:            project.Name,
		GitURL:          project.GitURL,
		SSHKeyPath:      key.PrivatePath,
		CodeDir:         codeDir,
		DeployDir:       deployDir,
		Branch:          branch,
		EnvVars:         envVars,
		DeployCmd:       "bash " + deployment.ScriptFilename,
		DeployMode:      deployment.DeployMode,
		ContainerConfig: deployment.ContainerConfig,
		LocalConfig:     deployment.LocalConfig,
		TimeoutSec:      deployment.TimeoutSec,
		LogDir:          s.logDir,
	}

	ctx := context.Background()
	return s.deployer.Execute(ctx, fmt.Sprintf("%d", taskID), cfg, executor, gitService)
}

// createExecutor 根据项目配置创建对应的执行器（本地或远程）
func (s *TaskService) createExecutor(project *model.Project) (deployer.Executor, error) {
	if project.ServerNodeID == nil || *project.ServerNodeID == 0 {
		// 本地模式（向后兼容）
		return deployer.NewLocalExecutor(project.TimeoutSec), nil
	}

	// 远程模式
	node, err := s.serverNodeRepo.Get(*project.ServerNodeID)
	if err != nil {
		return nil, fmt.Errorf("get server node %d: %w", *project.ServerNodeID, err)
	}
	if node.Status != "online" && node.Status != "unknown" {
		return nil, fmt.Errorf("目标服务器 %s 状态异常（%s），无法部署", node.Name, node.Status)
	}

	client, err := s.sshPool.GetOrCreate(node.ID, func() (*sshclient.Client, error) {
		return s.createSSHClient(node)
	})
	if err != nil {
		return nil, fmt.Errorf("connect to server %s: %w", node.Host, err)
	}

	return deployer.NewRemoteExecutor(client, project.TimeoutSec), nil
}

// createDeploymentExecutor 根据部署配置创建对应的执行器（本地或远程）
func (s *TaskService) createDeploymentExecutor(deployment *model.Deployment) (deployer.Executor, error) {
	targetNodeID := deployment.ServerNodeID
	if targetNodeID == nil || *targetNodeID == 0 {
		return deployer.NewLocalExecutor(deployment.TimeoutSec), nil
	}

	node, err := s.serverNodeRepo.Get(*targetNodeID)
	if err != nil {
		return nil, fmt.Errorf("get server node %d: %w", *targetNodeID, err)
	}
	if node.Status != "online" && node.Status != "unknown" {
		return nil, fmt.Errorf("目标服务器 %s 状态异常（%s），无法部署", node.Name, node.Status)
	}

	client, err := s.sshPool.GetOrCreate(node.ID, func() (*sshclient.Client, error) {
		return s.createSSHClient(node)
	})
	if err != nil {
		return nil, fmt.Errorf("connect to server %s: %w", node.Host, err)
	}

	return deployer.NewRemoteExecutor(client, deployment.TimeoutSec), nil
}

// createSSHClient 根据服务器节点配置创建 SSH 客户端
func (s *TaskService) createSSHClient(node *model.ServerNode) (*sshclient.Client, error) {
	return sshclient.NewClientFromNode(node, s.keyRepo)
}

// CancelDeploy 取消部署
func (s *TaskService) CancelDeploy(taskID uint) error {
	return s.deployer.Cancel(fmt.Sprintf("%d", taskID))
}

// GetLog 获取日志（优先从内存缓冲区读取，否则读文件）
func (s *TaskService) GetLog(taskID uint) (string, error) {
	// 优先从内存缓冲区读取（正在运行的任务）
	if buf := s.deployer.GetTaskLogBuffer(fmt.Sprintf("%d", taskID)); buf != nil {
		lines := buf.GetLines()
		return strings.Join(lines, "\n"), nil
	}
	// 回退到日志文件
	return s.ReadLogFile(taskID)
}

// ReadLogFile 读取日志文件
func (s *TaskService) ReadLogFile(taskID uint) (string, error) {
	logPath := filepath.Join(s.logDir, "deploy", fmt.Sprintf("task_%d.log", taskID))
	data, err := os.ReadFile(logPath)
	if err != nil {
		return "", err
	}
	return string(data), nil
}
