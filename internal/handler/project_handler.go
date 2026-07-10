package handler

import (
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/linux-deploy-manager/internal/model"
	"github.com/linux-deploy-manager/internal/service"
)

// ImportFolderRequest 从文件夹导入项目请求
type ImportFolderRequest struct {
	FolderPath string `json:"folder_path" binding:"required"`
}

// ImportGitRequest 从 Git URL 导入项目请求
type ImportGitRequest struct {
	GitURL string `json:"git_url" binding:"required"`
}

// 从 Git URL 推导项目名
func deriveNameFromGitURL(url string) string {
	// 移除末尾的 .git
	name := strings.TrimSuffix(url, ".git")
	// 取最后一段（/ 分隔）
	if idx := strings.LastIndex(name, "/"); idx >= 0 {
		name = name[idx+1:]
	}
	// 再取最后一段（: 分隔，处理 git@ 格式）
	if idx := strings.LastIndex(name, ":"); idx >= 0 {
		name = name[idx+1:]
	}
	return name
}

// 检测文件夹中的 Git 配置，返回远程 URL
func detectGitInFolder(folderPath string) (string, error) {
	gitDir := filepath.Join(folderPath, ".git")
	info, err := os.Stat(gitDir)
	if err != nil || !info.IsDir() {
		return "", fmt.Errorf("文件夹 %s 不是 Git 仓库", folderPath)
	}

	// 读取 .git/config 获取远程 URL
	configPath := filepath.Join(gitDir, "config")
	data, err := os.ReadFile(configPath)
	if err != nil {
		return "", fmt.Errorf("读取 Git 配置失败: %w", err)
	}

	config := string(data)
	lines := strings.Split(config, "\n")
	inRemote := false
	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if trimmed == `[remote "origin"]` {
			inRemote = true
			continue
		}
		if inRemote {
			if strings.HasPrefix(trimmed, "[") {
				break
			}
			if strings.HasPrefix(trimmed, "url = ") {
				url := strings.TrimPrefix(trimmed, "url = ")
				url = strings.Trim(url, `"`)
				return url, nil
			}
		}
	}
	return "", fmt.Errorf("未找到 Git 远程仓库地址")
}

// ImportFolder 从本地文件夹导入项目
func (h *ProjectHandler) ImportFolder(c *gin.Context) {
	var req ImportFolderRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400036, "message": "请提供文件夹路径"})
		return
	}

	// 检查文件夹是否存在
	info, err := os.Stat(req.FolderPath)
	if err != nil || !info.IsDir() {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400037, "message": "文件夹路径无效或不存在"})
		return
	}

	// 检测 Git
	gitURL, err := detectGitInFolder(req.FolderPath)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400038, "message": err.Error()})
		return
	}

	// 使用文件夹名作为项目名
	projectName := filepath.Base(req.FolderPath)

	// 创建项目（自动配置各项默认值）
	createReq := &service.CreateProjectRequest{
		Name:       projectName,
		GitURL:     gitURL,
		SSHKeyID:   0, // 后续可手动配置
		CodeDir:    req.FolderPath,
		DeployDir:  req.FolderPath,
		DeployMode: "local",
		EnvFormat:  "dotenv",
		TimeoutSec: 600,
	}

	p, err := h.svc.Project.Create(createReq)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400039, "message": "创建项目失败: " + err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"code": 0, "data": p})
}

// ImportGit 从 Git URL 导入项目
func (h *ProjectHandler) ImportGit(c *gin.Context) {
	var req ImportGitRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400040, "message": "请提供 Git 仓库地址"})
		return
	}

	projectName := deriveNameFromGitURL(req.GitURL)
	if projectName == "" {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400041, "message": "无法从 Git 地址推导项目名称"})
		return
	}

	createReq := &service.CreateProjectRequest{
		Name:       projectName,
		GitURL:     req.GitURL,
		SSHKeyID:   0,
		CodeDir:    filepath.Join("/opt/apps", projectName),
		DeployDir:  filepath.Join("/opt/apps", projectName),
		DeployMode: "local",
		EnvFormat:  "dotenv",
		TimeoutSec: 600,
	}

	p, err := h.svc.Project.Create(createReq)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400042, "message": "创建项目失败: " + err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"code": 0, "data": p})
}

// ProjectHandler 项目处理器
type ProjectHandler struct {
	svc *service.Service
}

// NewProjectHandler 创建项目处理器
func NewProjectHandler(svc *service.Service) *ProjectHandler {
	return &ProjectHandler{svc: svc}
}

