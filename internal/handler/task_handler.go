package handler

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/linux-deploy-manager/internal/service"
)

// TaskHandler 部署任务处理器
type TaskHandler struct {
	svc *service.TaskService
}

// NewTaskHandler 创建任务处理器
func NewTaskHandler(svc *service.Service) *TaskHandler {
	return &TaskHandler{svc: svc.Task}
}

// List 列出部署任务
func (h *TaskHandler) List(c *gin.Context) {
	var projectID uint
	if id := c.Query("project_id"); id != "" {
		if val, err := strconv.ParseUint(id, 10, 32); err == nil {
			projectID = uint(val)
		}
	}
	status := c.Query("status")
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "20"))

	tasks, total, err := h.svc.List(projectID, status, page, pageSize)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500030, "message": "获取任务列表失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"code": 0, "data": gin.H{"total": total, "items": tasks}})
}

// Get 获取任务详情
func (h *TaskHandler) Get(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400040, "message": "无效的任务 ID"})
		return
	}

	task, err := h.svc.Get(uint(id))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"code": 404030, "message": "任务不存在"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"code": 0, "data": task})
}

// Log 获取日志内容（优先从内存缓冲区读取，否则读文件）
func (h *TaskHandler) Log(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400041, "message": "无效的任务 ID"})
		return
	}

	content, err := h.svc.GetLog(uint(id))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500031, "message": "读取日志失败: " + err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"code": 0, "data": gin.H{
		"task_id": id,
		"content": content,
	}})
}

// Cancel 取消部署
func (h *TaskHandler) Cancel(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400042, "message": "无效的任务 ID"})
		return
	}

	if err := h.svc.CancelDeploy(uint(id)); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400043, "message": "取消失败: " + err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"code": 0, "message": "取消成功"})
}

// Download 下载日志文件
func (h *TaskHandler) Download(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400043, "message": "无效的任务 ID"})
		return
	}

	// TODO: 读取日志文件并返回下载
	_ = id
	c.JSON(http.StatusOK, gin.H{"code": 0, "message": "下载功能待实现"})
}
