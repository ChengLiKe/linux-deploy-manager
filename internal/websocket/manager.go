package websocket

import (
	"fmt"
	"log/slog"
	"net/http"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
	"github.com/linux-deploy-manager/internal/auth"
)

// Manager WebSocket 管理器
type Manager struct {
	upgrader     websocket.Upgrader
	clients      map[string]map[*Client]bool
	mu           sync.RWMutex
	getLogBuffer func(taskID string) LogBuffer
	authService  *auth.Service
}

// LogBuffer 日志缓冲区接口（避免依赖 deployer 包）
type LogBuffer interface {
	GetLines() []string
	Subscribe() chan string
	Unsubscribe(ch chan string)
}

// NewManager 创建 WebSocket 管理器
func NewManager(authService *auth.Service, allowedOrigins []string) *Manager {
	return &Manager{
		upgrader: websocket.Upgrader{
			CheckOrigin: func(r *http.Request) bool {
				origin := r.Header.Get("Origin")
				if origin == "" {
					return true
				}
				for _, allowed := range allowedOrigins {
					if allowed == "*" || allowed == origin {
						return true
					}
				}
				return false
			},
		},
		clients:     make(map[string]map[*Client]bool),
		authService: authService,
	}
}

// SetLogBufferGetter 设置日志缓冲区获取函数
func (m *Manager) SetLogBufferGetter(fn func(taskID string) LogBuffer) {
	m.getLogBuffer = fn
}

// Client WebSocket 客户端
type Client struct {
	TaskID      string
	Conn        *websocket.Conn
	Send        chan []byte
	unsubscribe func()
}

// Handle WebSocket 连接处理（含 JWT 鉴权）
func (m *Manager) Handle(c *gin.Context) {
	taskID := c.Param("task_id")
	if taskID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400050, "message": "缺少任务 ID"})
		return
	}

	// JWT 鉴权：优先从 query token 参数获取，其次从 Authorization header
	tokenStr := c.Query("token")
	if tokenStr == "" {
		tokenStr = c.GetHeader("Authorization")
		if len(tokenStr) > 7 && tokenStr[:7] == "Bearer " {
			tokenStr = tokenStr[7:]
		}
	}
	if tokenStr == "" || !m.validateToken(tokenStr) {
		c.JSON(http.StatusUnauthorized, gin.H{"code": 401050, "message": "WebSocket 需要有效的 Token"})
		return
	}

	conn, err := m.upgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		slog.Error("websocket upgrade failed", "error", err, "task_id", taskID)
		return
	}

	client := &Client{
		TaskID: taskID,
		Conn:   conn,
		Send:   make(chan []byte, 256),
	}

	m.register(client)

	if m.getLogBuffer != nil {
		if buf := m.getLogBuffer(taskID); buf != nil {
			for _, line := range buf.GetLines() {
				data := []byte(fmt.Sprintf(`{"type":"log","data":%q,"timestamp":%q}`, line, time.Now().Format(time.RFC3339)))
				select {
				case client.Send <- data:
				default:
				}
			}
			logCh := buf.Subscribe()
			client.unsubscribe = func() {
				buf.Unsubscribe(logCh)
			}
			go m.forwardLogs(taskID, logCh)
		}
	}

	go client.writePump()
	go client.readPump(m)
}

// validateToken 校验 JWT token，使用 auth.Service
func (m *Manager) validateToken(tokenStr string) bool {
	if m.authService == nil {
		return true // 无认证服务时不校验（开发模式）
	}
	_, err := m.authService.ValidateToken(tokenStr)
	return err == nil
}

func (m *Manager) register(client *Client) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.clients[client.TaskID] == nil {
		m.clients[client.TaskID] = make(map[*Client]bool)
	}
	m.clients[client.TaskID][client] = true
	slog.Info("websocket client registered", "task_id", client.TaskID)
}

func (m *Manager) unregister(client *Client) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if clients, ok := m.clients[client.TaskID]; ok {
		delete(clients, client)
		if len(clients) == 0 {
			delete(m.clients, client.TaskID)
		}
	}
	close(client.Send)
	client.Conn.Close()
	if client.unsubscribe != nil {
		client.unsubscribe()
	}
	slog.Info("websocket client unregistered", "task_id", client.TaskID)
}

func (m *Manager) SendToTask(taskID string, data []byte) {
	m.mu.RLock()
	clients, ok := m.clients[taskID]
	m.mu.RUnlock()
	if !ok {
		return
	}
	for client := range clients {
		select {
		case client.Send <- data:
		default:
		}
	}
}

func (m *Manager) forwardLogs(taskID string, logCh <-chan string) {
	for line := range logCh {
		data := []byte(fmt.Sprintf(`{"type":"log","data":%q,"timestamp":%q}`, line, time.Now().Format(time.RFC3339)))
		m.SendToTask(taskID, data)
	}
	data := []byte(fmt.Sprintf(`{"type":"status","status":"completed"}`))
	m.SendToTask(taskID, data)
}

func (c *Client) writePump() {
	defer c.Conn.Close()
	for message := range c.Send {
		if err := c.Conn.WriteMessage(websocket.TextMessage, message); err != nil {
			return
		}
	}
}

func (c *Client) readPump(m *Manager) {
	defer m.unregister(c)
	for {
		_, _, err := c.Conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				slog.Error("websocket read error", "error", err, "task_id", c.TaskID)
			}
			break
		}
	}
}