// List 列出项目（附带最新一条部署任务）
func (h *ProjectHandler) List(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "20"))
	status := c.Query("status")

	items, total, err := h.svc.Project.ListWithLatestTask(page, pageSize, status)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500020, "message": "获取项目列表失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"code": 0, "data": gin.H{"total": total, "items": items}})
}

// Create 创建项目
func (h *ProjectHandler) Create(c *gin.Context) {
	var req service.CreateProjectRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400020, "message": "请求参数错误：" + err.Error()})
		return
	}

	p, err := h.svc.Project.Create(&req)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400021, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"code": 0, "data": p})
}

// Get 获取项目详情（附带最新成功部署任务）
func (h *ProjectHandler) Get(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400022, "message": "无效的项目 ID"})
		return
	}

	p, latest, err := h.svc.Project.GetWithLatestTask(uint(id))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"code": 404020, "message": "项目不存在"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"code": 0, "data": gin.H{
		"project":             p,
		"latest_success_task": latest,
	}})
}

// Update 全量更新项目
func (h *ProjectHandler) Update(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400023, "message": "无效的项目 ID"})
		return
	}

	var req service.CreateProjectRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400024, "message": "请求参数错误：" + err.Error()})
		return
	}

	p, err := h.svc.Project.Update(uint(id), &req)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400025, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"code": 0, "data": p})
}

// PatchProjectRequest 部分更新项目请求（全字段可选）
type PatchProjectRequest struct {
	Name            *string `json:"name"`
	Description     *string `json:"description"`
	GitURL          *string `json:"git_url"`
	SSHKeyID        *uint   `json:"ssh_key_id"`
	ServerNodeID    *uint   `json:"server_node_id"`
	CodeDir         *string `json:"code_dir"`
	DeployDir       *string `json:"deploy_dir"`
	EnvFormat       *string `json:"env_format"`
	EnvContent      *string `json:"env_content"`
	DeployMode      *string `json:"deploy_mode"`
	PreCmd          *string `json:"pre_cmd"`
	DeployCmd       *string `json:"deploy_cmd"`
	PostCmd         *string `json:"post_cmd"`
	TimeoutSec      *int    `json:"timeout_sec"`
	ContainerConfig *string `json:"container_config"`
	LocalConfig     *string `json:"local_config"`
}

// Patch 部分更新项目
func (h *ProjectHandler) Patch(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400023, "message": "无效的项目 ID"})
		return
	}

	var req PatchProjectRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400024, "message": "请求参数错误：" + err.Error()})
		return
	}

	// 转换为 CreateProjectRequest，仅设置显式传入的字段
	updateReq := &service.CreateProjectRequest{}
	if req.Name != nil {
		updateReq.Name = *req.Name
	}
	if req.Description != nil {
		updateReq.Description = *req.Description
	}
	if req.GitURL != nil {
		updateReq.GitURL = *req.GitURL
	}
	if req.SSHKeyID != nil {
		updateReq.SSHKeyID = *req.SSHKeyID
	}
	if req.ServerNodeID != nil {
		// 保留显式传 null 的能力
		val := *req.ServerNodeID
		updateReq.ServerNodeID = &val
	}
	if req.CodeDir != nil {
		updateReq.CodeDir = *req.CodeDir
	}
	if req.DeployDir != nil {
		updateReq.DeployDir = *req.DeployDir
	}
	if req.EnvFormat != nil {
		updateReq.EnvFormat = *req.EnvFormat
	}
	if req.EnvContent != nil {
		updateReq.EnvContent = *req.EnvContent
	}
	if req.DeployMode != nil {
		updateReq.DeployMode = *req.DeployMode
	}
	if req.PreCmd != nil {
		updateReq.PreCmd = *req.PreCmd
	}
	if req.DeployCmd != nil {
		updateReq.DeployCmd = *req.DeployCmd
	}
	if req.PostCmd != nil {
		updateReq.PostCmd = *req.PostCmd
	}
	if req.TimeoutSec != nil {
		updateReq.TimeoutSec = *req.TimeoutSec
	}
	if req.ContainerConfig != nil {
		updateReq.ContainerConfig = *req.ContainerConfig
	}
	if req.LocalConfig != nil {
		updateReq.LocalConfig = *req.LocalConfig
	}

	p, err := h.svc.Project.Update(uint(id), updateReq)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400025, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"code": 0, "data": p})
}

