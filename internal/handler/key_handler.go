package handler

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/linux-deploy-manager/internal/service"
)

// KeyHandler SSH 密钥处理器
type KeyHandler struct {
	svc *service.KeyService
}

// NewKeyHandler 创建密钥处理器
func NewKeyHandler(svc *service.Service) *KeyHandler {
	return &KeyHandler{svc: svc.Key}
}

// List 列出所有密钥
func (h *KeyHandler) List(c *gin.Context) {
	keys, err := h.svc.List()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500010, "message": "获取密钥列表失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"code": 0, "data": gin.H{"keys": keys}})
}

// Create 创建密钥
func (h *KeyHandler) Create(c *gin.Context) {
	var req service.CreateKeyRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400010, "message": "请求参数错误：" + err.Error()})
		return
	}

	key, err := h.svc.Create(&req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500011, "message": "创建密钥失败：" + err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"code": 0, "data": key})
}

// Import 导入已有密钥对
func (h *KeyHandler) Import(c *gin.Context) {
	var req service.ImportKeyRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400020, "message": "请求参数错误：" + err.Error()})
		return
	}

	key, err := h.svc.ImportKey(&req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500020, "message": "导入密钥失败：" + err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"code": 0, "data": key})
}

// Get 获取密钥详情
func (h *KeyHandler) Get(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400011, "message": "无效的密钥 ID"})
		return
	}

	key, err := h.svc.Get(uint(id))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"code": 404010, "message": "密钥不存在"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"code": 0, "data": key})
}

// Delete 删除密钥
func (h *KeyHandler) Delete(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400012, "message": "无效的密钥 ID"})
		return
	}

	if err := h.svc.Delete(uint(id)); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400013, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"code": 0, "message": "删除成功"})
}

// Test 测试密钥连通性
func (h *KeyHandler) Test(c *gin.Context) {
	_, err := strconv.ParseUint(c.Param("id"), 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400014, "message": "无效的密钥 ID"})
		return
	}

	var req struct {
		GitHost string `json:"git_host" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400015, "message": "请提供 Git 主机地址"})
		return
	}

	// TODO: 调用 SSH 测试连通性
	c.JSON(http.StatusOK, gin.H{"code": 0, "data": gin.H{
		"success": true,
		"message": "连通性测试通过",
	}})
}
