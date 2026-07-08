package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/linux-deploy-manager/internal/fs"
)

// FSHandler 文件系统处理器
type FSHandler struct{}

// NewFSHandler 创建文件系统处理器
func NewFSHandler() *FSHandler {
	return &FSHandler{}
}

// ListDir 列出目录
func (h *FSHandler) ListDir(c *gin.Context) {
	path := c.Query("path")
	if path == "" {
		path = "/"
	}

	entries, err := fs.ListDir(path)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400050, "message": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"code": 0, "data": gin.H{"entries": entries}})
}

// CheckDirReq 目录检查请求
type CheckDirReq struct {
	CodeDir string `json:"code_dir" binding:"required"`
	Name    string `json:"name" binding:"required"`
	GitURL  string `json:"git_url" binding:"required"`
}

// CheckDir 检查目标部署目录状态
func (h *FSHandler) CheckDir(c *gin.Context) {
	var req CheckDirReq
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400051, "message": "请求参数错误：" + err.Error()})
		return
	}

	result, err := fs.CheckDir(req.CodeDir, req.Name, req.GitURL)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400052, "message": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"code": 0, "data": result})
}