// Delete 删除项目
func (h *ProjectHandler) Delete(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400026, "message": "无效的项目 ID"})
		return
	}

	if err := h.svc.Project.Delete(uint(id)); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400027, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"code": 0, "message": "删除成功"})
}

// Clone 复制项目
func (h *ProjectHandler) Clone(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400028, "message": "无效的项目 ID"})
		return
	}

	var req struct {
		Name string `json:"name"`
	}
	c.ShouldBindJSON(&req)
	if req.Name == "" {
		req.Name = "副本"
	}

	orig, err := h.svc.Project.Get(uint(id))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"code": 404021, "message": "项目不存在"})
		return
	}

	clone, err := h.svc.Project.Clone(uint(id), orig.Name+"-"+req.Name)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400029, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"code": 0, "data": clone})
}

// Branches 获取远程分支
func (h *ProjectHandler) Branches(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400030, "message": "无效的项目 ID"})
		return
	}

	branches, err := h.svc.Project.Branches(uint(id))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400031, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"code": 0, "data": gin.H{"branches": branches}})
}

// Deploy 触发部署（向后兼容：优先使用部署配置，否则自动创建默认部署配置）
func (h *ProjectHandler) Deploy(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400032, "message": "无效的项目 ID"})
		return
	}

	var req struct {
		Branch string `json:"branch" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400033, "message": "请选择部署分支"})
		return
	}

	// 获取项目
	project, err := h.svc.Project.Get(uint(id))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"code": 404022, "message": "项目不存在"})
		return
	}

	// 先查找是否存在活跃的部署配置
	deployments, _, err := h.svc.Deployment.List(uint(id), 1, 100)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500020, "message": "查询部署配置失败"})
		return
	}

	var deployment *model.Deployment
	for i := range deployments {
		deployment = &deployments[i]
		break
	}

	// 如果没有找到部署配置，自动创建一个默认的迁移部署配置
	if deployment == nil {
		defaultDeployment, err := h.svc.Deployment.Create(&service.CreateDeploymentRequest{
			Name:            project.Name + "-default",
			Description:     fmt.Sprintf("从项目 %s 自动创建的默认部署配置", project.Name),
			ProjectID:       project.ID,
			ServerNodeID:    project.ServerNodeID,
			DeployMode:      project.DeployMode,
			TimeoutSec:      project.TimeoutSec,
			ContainerConfig: project.ContainerConfig,
			LocalConfig:     project.LocalConfig,
			DefaultBranch:   req.Branch,
		})
		if err != nil {
			// 回退到旧逻辑
			h.deployLegacy(c, uint(id), project, req.Branch)
			return
		}
		deployment = defaultDeployment
	}

	// 通过部署配置触发部署
	task, err := h.svc.Deployment.Deploy(deployment.ID, req.Branch)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400035, "message": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"code": 0, "data": gin.H{
		"task_id": task.ID,
		"message": "部署任务已创建",
	}})
}

// deployLegacy 旧版部署逻辑（回退方案）
func (h *ProjectHandler) deployLegacy(c *gin.Context, id uint, project *model.Project, branch string) {
	key, err := h.svc.Key.Get(project.SSHKeyID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400034, "message": "SSH 密钥不存在"})
		return
	}

	// 创建部署任务
	logPath := filepath.Join(h.svc.LogDir, "deploy", fmt.Sprintf("task_%d_%s.log", time.Now().Unix(), branch))
	task, err := h.svc.Task.Create(&service.CreateTaskRequest{
		ProjectID: id,
		Branch:    branch,
		LogPath:   logPath,
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500020, "message": "创建部署任务失败: " + err.Error()})
		return
	}

	// 异步执行部署
	go func() {
		defer func() {
			if r := recover(); r != nil {
				errMsg := fmt.Sprintf("部署 goroutine panic: %v", r)
				slog.Error(errMsg)
				_ = h.svc.Task.UpdateStatus(task.ID, "failed", errMsg)
			}
		}()
		_ = h.svc.Task.UpdateStatus(task.ID, "running", "")
		if err := h.svc.Task.ExecuteDeploy(task.ID, project, key); err != nil {
			_ = h.svc.Task.UpdateStatus(task.ID, "failed", err.Error())
		} else {
			_ = h.svc.Task.UpdateStatus(task.ID, "success", "")
		}
	}()

	c.JSON(http.StatusOK, gin.H{"code": 0, "data": gin.H{
		"task_id": task.ID,
		"message": "部署任务已创建",
	}})
}
