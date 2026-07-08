package handler

import (
	"context"
	"net/http"
	"os"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/linux-deploy-manager/internal/model"
	"github.com/linux-deploy-manager/internal/nodeinit"
	"github.com/linux-deploy-manager/internal/remote/sshclient"
	"github.com/linux-deploy-manager/internal/repository"
	"github.com/linux-deploy-manager/internal/service"
	"gorm.io/gorm"
)

// InitHandler 节点初始化处理器
type InitHandler struct {
	svc           *service.Service
	engine        *nodeinit.InitEngine
	db            *gorm.DB
	serverNodeRepo repository.ServerNodeRepository
	keyRepo       repository.KeyRepository
}

// NewInitHandler 创建初始化处理器
func NewInitHandler(svc *service.Service, engine *nodeinit.InitEngine, db *gorm.DB, serverNodeRepo repository.ServerNodeRepository, keyRepo repository.KeyRepository) *InitHandler {
	return &InitHandler{svc: svc, engine: engine, db: db, serverNodeRepo: serverNodeRepo, keyRepo: keyRepo}
}

// Init 触发节点初始化
func (h *InitHandler) Init(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400070, "message": "无效的节点 ID"})
		return
	}

	node, err := h.serverNodeRepo.Get(uint(id))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"code": 404070, "message": "节点不存在"})
		return
	}

	// 异步执行初始化
	go func() {
		client, err := h.createSSHClient(node)
		if err != nil {
			return
		}
		defer client.Close()

		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
		defer cancel()

		h.engine.Execute(ctx, client, node)
	}()

	c.JSON(http.StatusOK, gin.H{"code": 0, "message": "节点初始化已触发（后台执行）"})
}

// InitLog 获取初始化日志
func (h *InitHandler) InitLog(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400071, "message": "无效的节点 ID"})
		return
	}

	var logs []model.NodeInitLog
	if err := h.db.Where("node_id = ?", uint(id)).Order("started_at ASC").Find(&logs).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500071, "message": "查询初始化日志失败"})
		return
	}

	// 获取节点最新状态
	node, _ := h.serverNodeRepo.Get(uint(id))
	initStatus := "unknown"
	if node != nil {
		initStatus = node.InitStatus
	}

	c.JSON(http.StatusOK, gin.H{"code": 0, "data": gin.H{
		"node_id":     id,
		"init_status": initStatus,
		"logs":        logs,
	}})
}

// createSSHClient 创建 SSH 客户端连接
func (h *InitHandler) createSSHClient(node *model.ServerNode) (*sshclient.Client, error) {
	ctx := context.Background()
	switch node.AuthType {
	case "key":
		if node.ServerKeyID == nil {
			return nil, nil
		}
		key, err := h.keyRepo.Get(*node.ServerKeyID)
		if err != nil {
			return nil, err
		}
		keyData, err := os.ReadFile(key.PrivatePath)
		if err != nil {
			return nil, err
		}
		client, err := sshclient.NewClientWithKey(node.Host, node.Port, node.User, keyData)
		if err != nil {
			return nil, err
		}
		if err := client.Connect(ctx); err != nil {
			client.Close()
			return nil, err
		}
		return client, nil
	case "password":
		client, err := sshclient.NewClientWithPassword(node.Host, node.Port, node.User, node.Password)
		if err != nil {
			return nil, err
		}
		if err := client.Connect(ctx); err != nil {
			client.Close()
			return nil, err
		}
		return client, nil
	default:
		return nil, nil
	}
}
