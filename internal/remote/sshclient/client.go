package sshclient

import (
	"context"
	"fmt"
	"io"
	"net"
	"strings"
	"sync"
	"time"

	"golang.org/x/crypto/ssh"
)

// Client 封装一个 SSH 客户端连接
type Client struct {
	client *ssh.Client
	config *ssh.ClientConfig
	host   string
	port   int
	mu     sync.Mutex
	closed bool
}

// NewClientWithKey 创建基于公钥认证的 SSH 客户端（不立即连接）
func NewClientWithKey(host string, port int, user string, privateKey []byte) (*Client, error) {
	signer, err := ssh.ParsePrivateKey(privateKey)
	if err != nil {
		return nil, fmt.Errorf("parse private key: %w", err)
	}

	config := &ssh.ClientConfig{
		User:            user,
		Auth:            []ssh.AuthMethod{ssh.PublicKeys(signer)},
		HostKeyCallback: ssh.InsecureIgnoreHostKey(), // MVP 阶段，后续支持 known_hosts
		Timeout:         10 * time.Second,
	}

	return &Client{config: config, host: host, port: port}, nil
}

// NewClientWithPassword 创建基于密码认证的 SSH 客户端（不立即连接）
func NewClientWithPassword(host string, port int, user, password string) (*Client, error) {
	config := &ssh.ClientConfig{
		User:            user,
		Auth:            []ssh.AuthMethod{ssh.Password(password)},
		HostKeyCallback: ssh.InsecureIgnoreHostKey(), // MVP 阶段，后续支持 known_hosts
		Timeout:         10 * time.Second,
	}

	return &Client{config: config, host: host, port: port}, nil
}

// Connect 建立 TCP + SSH 连接
func (c *Client) Connect(ctx context.Context) error {
	addr := fmt.Sprintf("%s:%d", c.host, c.port)
	conn, err := (&net.Dialer{Timeout: 10 * time.Second}).DialContext(ctx, "tcp", addr)
	if err != nil {
		return fmt.Errorf("dial %s: %w", addr, err)
	}

	sshConn, chans, reqs, err := ssh.NewClientConn(conn, addr, c.config)
	if err != nil {
		conn.Close()
		return fmt.Errorf("ssh handshake: %w", err)
	}

	c.mu.Lock()
	c.client = ssh.NewClient(sshConn, chans, reqs)
	c.closed = false
	c.mu.Unlock()

	return nil
}

// NewSession 创建一个新的 SSH Session
func (c *Client) NewSession() (*ssh.Session, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.closed || c.client == nil {
		return nil, fmt.Errorf("ssh client not connected")
	}
	return c.client.NewSession()
}

// Execute 执行远程命令，返回 stdout/stderr reader 和 done channel
func (c *Client) Execute(ctx context.Context, command string) (stdout io.Reader, stderr io.Reader, done <-chan error, err error) {
	session, err := c.NewSession()
	if err != nil {
		return nil, nil, nil, err
	}

	stdout, err = session.StdoutPipe()
	if err != nil {
		session.Close()
		return nil, nil, nil, fmt.Errorf("stdout pipe: %w", err)
	}

	stderr, err = session.StderrPipe()
	if err != nil {
		session.Close()
		return nil, nil, nil, fmt.Errorf("stderr pipe: %w", err)
	}

	errChan := make(chan error, 1)
	go func() {
		defer session.Close()
		defer close(errChan)
		if err := session.Run(command); err != nil {
			errChan <- err
		}
	}()

	return stdout, stderr, errChan, nil
}

// ExecuteWithEnv 执行命令并注入环境变量（通过 export 前缀包装）
func (c *Client) ExecuteWithEnv(ctx context.Context, command string, env map[string]string) (stdout io.Reader, stderr io.Reader, done <-chan error, err error) {
	if len(env) > 0 {
		command = wrapEnvCommand(command, env)
	}
	return c.Execute(ctx, command)
}

// ExecuteWithWorkDir 执行命令并设置工作目录（通过 cd 前缀包装）
func (c *Client) ExecuteWithWorkDir(ctx context.Context, command, workDir string, env map[string]string) (stdout io.Reader, stderr io.Reader, done <-chan error, err error) {
	if workDir != "" {
		command = fmt.Sprintf("cd %s && %s", workDir, command)
	}
	if len(env) > 0 {
		command = wrapEnvCommand(command, env)
	}
	return c.Execute(ctx, command)
}

// Close 关闭连接
func (c *Client) Close() error {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.closed = true
	if c.client != nil {
		return c.client.Close()
	}
	return nil
}

// IsConnected 检查连接状态
func (c *Client) IsConnected() bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.client == nil || c.closed {
		return false
	}
	// 发送 keep-alive 测试连接是否仍然有效
	_, _, err := c.client.SendRequest("keepalive@openssh.com", true, nil)
	return err == nil
}

// Host 返回连接的目标主机
func (c *Client) Host() string { return c.host }

// Port 返回连接的目标端口
func (c *Client) Port() int { return c.port }

// 包装环境变量到命令前缀（解决 ssh Setenv 限制）
func wrapEnvCommand(command string, env map[string]string) string {
	if len(env) == 0 {
		return command
	}
	var exports []string
	for k, v := range env {
		exports = append(exports, fmt.Sprintf("export %s=%q", k, v))
	}
	return fmt.Sprintf("%s && %s", strings.Join(exports, " "), command)
}
