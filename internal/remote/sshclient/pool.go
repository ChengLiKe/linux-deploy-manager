package sshclient

import (
	"fmt"
	"sync"
	"time"

	"golang.org/x/sync/singleflight"
)

// Pool SSH 连接池，按 serverNodeID 管理连接
type Pool struct {
	clients    map[uint]*poolEntry
	mu         sync.RWMutex
	ttl        time.Duration
	maxIdle    int
	sg         singleflight.Group // 防惊群
}

type poolEntry struct {
	client     *Client
	lastUsedAt time.Time
}

// PoolOption 连接池配置选项
type PoolOption func(*Pool)

// WithTTL 设置连接存活时间
func WithTTL(ttl time.Duration) PoolOption {
	return func(p *Pool) {
		p.ttl = ttl
	}
}

// NewPool 创建 SSH 连接池
func NewPool(opts ...PoolOption) *Pool {
	p := &Pool{
		clients: make(map[uint]*poolEntry),
		ttl:     5 * time.Minute,
	}
	for _, opt := range opts {
		opt(p)
	}
	// 启动后台清理协程
	go p.cleanupLoop()
	return p
}

// GetOrCreate 获取或创建连接（使用 singleflight 防惊群）
func (p *Pool) GetOrCreate(nodeID uint, factory func() (*Client, error)) (*Client, error) {
	// 尝试复用现有连接（读锁快速路径）
	p.mu.RLock()
	entry, ok := p.clients[nodeID]
	p.mu.RUnlock()
	if ok && entry.client != nil && entry.client.IsConnected() {
		p.mu.Lock()
		entry.lastUsedAt = time.Now()
		p.mu.Unlock()
		return entry.client, nil
	}

	// 使用 singleflight 确保同一个 nodeID 只有一个 goroutine 执行 factory()
	key := fmt.Sprintf("node-%d", nodeID)
	result, err, _ := p.sg.Do(key, func() (interface{}, error) {
		// 再检查一次（double-check）：在等待 singleflight 锁期间可能已有其他 goroutine 创建了连接
		p.mu.RLock()
		entry, ok := p.clients[nodeID]
		p.mu.RUnlock()
		if ok && entry.client != nil && entry.client.IsConnected() {
			return entry.client, nil
		}

		newClient, err := factory()
		if err != nil {
			return nil, err
		}

		p.mu.Lock()
		if oldEntry, ok := p.clients[nodeID]; ok && oldEntry.client != nil {
			go oldEntry.client.Close()
		}
		p.clients[nodeID] = &poolEntry{
			client:     newClient,
			lastUsedAt: time.Now(),
		}
		p.mu.Unlock()
		return newClient, nil
	})
	if err != nil {
		return nil, err
	}
	return result.(*Client), nil
}

// Get 获取已有连接（不创建）
func (p *Pool) Get(nodeID uint) (*Client, bool) {
	p.mu.RLock()
	defer p.mu.RUnlock()
	entry, ok := p.clients[nodeID]
	if !ok || entry.client == nil {
		return nil, false
	}
	return entry.client, true
}

// Remove 移除并关闭连接
func (p *Pool) Remove(nodeID uint) {
	p.mu.Lock()
	entry, ok := p.clients[nodeID]
	if ok && entry.client != nil {
		go entry.client.Close()
	}
	delete(p.clients, nodeID)
	p.mu.Unlock()
}

// CloseAll 关闭所有连接
func (p *Pool) CloseAll() {
	p.mu.Lock()
	for _, entry := range p.clients {
		if entry.client != nil {
			go entry.client.Close()
		}
	}
	p.clients = make(map[uint]*poolEntry)
	p.mu.Unlock()
}

// cleanupLoop 定期清理过期连接
func (p *Pool) cleanupLoop() {
	ticker := time.NewTicker(1 * time.Minute)
	defer ticker.Stop()
	for range ticker.C {
		p.cleanup()
	}
}

func (p *Pool) cleanup() {
	p.mu.Lock()
	defer p.mu.Unlock()
	now := time.Now()
	for id, entry := range p.clients {
		if now.Sub(entry.lastUsedAt) > p.ttl {
			if entry.client != nil {
				go entry.client.Close()
			}
			delete(p.clients, id)
		}
	}
}
