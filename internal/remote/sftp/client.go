package sftp

import (
	"fmt"
	"io"
	"os"
	"path/filepath"

	"github.com/pkg/sftp"
	"golang.org/x/crypto/ssh"
)

// Client SFTP 客户端封装
type Client struct {
	client *sftp.Client
}

// NewClient 从 SSH 连接创建 SFTP 客户端
func NewClient(sshClient *ssh.Client) (*Client, error) {
	sftpClient, err := sftp.NewClient(sshClient)
	if err != nil {
		return nil, fmt.Errorf("create sftp client: %w", err)
	}
	return &Client{client: sftpClient}, nil
}

// WriteFile 写入文件内容到远程路径，自动创建目录
func (s *Client) WriteFile(remotePath string, content []byte, perm uint32) error {
	dir := filepath.Dir(remotePath)
	if err := s.client.MkdirAll(dir); err != nil {
		return fmt.Errorf("mkdir %s: %w", dir, err)
	}
	f, err := s.client.OpenFile(remotePath, os.O_WRONLY|os.O_CREATE|os.O_TRUNC)
	if err != nil {
		return fmt.Errorf("open file: %w", err)
	}
	defer f.Close()
	if _, err := f.Write(content); err != nil {
		return fmt.Errorf("write file: %w", err)
	}
	if err := s.client.Chmod(remotePath, os.FileMode(perm)); err != nil {
		return fmt.Errorf("chmod: %w", err)
	}
	return nil
}

// WriteString 写入字符串到远程文件
func (s *Client) WriteString(remotePath string, content string, perm uint32) error {
	return s.WriteFile(remotePath, []byte(content), perm)
}

// ReadFile 读取远程文件内容
func (s *Client) ReadFile(remotePath string) ([]byte, error) {
	f, err := s.client.Open(remotePath)
	if err != nil {
		return nil, fmt.Errorf("open file: %w", err)
	}
	defer f.Close()
	return io.ReadAll(f)
}

// ReadFileString 读取远程文件为字符串
func (s *Client) ReadFileString(remotePath string) (string, error) {
	data, err := s.ReadFile(remotePath)
	if err != nil {
		return "", err
	}
	return string(data), nil
}

// Stat 获取远程文件信息
func (s *Client) Stat(remotePath string) (os.FileInfo, error) {
	return s.client.Stat(remotePath)
}

// Remove 删除远程文件
func (s *Client) Remove(remotePath string) error {
	return s.client.Remove(remotePath)
}

// MkdirAll 递归创建远程目录
func (s *Client) MkdirAll(remotePath string) error {
	return s.client.MkdirAll(remotePath)
}

// Close 关闭 SFTP 连接
func (s *Client) Close() error {
	if s.client != nil {
		return s.client.Close()
	}
	return nil
}
