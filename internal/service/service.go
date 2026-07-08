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
	Template   *TemplateService
	Task       *TaskService
	Setting    *SettingService
	Auth       *auth.Service
	LogDir     string
}

// New 创建服务层
func New(repo *repository.Repositories, authService *auth.Service, keysDir string, logDir string, deployerEngine *deployer.Deployer, sshPool *sshclient.Pool) *Service {
	settingSvc := NewSettingService(repo.Setting)
	return &Service{
		Key:        NewKeyService(repo.Key, keysDir),
		ServerNode: NewServerNodeService(repo.ServerNode, repo.Key, sshPool),
		Template:   NewTemplateService(repo.Template, repo.Key, repo.Task, repo.ServerNode, sshPool, git.NewService()),
		Task:       NewTaskService(repo.Task, repo.ServerNode, repo.Key, sshPool, deployerEngine, logDir, settingSvc),
		Setting:    settingSvc,
		Auth:       authService,
		LogDir:     logDir,
	}
}
