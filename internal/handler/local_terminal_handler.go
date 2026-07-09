package handler

import (
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"os/exec"
	"runtime"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
	"github.com/linux-deploy-manager/internal/auth"
)

// LocalTerminalHandler 本地终端 WebSocket 处理器
// 提供连接 Go 服务器本地 shell 的能力，不经过 SSH
type LocalTerminalHandler struct {
	authService *auth.Service
	upgrader    websocket.Upgrader
}

// NewLocalTerminalHandler 创建本地终端处理器
func NewLocalTerminalHandler(authService *auth.Service, allowedOrigins []string) *LocalTerminalHandler {
	return &LocalTerminalHandler{
		authService: authService,
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
	}
}

// Handle 处理本地终端 WebSocket 连接
// ws://host/ws/terminal/local?token=xxx
func (h *LocalTerminalHandler) Handle(c *gin.Context) {
	// JWT 验证
	tokenStr := c.Query("token")
	if tokenStr == "" {
		tokenStr = c.GetHeader("Authorization")
		if len(tokenStr) > 7 && tokenStr[:7] == "Bearer " {
			tokenStr = tokenStr[7:]
		}
	}
	if !h.validateToken(tokenStr) {
		c.JSON(http.StatusUnauthorized, gin.H{"code": 401003, "message": "WebSocket 需要有效的 Token"})
		return
	}

	ws, err := h.upgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		slog.Error("local ws upgrade failed", "error", err)
		return
	}

	hostname, _ := os.Hostname()

	// 发送连接信息
	_ = ws.WriteJSON(gin.H{
		"type":      "info",
		"session_id": fmt.Sprintf("local_%d", time.Now().UnixNano()),
		"node_name": fmt.Sprintf("本地终端 - %s", hostname),
		"message":   "本地终端连接已建立",
	})

	// 启动本地 shell
	var cmd *exec.Cmd
	if runtime.GOOS == "windows" {
		cmd = exec.Command("cmd.exe")
	} else {
		cmd = exec.Command("bash", "--login")
	}

	// 继承当前环境变量
	cmd.Env = os.Environ()
	cmd.Dir = homeDir()

	stdin, err := cmd.StdinPipe()
	if err != nil {
		_ = ws.WriteJSON(gin.H{"type": "error", "message": fmt.Sprintf("创建 stdin 管道失败: %v", err)})
		ws.Close()
		return
	}

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		_ = ws.WriteJSON(gin.H{"type": "error", "message": fmt.Sprintf("创建 stdout 管道失败: %v", err)})
		ws.Close()
		return
	}

	stderr, err := cmd.StderrPipe()
	if err != nil {
		_ = ws.WriteJSON(gin.H{"type": "error", "message": fmt.Sprintf("创建 stderr 管道失败: %v", err)})
		ws.Close()
		return
	}

	if err := cmd.Start(); err != nil {
		_ = ws.WriteJSON(gin.H{"type": "error", "message": fmt.Sprintf("启动 shell 失败: %v", err)})
		ws.Close()
		return
	}

	// 输出管道：shell stdout → WebSocket
	errChan := make(chan error, 3)
	go func() {
		buf := make([]byte, 32768)
		for {
			n, readErr := stdout.Read(buf)
			if n > 0 {
				if writeErr := ws.WriteMessage(websocket.TextMessage, buf[:n]); writeErr != nil {
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

	// stderr 管道
	go func() {
		buf := make([]byte, 4096)
		for {
			n, readErr := stderr.Read(buf)
			if n > 0 {
				msg, _ := json.Marshal(gin.H{"type": "stderr", "data": string(buf[:n])})
				if writeErr := ws.WriteMessage(websocket.TextMessage, msg); writeErr != nil {
					return
				}
			}
			if readErr != nil {
				return
			}
		}
	}()

	// 读超时 & pong
	ws.SetReadDeadline(time.Now().Add(60 * time.Second))
	ws.SetPongHandler(func(string) error {
		ws.SetReadDeadline(time.Now().Add(60 * time.Second))
		return nil
	})

	// 接收前端输入 → shell stdin
	for {
		_, msgBytes, err := ws.ReadMessage()
		if err != nil {
			slog.Info("local terminal ws read error", "error", err)
			break
		}

		var msg struct {
			Type string          `json:"type"`
			Data json.RawMessage `json:"data,omitempty"`
		}
		if err := json.Unmarshal(msgBytes, &msg); err != nil {
			continue
		}

		switch msg.Type {
		case "input":
			var input struct {
				Text string `json:"text"`
			}
			if json.Unmarshal(msg.Data, &input) == nil {
				_, _ = stdin.Write([]byte(input.Text))
			}
		case "ping":
			_ = ws.WriteJSON(gin.H{"type": "pong"})
		}
	}

	// 清理
	stdin.Close()
	_ = cmd.Process.Kill()
	_ = cmd.Wait()
	_ = ws.WriteJSON(gin.H{"type": "close", "message": "本地终端已断开"})
	ws.Close()
}

func (h *LocalTerminalHandler) validateToken(tokenStr string) bool {
	if h.authService == nil {
		return true
	}
	_, err := h.authService.ValidateToken(tokenStr)
	return err == nil
}

func homeDir() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return "."
	}
	return home
}
