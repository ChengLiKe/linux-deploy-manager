package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/linux-deploy-manager/internal/service"
)

// FixHandler 一键修复处理器
type FixHandler struct {
	svc *service.Service
}

// NewFixHandler 创建修复处理器
func NewFixHandler(svc *service.Service) *FixHandler {
	return &FixHandler{svc: svc}
}

// AutoFix 执行一键修复
func (h *FixHandler) AutoFix(c *gin.Context) {
	var req service.AutoFixRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400080, "message": "请求参数错误：" + err.Error()})
		return
	}

	result, err := h.svc.Fix.ExecuteFix(req.NodeID, req.FixType)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500080, "message": "修复执行失败: " + err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"code": 0, "data": result})
}
