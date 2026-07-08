package handler

import (
	"fmt"
	"net/http"
	"path/filepath"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/linux-deploy-manager/internal/service"
)

// TemplateHandler 模板处理器
type TemplateHandler struct {
	svc *service.Service
}

// NewTemplateHandler 创建模板处理器
func NewTemplateHandler(svc *service.Service) *TemplateHandler {
	return &TemplateHandler{svc: svc}
}

// List 列出模板（附带最新一条部署任务）
func (h *TemplateHandler) List(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "20"))
	status := c.Query("status")

	items, total, err := h.svc.Template.ListWithLatestTask(page, pageSize, status)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500020, "message": "获取模板列表失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"code": 0, "data": gin.H{"total": total, "items": items}})
}

// Create 创建模板
func (h *TemplateHandler) Create(c *gin.Context) {
	var req service.CreateTemplateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400020, "message": "请求参数错误：" + err.Error()})
		return
	}

	t, err := h.svc.Template.Create(&req)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400021, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"code": 0, "data": t})
}

// Get 获取模板详情（附带最新成功部署任务）
func (h *TemplateHandler) Get(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400022, "message": "无效的模板 ID"})
		return
	}

	t, latest, err := h.svc.Template.GetWithLatestTask(uint(id))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"code": 404020, "message": "模板不存在"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"code": 0, "data": gin.H{
		"template":            t,
		"latest_success_task": latest,
	}})
}

// Update 全量更新模板
func (h *TemplateHandler) Update(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400023, "message": "无效的模板 ID"})
		return
	}

	var req service.CreateTemplateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400024, "message": "请求参数错误：" + err.Error()})
		return
	}

	t, err := h.svc.Template.Update(uint(id), &req)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400025, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"code": 0, "data": t})
}

// Patch 部分更新模板
func (h *TemplateHandler) Patch(c *gin.Context) {
	// 复用 Update 逻辑（JSON 只包含部分字段时 ShouldBindJSON 会忽略缺失字段）
	h.Update(c)
}

// Delete 删除模板
func (h *TemplateHandler) Delete(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400026, "message": "无效的模板 ID"})
		return
	}

	if err := h.svc.Template.Delete(uint(id)); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400027, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"code": 0, "message": "删除成功"})
}

// Clone 复制模板
func (h *TemplateHandler) Clone(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400028, "message": "无效的模板 ID"})
		return
	}

	var req struct {
		Name string `json:"name"`
	}
	c.ShouldBindJSON(&req)
	if req.Name == "" {
		req.Name = "副本"
	}

	orig, err := h.svc.Template.Get(uint(id))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"code": 404021, "message": "模板不存在"})
		return
	}

	clone, err := h.svc.Template.Clone(uint(id), orig.Name+"-"+req.Name)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400029, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"code": 0, "data": clone})
}

// Branches 获取远程分支
func (h *TemplateHandler) Branches(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400030, "message": "无效的模板 ID"})
		return
	}

	branches, err := h.svc.Template.Branches(uint(id))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400031, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"code": 0, "data": gin.H{"branches": branches}})
}

// Deploy 触发部署
func (h *TemplateHandler) Deploy(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400032, "message": "无效的模板 ID"})
		return
	}

	var req struct {
		Branch string `json:"branch" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400033, "message": "请选择部署分支"})
		return
	}

	// 获取模板和密钥
	template, err := h.svc.Template.Get(uint(id))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"code": 404022, "message": "模板不存在"})
		return
	}

	key, err := h.svc.Key.Get(template.SSHKeyID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400034, "message": "SSH 密钥不存在"})
		return
	}

	// 创建部署任务
	logPath := filepath.Join(h.svc.LogDir, "deploy", fmt.Sprintf("task_%d_%s.log", time.Now().Unix(), req.Branch))
	task, err := h.svc.Task.Create(&service.CreateTaskRequest{
		TemplateID: uint(id),
		Branch:     req.Branch,
		LogPath:    logPath,
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500020, "message": "创建部署任务失败: " + err.Error()})
		return
	}

	// 异步执行部署
	go func() {
		_ = h.svc.Task.UpdateStatus(task.ID, "running", "")
		if err := h.svc.Task.ExecuteDeploy(task.ID, template, key); err != nil {
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
