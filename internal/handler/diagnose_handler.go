package handler

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/linux-deploy-manager/internal/connectivity"
	"github.com/linux-deploy-manager/internal/service"
)

// DiagnoseHandler 连通性诊断处理器
type DiagnoseHandler struct {
	svc      *service.Service
	diagnoser *connectivity.ConnectivityDiagnoser
}

// NewDiagnoseHandler 创建诊断处理器
func NewDiagnoseHandler(svc *service.Service, diagnoser *connectivity.ConnectivityDiagnoser) *DiagnoseHandler {
	return &DiagnoseHandler{svc: svc, diagnoser: diagnoser}
}

// Diagnose 执行连通性诊断
func (h *DiagnoseHandler) Diagnose(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400070, "message": "无效的节点 ID"})
		return
	}

	report, err := h.diagnoser.Diagnose(uint(id), nil)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500070, "message": "诊断执行失败: " + err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"code": 0, "data": gin.H{
		"report":      report,
		"node_status": report.Overall,
	}})
}
