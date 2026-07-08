package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/linux-deploy-manager/internal/auth"
)

// AuthHandler 认证处理器
type AuthHandler struct {
	auth *auth.Service
}

// Status 返回认证状态（是否首次运行）
func (h *AuthHandler) Status(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"code": 0, "data": gin.H{
		"is_first_run": h.auth.IsFirstRun(),
	}})
}

// NewAuthHandler 创建认证处理器
func NewAuthHandler(auth *auth.Service) *AuthHandler {
	return &AuthHandler{auth: auth}
}

// Setup 首次设置密码
func (h *AuthHandler) Setup(c *gin.Context) {
	if !h.auth.IsFirstRun() {
		c.JSON(http.StatusForbidden, gin.H{"code": 403001, "message": "密码已设置，如需修改请使用修改密码接口"})
		return
	}

	var req struct {
		Password string `json:"password" binding:"required,min=8"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400001, "message": "密码长度至少 8 位"})
		return
	}

	if err := h.auth.SetupPassword(req.Password); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500001, "message": "设置密码失败"})
		return
	}

	token, err := h.auth.GenerateToken()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500002, "message": "生成 Token 失败"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"code": 0, "data": gin.H{"token": token}})
}

// Login 登录
func (h *AuthHandler) Login(c *gin.Context) {
	if h.auth.IsFirstRun() {
		c.JSON(http.StatusForbidden, gin.H{"code": 403002, "message": "请先设置密码"})
		return
	}

	var req struct {
		Password string `json:"password" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400002, "message": "请提供密码"})
		return
	}

	if !h.auth.VerifyPassword(req.Password) {
		c.JSON(http.StatusUnauthorized, gin.H{"code": 401003, "message": "密码错误"})
		return
	}

	token, err := h.auth.GenerateToken()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500003, "message": "生成 Token 失败"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"code": 0, "data": gin.H{"token": token}})
}

// ChangePassword 修改密码
func (h *AuthHandler) ChangePassword(c *gin.Context) {
	var req struct {
		OldPassword string `json:"old_password" binding:"required"`
		NewPassword string `json:"new_password" binding:"required,min=8"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400003, "message": "旧密码和新密码不能为空，新密码至少 8 位"})
		return
	}

	if err := h.auth.ChangePassword(req.OldPassword, req.NewPassword); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400004, "message": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"code": 0, "message": "密码修改成功"})
}
