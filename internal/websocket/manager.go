package websocket

import (
	"fmt"
	"log/slog"
	"net/http"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
)

// Manager WebSocket 管理器
type Manager struct {
	upgrader     websocket.Upgrader
	clients      map[string]map[*Client]bool // task_id -> clients
	mu           sync.RWMutex
	getLogBuffer func(taskID string) LogBuffer
}

// LogBuffer 日志缓冲区接口（避免依赖 deployer 包）
type LogBuffer interface {
	GetLines() []string
	Subscribe() chan string
	Unsubscribe(ch chan string)
}

// NewManager 创建 WebSocket 管理器
func NewManager() *Manager {
	return &Manager{
		upgrader: websocket.Upgrader{
			CheckOrigin: func(r *http.Request) bool {
				return true // 开发模式允许所有来源
			},
		},
		clients: make(map[string]map[*Client]bool),
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
	unsubscribe func() // 日志取消订阅函数
}

// Handle WebSocket 连接处理
func (m *Manager) Handle(c *gin.Context) {
	taskID := c.Param("task_id")
	if taskID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400050, "message": "缺少任务 ID"})
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

	// 如果任务已有日志缓冲区，推送历史日志并订阅新日志
	if m.getLogBuffer != nil {
		if buf := m.getLogBuffer(taskID); buf != nil {
			// 发送历史日志
			for _, line := range buf.GetLines() {
				data := []byte(fmt.Sprintf(`{"type":"log","data":%q,"timestamp":%q}`, line, time.Now().Format(time.RFC3339)))
				select {
				case client.Send <- data:
				default:
				}
			}
			// 订阅新日志
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

// register 注册客户端
func (m *Manager) register(client *Client) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.clients[client.TaskID] == nil {
		m.clients[client.TaskID] = make(map[*Client]bool)
	}
	m.clients[client.TaskID][client] = true
	slog.Info("websocket client registered", "task_id", client.TaskID)
}

// unregister 注销客户端
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
	// 取消日志订阅
	if client.unsubscribe != nil {
		client.unsubscribe()
	}
	slog.Info("websocket client unregistered", "task_id", client.TaskID)
}

// SendToTask 向指定任务推送日志
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
			// 通道满，丢弃消息
		}
	}
}

// SubscribeLogBuffer 订阅日志缓冲区，将日志转发到 WebSocket 客户端
func (m *Manager) SubscribeLogBuffer(taskID string, logCh <-chan string) {
	go m.forwardLogs(taskID, logCh)
}

// forwardLogs 将日志通道数据转发到 WebSocket 客户端
func (m *Manager) forwardLogs(taskID string, logCh <-chan string) {
	for line := range logCh {
		data := []byte(fmt.Sprintf(`{"type":"log","data":%q,"timestamp":%q}`, line, time.Now().Format(time.RFC3339)))
		m.SendToTask(taskID, data)
	}
	// 日志通道关闭，发送状态更新
	data := []byte(fmt.Sprintf(`{"type":"status","status":"completed"}`))
	m.SendToTask(taskID, data)
}

// writePump 向客户端发送消息
func (c *Client) writePump() {
	defer c.Conn.Close()
	for message := range c.Send {
		if err := c.Conn.WriteMessage(websocket.TextMessage, message); err != nil {
			return
		}
	}
}

// readPump 读取客户端消息
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
