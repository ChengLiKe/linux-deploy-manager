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
	sshPool        *sshclient.Pool
	deployer       *deployer.Deployer
	logDir         string
	settingService *SettingService
}

// NewTaskService 创建任务服务
func NewTaskService(repo repository.TaskRepository, serverNodeRepo repository.ServerNodeRepository, keyRepo repository.KeyRepository, sshPool *sshclient.Pool, deployer *deployer.Deployer, logDir string, settingService *SettingService) *TaskService {
	return &TaskService{repo: repo, serverNodeRepo: serverNodeRepo, keyRepo: keyRepo, sshPool: sshPool, deployer: deployer, logDir: logDir, settingService: settingService}
}

// CreateTaskRequest 创建任务请求
type CreateTaskRequest struct {
	TemplateID uint   `json:"template_id" binding:"required"`
	Branch     string `json:"branch" binding:"required"`
	LogPath    string `json:"log_path" binding:"required"`
}

// Create 创建部署任务
func (s *TaskService) Create(req *CreateTaskRequest) (*model.DeployTask, error) {
	now := time.Now()
	task := &model.DeployTask{
		TemplateID:  req.TemplateID,
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
func (s *TaskService) List(templateID uint, status string, page, pageSize int) ([]model.DeployTask, int64, error) {
	return s.repo.List(templateID, status, page, pageSize)
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
func (s *TaskService) ExecuteDeploy(taskID uint, template *model.Template, key *model.SSHKey) error {
	// 获取任务以取得分支信息
	task, err := s.repo.Get(taskID)
	if err != nil {
		return fmt.Errorf("get task: %w", err)
	}

	// 创建 Executor
	executor, err := s.createExecutor(template)
	if err != nil {
		return fmt.Errorf("create executor: %w", err)
	}

	// 创建 Git 服务（本地或远程）
	var gitService git.Service
	if template.ServerNodeID != nil && *template.ServerNodeID > 0 {
		gitService = remote.NewGitService(executor)
	} else {
		gitService = git.NewService()
	}

	// 解析环境变量
	envVars := make(map[string]string)
	// TODO: 解析 template.EnvContent 根据 template.EnvFormat

	cfg := &deployer.Config{
		Name:            template.Name,
		GitURL:          template.GitURL,
		SSHKeyPath:      key.PrivatePath,
		CodeDir:         template.CodeDir,
		DeployDir:       template.DeployDir,
		Branch:          task.Branch,
		EnvVars:         envVars,
		PreDeployCmd:    template.PreCmd,
		DeployCmd:       template.DeployCmd,
		PostDeployCmd:   template.PostCmd,
		DeployMode:      template.DeployMode,
		ContainerConfig: template.ContainerConfig,
		LocalConfig:     template.LocalConfig,
		TimeoutSec:      template.TimeoutSec,
		LogDir:          s.logDir,
	}

	ctx := context.Background()
	return s.deployer.Execute(ctx, fmt.Sprintf("%d", taskID), cfg, executor, gitService)
}

// createExecutor 根据模板配置创建对应的执行器（本地或远程）
func (s *TaskService) createExecutor(template *model.Template) (deployer.Executor, error) {
	if template.ServerNodeID == nil || *template.ServerNodeID == 0 {
		// 本地模式（向后兼容）
		return deployer.NewLocalExecutor(template.TimeoutSec), nil
	}

	// 远程模式
	node, err := s.serverNodeRepo.Get(*template.ServerNodeID)
	if err != nil {
		return nil, fmt.Errorf("get server node %d: %w", *template.ServerNodeID, err)
	}
	if node.Status != "online" {
		return nil, fmt.Errorf("目标服务器 %s 离线，无法部署", node.Name)
	}

	client, err := s.sshPool.GetOrCreate(node.ID, func() (*sshclient.Client, error) {
		return s.createSSHClient(node)
	})
	if err != nil {
		return nil, fmt.Errorf("connect to server %s: %w", node.Host, err)
	}

	return deployer.NewRemoteExecutor(client, template.TimeoutSec), nil
}

// createSSHClient 根据服务器节点配置创建 SSH 客户端
func (s *TaskService) createSSHClient(node *model.ServerNode) (*sshclient.Client, error) {
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
		// TODO: 密码解密
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
