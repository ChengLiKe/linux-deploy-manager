package sshclient

import (
	"fmt"
	"io"

	"golang.org/x/crypto/ssh"
)

// ShellSession 封装一个交互式 SSH Shell 会话
// 包含 PTY（伪终端）支持和双向字节流管道
type ShellSession struct {
	session *ssh.Session
	stdin   io.WriteCloser
	stdout  io.Reader
	stderr  io.Reader
}

// OpenShell 在已连接的 SSH Client 上打开一个交互式 Shell
// 返回的 ShellSession 需要由调用方管理生命周期
func (c *Client) OpenShell() (*ShellSession, error) {
	c.mu.Lock()
	if c.closed || c.client == nil {
		c.mu.Unlock()
		return nil, fmt.Errorf("ssh client not connected")
	}
	c.mu.Unlock()

	session, err := c.client.NewSession()
	if err != nil {
		return nil, fmt.Errorf("new session: %w", err)
	}

	// 申请 PTY（使用 xterm-256color 默认 80x24）
	modes := ssh.TerminalModes{
		ssh.ECHO:          1,     // 启用回显
		ssh.TTY_OP_ISPEED: 14400, // input speed
		ssh.TTY_OP_OSPEED: 14400, // output speed
	}
	if err := session.RequestPty("xterm-256color", 24, 80, modes); err != nil {
		session.Close()
		return nil, fmt.Errorf("request pty: %w", err)
	}

	stdin, err := session.StdinPipe()
	if err != nil {
		session.Close()
		return nil, fmt.Errorf("stdin pipe: %w", err)
	}

	stdout, err := session.StdoutPipe()
	if err != nil {
		session.Close()
		return nil, fmt.Errorf("stdout pipe: %w", err)
	}

	stderr, err := session.StderrPipe()
	if err != nil {
		session.Close()
		return nil, fmt.Errorf("stderr pipe: %w", err)
	}

	// 启动 Shell
	if err := session.Shell(); err != nil {
		session.Close()
		return nil, fmt.Errorf("start shell: %w", err)
	}

	return &ShellSession{
		session: session,
		stdin:   stdin,
		stdout:  stdout,
		stderr:  stderr,
	}, nil
}

// Resize 调整 PTY 窗口大小
func (s *ShellSession) Resize(rows, cols int) error {
	return s.session.WindowChange(rows, cols)
}

// Stdin 返回 stdin 写入器（用于向 Shell 发送输入）
func (s *ShellSession) Stdin() io.WriteCloser {
	return s.stdin
}

// Stdout 返回 stdout 读取器（用于读取 Shell 输出）
func (s *ShellSession) Stdout() io.Reader {
	return s.stdout
}

// Stderr 返回 stderr 读取器
func (s *ShellSession) Stderr() io.Reader {
	return s.stderr
}

// Wait 等待 Shell 会话结束，返回退出状态
func (s *ShellSession) Wait() error {
	return s.session.Wait()
}

// Close 关闭 Shell 会话
func (s *ShellSession) Close() error {
	return s.session.Close()
}
