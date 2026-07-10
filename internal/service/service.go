package service

import (
	"github.com/linux-deploy-manager/internal/auth"
	"github.com/linux-deploy-manager/internal/deployer"
	"github.com/linux-deploy-manager/internal/git"
	"github.com/linux-deploy-manager/internal/remote/sshclient"
	"github.com/linux-deploy-manager/internal/repository"
)

// Service 聚合所有服务
type Service struct {
	Key        *KeyService
	ServerNode *ServerNodeService
	Project    *ProjectService
	Task       *TaskService
	Setting    *SettingService
	Fix        *FixService
	Auth       *auth.Service
	Deployment *DeploymentService
	LogDir     string
}

// New 创建服务层
func New(repo *repository.Repositories, authService *auth.Service, keysDir string, logDir string, deployerEngine *deployer.Deployer, sshPool *sshclient.Pool) *Service {
	settingSvc := NewSettingService(repo.Setting)
	taskSvc := NewTaskService(repo.Task, repo.ServerNode, repo.Key, repo.Project, sshPool, deployerEngine, logDir, settingSvc)
	return &Service{
		Key:        NewKeyService(repo.Key, keysDir),
		ServerNode: NewServerNodeService(repo.ServerNode, repo.Key, sshPool),
		Project:    NewProjectService(repo.Project, repo.Key, repo.Task, repo.ServerNode, sshPool, git.NewService()),
		Task:       taskSvc,
		Setting:    settingSvc,
		Fix:        NewFixService(repo.ServerNode, repo.Key),
		Auth:       authService,
		Deployment: NewDeploymentService(repo.Deployment, repo.Project, repo.ServerNode, repo.Key, repo.Task, taskSvc, sshPool, logDir),
		LogDir:     logDir,
	}
}
