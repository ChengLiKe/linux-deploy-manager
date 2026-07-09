package handler

import (
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
	"github.com/linux-deploy-manager/internal/remote/sshclient"
	"github.com/linux-deploy-manager/internal/repository"
	"github.com/linux-deploy-manager/internal/service"
	"github.com/linux-deploy-manager/internal/terminal"
)

// TerminalMessage WebSocket 终端消息协议
type TerminalMessage struct {
	Type string          `json:"type"`          // input / resize / ping / pong
	Data json.RawMessage `json:"data,omitempty"` // 变长数据
}

// TerminalInput 终端输入
type TerminalInput struct {
	Text string `json:"text"`
}

// TerminalResize 终端调整大小
type TerminalResize struct {
	Cols int `json:"cols"`
	Rows int `json:"rows"`
}

// TerminalHandler WebSocket 终端处理器
type TerminalHandler struct {
	svc         *service.Service
	termManager *terminal.Manager
	serverNode  repository.ServerNodeRepository
	keyRepo     repository.KeyRepository
	upgrader    websocket.Upgrader
}

// NewTerminalHandler 创建终端处理器
func NewTerminalHandler(svc *service.Service, termManager *terminal.Manager, serverNodeRepo repository.ServerNodeRepository, keyRepo repository.KeyRepository, allowedOrigins []string) *TerminalHandler {
	return &TerminalHandler{
		svc:         svc,
		termManager: termManager,
		serverNode:  serverNodeRepo,
		keyRepo:     keyRepo,
		upgrader: websocket.Upgrader{
			CheckOrigin: func(r *http.Request) bool {
				if len(allowedOrigins) == 0 {
					return true
				}
				origin := r.Header.Get("Origin")
				for _, allowed := range allowedOrigins {
					if allowed == "*" || allowed == origin {
						return true
					}
				}
				return false
			},
		},
	}
}

// Handle 处理 SSH 终端 WebSocket 连接
// ws://host/ws/terminal/:node_id?token=xxx
func (h *TerminalHandler) Handle(c *gin.Context) {
	// 验证 JWT Token
	token := c.Query("token")
	if token == "" {
		token = c.GetHeader("Authorization")
		if len(token) > 7 && token[:7] == "Bearer " {
			token = token[7:]
		}
	}
	if token == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"code": 401001, "message": "缺少认证令牌"})
		return
	}
	if _, err := h.svc.Auth.ValidateToken(token); err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"code": 401002, "message": "认证令牌无效"})
		return
	}

	// 获取节点 ID
	nodeID, err := strconv.ParseUint(c.Param("node_id"), 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400001, "message": "无效的节点 ID"})
		return
	}

	// 获取节点信息
	node, err := h.serverNode.Get(uint(nodeID))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"code": 404001, "message": "服务器节点不存在"})
		return
	}

	// 升级为 WebSocket
	ws, err := h.upgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		slog.Error("ws upgrade failed", "error", err)
		return
	}

	// 创建 SSH 连接
	sshClient, err := sshclient.NewClientFromNode(node, h.keyRepo)
	if err != nil {
		ws.WriteJSON(gin.H{"type": "error", "message": fmt.Sprintf("SSH 连接失败: %s", err.Error())})
		ws.Close()
		return
	}
	defer sshClient.Close()

	// 打开交互式 Shell
	shell, err := sshClient.OpenShell()
	if err != nil {
		ws.WriteJSON(gin.H{"type": "error", "message": fmt.Sprintf("Shell 启动失败: %s", err.Error())})
		ws.Close()
		return
	}

	// 注册会话
	sessionID := terminal.GenerateID(uint(nodeID))
	h.termManager.Register(sessionID, uint(nodeID), node.Name, node.User, node.Host, shell)
	defer h.termManager.Unregister(sessionID)

	// 发送会话 ID
	ws.WriteJSON(gin.H{"type": "info", "session_id": sessionID, "message": "终端连接已建立"})

	// 管道：WebSocket ← SSH stdout
	errChan := make(chan error, 2)
	go func() {
		buf := make([]byte, 4096)
		for {
			n, readErr := shell.Stdout().Read(buf)
			if n > 0 {
				data := buf[:n]
				if writeErr := ws.WriteMessage(websocket.TextMessage, data); writeErr != nil {
					errChan <- writeErr
					return
				}
			}
			if readErr != nil {
				if readErr != io.EOF {
					errChan <- readErr
				}
				return
			}
		}
	}()

	// 管道：WebSocket ← SSH stderr
	go func() {
		buf := make([]byte, 4096)
		for {
			n, readErr := shell.Stderr().Read(buf)
			if n > 0 {
				data := buf[:n]
				msg, _ := json.Marshal(gin.H{"type": "stderr", "data": string(data)})
				if writeErr := ws.WriteMessage(websocket.TextMessage, msg); writeErr != nil {
					return
				}
			}
			if readErr != nil {
				return
			}
		}
	}()

	// 管道：WebSocket → SSH stdin（接收前端输入 + resize）
	ws.SetReadDeadline(time.Time{})
	ws.SetPongHandler(func(string) error {
		ws.SetReadDeadline(time.Time{})
		return nil
	})

	for {
		_, msgBytes, err := ws.ReadMessage()
		if err != nil {
			slog.Info("ws read error", "session_id", sessionID, "error", err)
			break
		}

		var msg TerminalMessage
		if err := json.Unmarshal(msgBytes, &msg); err != nil {
			continue // 忽略无法解析的消息
		}

		switch msg.Type {
		case "input":
			var input TerminalInput
			if json.Unmarshal(msg.Data, &input) == nil {
				shell.Stdin().Write([]byte(input.Text))
			}
		case "resize":
			var resize TerminalResize
			if json.Unmarshal(msg.Data, &resize) == nil && resize.Cols > 0 && resize.Rows > 0 {
				shell.Resize(resize.Rows, resize.Cols)
			}
		case "ping":
			ws.WriteJSON(gin.H{"type": "pong"})
		}
	}

	// 发送会话已关闭通知
	_ = ws.WriteJSON(gin.H{"type": "close", "message": "终端连接已断开"})

	// 等待 stdout 转发完成
	select {
	case <-errChan:
	default:
	}

	_ = ws.Close()
}

// ListSessions 获取所有活跃终端会话
func (h *TerminalHandler) ListSessions(c *gin.Context) {
	sessions := h.termManager.List()
	result := make([]gin.H, 0, len(sessions))
	for _, s := range sessions {
		result = append(result, gin.H{
			"id":         s.ID,
			"node_id":    s.NodeID,
			"node_name":  s.NodeName,
			"user":       s.User,
			"host":       fmt.Sprintf("%s:%d", s.Host, 22),
			"created_at": s.CreatedAt,
		})
	}
	c.JSON(http.StatusOK, gin.H{"code": 0, "data": result})
}

// DisconnectSession 断开指定终端会话
func (h *TerminalHandler) DisconnectSession(c *gin.Context) {
	sessionID := c.Param("session_id")
	if s, ok := h.termManager.Get(sessionID); ok {
		_ = s.Shell().Close()
		h.termManager.Unregister(sessionID)
		c.JSON(http.StatusOK, gin.H{"code": 0, "message": "会话已断开"})
	} else {
		c.JSON(http.StatusNotFound, gin.H{"code": 404002, "message": "会话不存在"})
	}
}
