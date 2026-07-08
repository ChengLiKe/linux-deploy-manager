package git

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

// Branch 分支信息
type Branch struct {
	Name      string `json:"name"`
	CommitSHA string `json:"commit_sha"`
	UpdatedAt string `json:"updated_at"`
}

// Service Git 服务接口
type Service interface {
	ListBranches(ctx context.Context, repoURL, sshKeyPath string) ([]Branch, error)
	PullCode(ctx context.Context, repoURL, sshKeyPath, targetDir, branch string) error
	GetCommitSHA(dir string) (string, error)
}

// NewService 创建 Git 服务（系统 git 为主，go-git 为 fallback）
func NewService() Service {
	return &gitService{}
}

type gitService struct{}

// gitEnv 返回带 SSH 密钥的 Git 环境变量；sshKeyPath 为空时使用系统默认 SSH
func (g *gitService) gitEnv(sshKeyPath string) []string {
	var sshCmd string
	if sshKeyPath == "" {
		// 不指定密钥，交给 ssh 默认配置（~/.ssh/config、ssh-agent 等）
		sshCmd = "ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=" + os.DevNull
	} else {
		sshCmd = fmt.Sprintf("ssh -i %s -o StrictHostKeyChecking=no -o UserKnownHostsFile=%s", sshKeyPath, os.DevNull)
	}
	return append(os.Environ(), "GIT_SSH_COMMAND="+sshCmd)
}

// ListBranches 使用系统 git 获取远程分支列表
func (g *gitService) ListBranches(ctx context.Context, repoURL, sshKeyPath string) ([]Branch, error) {
	cmd := exec.CommandContext(ctx, "git", "ls-remote", "--heads", repoURL)
	cmd.Env = g.gitEnv(sshKeyPath)

	output, err := cmd.Output()
	if err != nil {
		stderr := ""
		if exitErr, ok := err.(*exec.ExitError); ok {
			stderr = string(exitErr.Stderr)
		}
		return nil, fmt.Errorf("git ls-remote failed: %w, stderr: %s", err, stderr)
	}

	return parseBranchList(string(output)), nil
}

// parseBranchList 解析 git ls-remote 输出
func parseBranchList(output string) []Branch {
	var branches []Branch
	lines := strings.Split(output, "\n")
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		parts := strings.Fields(line)
		if len(parts) != 2 {
			continue
		}
		sha := parts[0]
		ref := parts[1]
		// refs/heads/main -> main
		name := strings.TrimPrefix(ref, "refs/heads/")
		branches = append(branches, Branch{
			Name:      name,
			CommitSHA: sha,
			UpdatedAt: time.Now().Format(time.RFC3339),
		})
	}
	return branches
}

// PullCode 使用系统 git 拉取代码
func (g *gitService) PullCode(ctx context.Context, repoURL, sshKeyPath, targetDir, branch string) error {
	env := g.gitEnv(sshKeyPath)

	// 确保目录存在
	if err := os.MkdirAll(targetDir, 0755); err != nil {
		return fmt.Errorf("create target dir: %w", err)
	}

	// 检查是否已有 git 仓库
	gitDir := filepath.Join(targetDir, ".git")
	if _, err := os.Stat(gitDir); os.IsNotExist(err) {
		// 初始化仓库
		initCmd := exec.CommandContext(ctx, "git", "init")
		initCmd.Dir = targetDir
		initCmd.Env = env
		if out, err := initCmd.CombinedOutput(); err != nil {
			return fmt.Errorf("git init: %w, output: %s", err, out)
		}

		// 添加远程
		remoteCmd := exec.CommandContext(ctx, "git", "remote", "add", "origin", repoURL)
		remoteCmd.Dir = targetDir
		remoteCmd.Env = env
		if out, err := remoteCmd.CombinedOutput(); err != nil {
			return fmt.Errorf("git remote add: %w, output: %s", err, out)
		}
	}

	// fetch + checkout + pull
	steps := [][]string{
		{"git", "fetch", "origin"},
		{"git", "checkout", "-B", branch, "origin/" + branch},
		{"git", "pull", "origin", branch},
	}

	for _, args := range steps {
		cmd := exec.CommandContext(ctx, args[0], args[1:]...)
		cmd.Dir = targetDir
		cmd.Env = env
		if out, err := cmd.CombinedOutput(); err != nil {
			return fmt.Errorf("git %s: %w, output: %s", args[1], err, out)
		}
	}

	return nil
}

// GetCommitSHA 获取当前目录的 Commit SHA
func (g *gitService) GetCommitSHA(dir string) (string, error) {
	cmd := exec.Command("git", "rev-parse", "HEAD")
	cmd.Dir = dir
	out, err := cmd.Output()
	if err != nil {
		return "", fmt.Errorf("git rev-parse: %w", err)
	}
	return strings.TrimSpace(string(out)), nil
}
