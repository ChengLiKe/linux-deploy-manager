package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/linux-deploy-manager/internal/service"
)

// SettingHandler 设置处理器
type SettingHandler struct {
	svc *service.SettingService
}

// NewSettingHandler 创建设置处理器
func NewSettingHandler(svc *service.SettingService) *SettingHandler {
	return &SettingHandler{svc: svc}
}

// Get 获取指定设置项
func (h *SettingHandler) Get(c *gin.Context) {
	key := c.Query("key")
	if key == "" {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400040, "message": "缺少 key 参数"})
		return
	}

	value, err := h.svc.Get(key)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500040, "message": "读取设置失败: " + err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"code": 0, "data": gin.H{"key": key, "value": value}})
}

// Set 设置指定项
func (h *SettingHandler) Set(c *gin.Context) {
	var req struct {
		Key   string `json:"key" binding:"required"`
		Value string `json:"value" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400041, "message": "请求参数错误：" + err.Error()})
		return
	}

	if err := h.svc.Set(req.Key, req.Value); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500041, "message": "保存设置失败: " + err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"code": 0, "message": "保存成功"})
}

// GetSudoPassword 获取 sudo 密码（仅用于服务端填充，不返回给前端）
// 前端如需配置应通过 Get/Set 通用接口操作 sudo_password
