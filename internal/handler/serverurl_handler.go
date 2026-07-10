package handler

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/linux-deploy-manager/internal/model"
	"github.com/linux-deploy-manager/internal/repository"
)

// ServerURLHandler 服务器网址处理器
type ServerURLHandler struct {
	repo repository.ServerURLRepository
}

// NewServerURLHandler 创建处理器
func NewServerURLHandler(repo repository.ServerURLRepository) *ServerURLHandler {
	return &ServerURLHandler{repo: repo}
}

// CreateServerURLRequest 创建请求
type CreateServerURLRequest struct {
	NodeID      uint   `json:"node_id" binding:"required"`
	Name        string `json:"name" binding:"required,min=1,max=100"`
	URL         string `json:"url" binding:"required,max=2048"`
	Group       string `json:"group" binding:"omitempty,max=50"`
	Description string `json:"description" binding:"omitempty,max=500"`
	SortOrder   *int   `json:"sort_order"`
}

// UpdateServerURLRequest 更新请求
type UpdateServerURLRequest struct {
	Name        string `json:"name" binding:"omitempty,min=1,max=100"`
	URL         string `json:"url" binding:"omitempty,max=2048"`
	Group       string `json:"group" binding:"omitempty,max=50"`
	Description string `json:"description" binding:"omitempty,max=500"`
	SortOrder   *int   `json:"sort_order"`
}

// List 列出指定节点的所有网址
func (h *ServerURLHandler) List(c *gin.Context) {
	nodeID, err := strconv.ParseUint(c.Param("id"), 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400080, "message": "无效的节点 ID"})
		return
	}

	urls, err := h.repo.List(uint(nodeID))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500080, "message": "获取网址列表失败"})
		return
	}

	groups, _ := h.repo.ListGroups(uint(nodeID))

	c.JSON(http.StatusOK, gin.H{"code": 0, "data": gin.H{
		"urls":   urls,
		"groups": groups,
	}})
}

// Create 添加网址
func (h *ServerURLHandler) Create(c *gin.Context) {
	var req CreateServerURLRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400081, "message": "请求参数错误：" + err.Error()})
		return
	}

	if req.Group == "" {
		req.Group = "default"
	}

	sortOrder := 0
	if req.SortOrder != nil {
		sortOrder = *req.SortOrder
	}

	u := &model.ServerURL{
		NodeID:      req.NodeID,
		Name:        req.Name,
		URL:         req.URL,
		Group:       req.Group,
		Description: req.Description,
		SortOrder:   sortOrder,
	}

	if err := h.repo.Create(u); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500081, "message": "创建网址记录失败"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"code": 0, "data": u})
}

// Update 更新网址
func (h *ServerURLHandler) Update(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400082, "message": "无效的 ID"})
		return
	}

	existing, err := h.repo.Get(uint(id))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"code": 404080, "message": "网址记录不存在"})
		return
	}

	var req UpdateServerURLRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400083, "message": "请求参数错误：" + err.Error()})
		return
	}

	if req.Name != "" {
		existing.Name = req.Name
	}
	if req.URL != "" {
		existing.URL = req.URL
	}
	if req.Group != "" {
		existing.Group = req.Group
	}
	if req.Description != "" {
		existing.Description = req.Description
	}
	if req.SortOrder != nil {
		existing.SortOrder = *req.SortOrder
	}

	if err := h.repo.Update(existing); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500082, "message": "更新网址记录失败"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"code": 0, "data": existing})
}

// Delete 删除网址
func (h *ServerURLHandler) Delete(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400084, "message": "无效的 ID"})
		return
	}

	if err := h.repo.Delete(uint(id)); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500083, "message": "删除网址记录失败"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"code": 0, "message": "已删除"})
}
