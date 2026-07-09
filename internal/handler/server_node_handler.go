package handler

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/linux-deploy-manager/internal/service"
)

// ServerNodeHandler 服务器节点处理器
type ServerNodeHandler struct {
	svc *service.Service
}

// NewServerNodeHandler 创建服务器节点处理器
func NewServerNodeHandler(svc *service.Service) *ServerNodeHandler {
	return &ServerNodeHandler{svc: svc}
}

// List 列出所有服务器节点
func (h *ServerNodeHandler) List(c *gin.Context) {
	nodes, err := h.svc.ServerNode.List()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500040, "message": "获取服务器节点列表失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"code": 0, "data": nodes})
}

// Create 创建服务器节点
func (h *ServerNodeHandler) Create(c *gin.Context) {
	var req service.CreateServerNodeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400040, "message": "请求参数错误：" + err.Error()})
		return
	}

	node, err := h.svc.ServerNode.Create(&req)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400041, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"code": 0, "data": node})
}

// Get 获取服务器节点详情
func (h *ServerNodeHandler) Get(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400042, "message": "无效的节点 ID"})
		return
	}

	node, err := h.svc.ServerNode.Get(uint(id))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"code": 404040, "message": "服务器节点不存在"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"code": 0, "data": node})
}

// Update 更新服务器节点
func (h *ServerNodeHandler) Update(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400043, "message": "无效的节点 ID"})
		return
	}

	var req service.UpdateServerNodeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400044, "message": "请求参数错误：" + err.Error()})
		return
	}

	node, err := h.svc.ServerNode.Update(uint(id), &req)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400045, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"code": 0, "data": node})
}

// Delete 删除服务器节点
func (h *ServerNodeHandler) Delete(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400046, "message": "无效的节点 ID"})
		return
	}

	if err := h.svc.ServerNode.Delete(uint(id)); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400047, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"code": 0, "message": "删除成功"})
}

// Test 测试 SSH 连通性
func (h *ServerNodeHandler) Test(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400048, "message": "无效的节点 ID"})
		return
	}

	node, err := h.svc.ServerNode.TestConnection(uint(id))
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"code": 0, "data": gin.H{
			"node":    node,
			"success": false,
			"message": err.Error(),
		}})
		return
	}
	c.JSON(http.StatusOK, gin.H{"code": 0, "data": gin.H{
		"node":    node,
		"success": true,
		"message": "连接成功",
	}})
}

// DistributeKey 下发 Git 密钥到目标服务器
func (h *ServerNodeHandler) DistributeKey(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400049, "message": "无效的节点 ID"})
		return
	}

	var req service.DistributeKeyRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400050, "message": "请求参数错误：" + err.Error()})
		return
	}

	if err := h.svc.ServerNode.DistributeKey(uint(id), &req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400051, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"code": 0, "message": "密钥下发成功"})
}

// ListRemoteDirReq 远程目录列表请求
type ListRemoteDirReq struct {
	Path string `json:"path" binding:"required"`
}

// DirEntry 目录项
type DirEntry struct {
	Name string `json:"name"`
	Path string `json:"path"`
}

// ListRemoteDir 列出远程服务器上的子目录
func (h *ServerNodeHandler) ListRemoteDir(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400052, "message": "无效的节点 ID"})
		return
	}

	var req ListRemoteDirReq
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400053, "message": "请求参数错误：" + err.Error()})
		return
	}

	// 创建 SSH 连接
	node, err := h.svc.ServerNode.Get(uint(id))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"code": 404003, "message": "服务器节点不存在"})
		return
	}

	client, err := h.svc.ServerNode.CreateSSHClient(node)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400054, "message": "SSH 连接失败：" + err.Error()})
		return
	}
	defer client.Close()

	// 执行 ls -d 列出目录
	cmd := fmt.Sprintf("ls -d %s/*/ 2>/dev/null || echo '__NO_DIRS__'", strings.TrimRight(req.Path, "/"))
	stdout, _, done, err := client.Execute(context.Background(), cmd)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400055, "message": "命令执行失败：" + err.Error()})
		return
	}

	out, _ := io.ReadAll(stdout)
	<-done

	output := strings.TrimSpace(string(out))
	var entries []DirEntry
	if output != "" && output != "__NO_DIRS__" {
		for _, line := range strings.Split(output, "\n") {
			line = strings.TrimSpace(line)
			if line == "" || line == "__NO_DIRS__" {
				continue
			}
			// ls -d 返回带 / 后缀的路径，如 /opt/apps/
			name := strings.TrimRight(line, "/")
			entries = append(entries, DirEntry{
				Name: name[strings.LastIndex(name, "/")+1:],
				Path: name,
			})
		}
	}

	c.JSON(http.StatusOK, gin.H{"code": 0, "data": gin.H{
		"entries": entries,
		"current": req.Path,
	}})
}
