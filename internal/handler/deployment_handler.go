package handler

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/linux-deploy-manager/internal/service"
)

// DeploymentHandler 部署配置处理器
type DeploymentHandler struct {
	svc *service.DeploymentService
}

// NewDeploymentHandler 创建部署配置处理器
func NewDeploymentHandler(svc *service.Service) *DeploymentHandler {
	return &DeploymentHandler{svc: svc.Deployment}
}

// List 列出部署配置
func (h *DeploymentHandler) List(c *gin.Context) {
	var projectID uint
	if id := c.Query("project_id"); id != "" {
		if val, err := strconv.ParseUint(id, 10, 32); err == nil {
			projectID = uint(val)
		}
	}
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "20"))

	items, total, err := h.svc.List(projectID, page, pageSize)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500040, "message": "获取部署配置列表失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"code": 0, "data": gin.H{"total": total, "items": items}})
}

// Create 创建部署配置
func (h *DeploymentHandler) Create(c *gin.Context) {
	var req service.CreateDeploymentRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400050, "message": "请求参数错误：" + err.Error()})
		return
	}

	d, err := h.svc.Create(&req)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400051, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"code": 0, "data": d})
}

// Get 获取部署配置详情
func (h *DeploymentHandler) Get(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400052, "message": "无效的部署配置 ID"})
		return
	}

	d, err := h.svc.Get(uint(id))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"code": 404040, "message": "部署配置不存在"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"code": 0, "data": d})
}

// Update 更新部署配置
func (h *DeploymentHandler) Update(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400053, "message": "无效的部署配置 ID"})
		return
	}

	var req service.UpdateDeploymentRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400054, "message": "请求参数错误：" + err.Error()})
		return
	}

	d, err := h.svc.Update(uint(id), &req)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400055, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"code": 0, "data": d})
}

// Delete 删除部署配置
func (h *DeploymentHandler) Delete(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400056, "message": "无效的部署配置 ID"})
		return
	}

	if err := h.svc.Delete(uint(id)); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400057, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"code": 0, "message": "删除成功"})
}

// Deploy 触发部署
func (h *DeploymentHandler) Deploy(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400058, "message": "无效的部署配置 ID"})
		return
	}

	var req struct {
		Branch string `json:"branch"`
	}
	c.ShouldBindJSON(&req)

	task, err := h.svc.Deploy(uint(id), req.Branch)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400059, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"code": 0, "data": gin.H{
		"task_id": task.ID,
		"message": "部署任务已创建",
	}})
}

// Branches 获取项目分支
func (h *DeploymentHandler) Branches(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400060, "message": "无效的部署配置 ID"})
		return
	}

	branches, err := h.svc.Branches(uint(id))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400061, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"code": 0, "data": gin.H{"branches": branches}})
}
