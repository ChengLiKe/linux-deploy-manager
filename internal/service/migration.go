package service

import (
	"fmt"
	"log/slog"

	"github.com/linux-deploy-manager/internal/model"
	"github.com/linux-deploy-manager/internal/repository"
)

// MigrateProjectsToDeployments 将已有项目的部署字段迁移为默认部署配置
func MigrateProjectsToDeployments(deploymentSvc *DeploymentService, projectRepo repository.ProjectRepository) error {
	projects, _, err := projectRepo.List(1, 10000, "")
	if err != nil {
		return fmt.Errorf("list projects for migration: %w", err)
	}

	migratedCount := 0
	for _, p := range projects {
		// 检查是否已有部署配置
		count, err := deploymentSvc.deploymentRepo.CountByProject(p.ID)
		if err != nil {
			slog.Warn("check deployment count for project", "project_id", p.ID, "error", err)
			continue
		}
		if count > 0 {
			continue
		}

		// 从项目字段创建默认部署配置
		d := &model.Deployment{
			Name:            p.Name + "-default",
			Description:     fmt.Sprintf("从项目 %s 自动迁移的默认部署配置", p.Name),
			ProjectID:       p.ID,
			ServerNodeID:    p.ServerNodeID,
			DeployMode:      p.DeployMode,
			TimeoutSec:      p.TimeoutSec,
			ContainerConfig: p.ContainerConfig,
			LocalConfig:     p.LocalConfig,
			DefaultBranch:   "main",
		}

		if err := deploymentSvc.deploymentRepo.Create(d); err != nil {
			slog.Warn("create default deployment for project", "project_id", p.ID, "error", err)
			continue
		}
		migratedCount++
		slog.Info("migrated project to deployment", "project_id", p.ID, "project_name", p.Name, "deployment_id", d.ID)
	}

	slog.Info("migration completed", "total_projects", len(projects), "migrated", migratedCount)
	return nil
}
