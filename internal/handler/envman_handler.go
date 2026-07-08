package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/linux-deploy-manager/internal/envman"
)

// EnvManHandler 环境管理工具处理器
type EnvManHandler struct{}

// NewEnvManHandler 创建处理器
func NewEnvManHandler() *EnvManHandler {
	return &EnvManHandler{}
}

// Detect 检测服务器上安装的环境管理工具
func (h *EnvManHandler) Detect(c *gin.Context) {
	tools := envman.DetectAll()
	c.JSON(http.StatusOK, gin.H{"code": 0, "data": gin.H{"tools": tools}})
}

// ListEnvs 列出指定工具的环境
func (h *EnvManHandler) ListEnvs(c *gin.Context) {
	tool := c.Query("tool")
	if tool == "" {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400060, "message": "缺少 tool 参数"})
		return
	}
	envs, err := envman.ListEnvs(tool)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400061, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"code": 0, "data": gin.H{"envs": envs}})
}

// CreateEnv 创建新的环境
func (h *EnvManHandler) CreateEnv(c *gin.Context) {
	var req struct {
		Tool string `json:"tool" binding:"required"`
		Env  string `json:"env" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400062, "message": "参数错误: " + err.Error()})
		return
	}
	if err := envman.CreateEnv(req.Tool, req.Env); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400063, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"code": 0, "message": "环境创建成功"})
}
