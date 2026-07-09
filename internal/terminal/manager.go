package terminal

import (
	"fmt"
	"sync"
	"time"

	"github.com/linux-deploy-manager/internal/remote/sshclient"
)

// Session 表示一个活跃的终端会话
type Session struct {
	ID        string           `json:"id"`
	NodeID    uint             `json:"node_id"`
	NodeName  string           `json:"node_name"`
	User      string           `json:"user"`
	Host      string           `json:"host"`
	CreatedAt time.Time        `json:"created_at"`
	shell     *sshclient.ShellSession
	cancel    chan struct{}
}

// Manager 终端会话管理器
// 跟踪所有活跃的 SSH 终端连接
type Manager struct {
	mu       sync.RWMutex
	sessions map[string]*Session
}

// NewManager 创建终端会话管理器
func NewManager() *Manager {
	return &Manager{
		sessions: make(map[string]*Session),
	}
}

// Register 注册新会话
func (m *Manager) Register(id string, nodeID uint, nodeName, user, host string, shell *sshclient.ShellSession) *Session {
	s := &Session{
		ID:        id,
		NodeID:    nodeID,
		NodeName:  nodeName,
		User:      user,
		Host:      host,
		CreatedAt: time.Now(),
		shell:     shell,
		cancel:    make(chan struct{}),
	}

	m.mu.Lock()
	m.sessions[id] = s
	m.mu.Unlock()
	return s
}

// Unregister 注销会话
func (m *Manager) Unregister(id string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if s, ok := m.sessions[id]; ok {
		if s.shell != nil {
			s.shell.Close()
		}
		close(s.cancel)
		delete(m.sessions, id)
	}
}

// Get 获取会话
func (m *Manager) Get(id string) (*Session, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	s, ok := m.sessions[id]
	return s, ok
}

// List 列出所有活跃会话
func (m *Manager) List() []Session {
	m.mu.RLock()
	defer m.mu.RUnlock()
	result := make([]Session, 0, len(m.sessions))
	for _, s := range m.sessions {
		// 返回副本（不暴露内部 shell 指针）
		result = append(result, Session{
			ID:        s.ID,
			NodeID:    s.NodeID,
			NodeName:  s.NodeName,
			User:      s.User,
			Host:      s.Host,
			CreatedAt: s.CreatedAt,
		})
	}
	return result
}

// Count 返回活跃会话数
func (m *Manager) Count() int {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return len(m.sessions)
}

// CancelChan 返回会话取消信号
func (s *Session) CancelChan() <-chan struct{} {
	return s.cancel
}

// Shell 返回 ShellSession（注意并发安全由调用方保证）
func (s *Session) Shell() *sshclient.ShellSession {
	return s.shell
}

// GenerateID 生成会话 ID
func GenerateID(nodeID uint) string {
	return fmt.Sprintf("term_%d_%d", nodeID, time.Now().UnixNano())
}
