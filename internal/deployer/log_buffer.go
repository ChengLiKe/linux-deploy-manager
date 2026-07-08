package deployer

import (
	"fmt"
	"sync"
	"time"
)

// LogBuffer 日志缓冲区，支持实时订阅
type LogBuffer struct {
	mu          sync.RWMutex
	lines       []string
	subscribers []chan string
}

// NewLogBuffer 创建新的日志缓冲区
func NewLogBuffer() *LogBuffer {
	return &LogBuffer{
		lines:       make([]string, 0, 1024),
		subscribers: make([]chan string, 0),
	}
}

// Write 写入一行原始日志
func (lb *LogBuffer) Write(line string) {
	lb.mu.Lock()
	lb.lines = append(lb.lines, line)
	subs := make([]chan string, len(lb.subscribers))
	copy(subs, lb.subscribers)
	lb.mu.Unlock()

	// 广播给所有订阅者（安全处理关闭的通道）
	for _, ch := range subs {
		func() {
			defer func() {
				if recover() != nil {
					// 通道已关闭，忽略
				}
			}()
			select {
			case ch <- line:
			default:
			}
		}()
	}
}

// Writef 格式化写入日志
func (lb *LogBuffer) Writef(format string, args ...interface{}) {
	line := fmt.Sprintf("[%s] %s", time.Now().Format("15:04:05"), fmt.Sprintf(format, args...))
	lb.Write(line)
}

// GetLines 获取所有日志行
func (lb *LogBuffer) GetLines() []string {
	lb.mu.RLock()
	defer lb.mu.RUnlock()
	result := make([]string, len(lb.lines))
	copy(result, lb.lines)
	return result
}

// Subscribe 订阅日志通道
func (lb *LogBuffer) Subscribe() chan string {
	lb.mu.Lock()
	defer lb.mu.Unlock()
	ch := make(chan string, 100)
	lb.subscribers = append(lb.subscribers, ch)
	return ch
}

// Unsubscribe 取消订阅
func (lb *LogBuffer) Unsubscribe(ch chan string) {
	lb.mu.Lock()
	defer lb.mu.Unlock()
	for i, sub := range lb.subscribers {
		if sub == ch {
			close(sub)
			lb.subscribers = append(lb.subscribers[:i], lb.subscribers[i+1:]...)
			return
		}
	}
}
