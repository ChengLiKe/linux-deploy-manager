package remote

import (
	"context"
	"fmt"
	"io"
	"strings"
	"time"

	"github.com/linux-deploy-manager/internal/deployer"
	"github.com/linux-deploy-manager/internal/git"
)

// GitService 远程 Git 服务，在目标服务器上通过 SSH 执行 Git 命令
type GitService struct {
	executor deployer.Executor
}

// NewGitService 创建远程 Git 服务
func NewGitService(executor deployer.Executor) git.Service {
	return &GitService{executor: executor}
}

// ListBranches 在远程服务器上获取分支列表
func (g *GitService) ListBranches(ctx context.Context, repoURL, sshKeyPath string) ([]git.Branch, error) {
	gitCmd := fmt.Sprintf("git ls-remote --heads '%s'", repoURL)
	if sshKeyPath != "" {
		gitCmd = fmt.Sprintf("GIT_SSH_COMMAND='ssh -i %s -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null' %s", sshKeyPath, gitCmd)
	}

	var stdoutBuf strings.Builder
	if err := g.executor.Run(ctx, gitCmd, &stdoutBuf, io.Discard); err != nil {
		return nil, fmt.Errorf("git ls-remote failed: %w", err)
	}

	return parseBranchList(stdoutBuf.String()), nil
}

// PullCode 在远程服务器上拉取代码
func (g *GitService) PullCode(ctx context.Context, repoURL, sshKeyPath, targetDir, branch string) error {
	// 构建环境变量前缀
	var envPrefix string
	if sshKeyPath != "" {
		envPrefix = fmt.Sprintf("GIT_SSH_COMMAND='ssh -i %s -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null' ", sshKeyPath)
	}

	// 检查是否已有 git 仓库
	var checkBuf strings.Builder
	checkErr := g.executor.Run(ctx, fmt.Sprintf("test -d %s/.git && echo 'exists' || echo 'new'", targetDir), &checkBuf, io.Discard)
	isNew := checkErr != nil || !strings.Contains(checkBuf.String(), "exists")

	if isNew {
		// 初始化仓库
		initCmd := fmt.Sprintf("mkdir -p %s && cd %s && git init", targetDir, targetDir)
		if err := g.executor.Run(ctx, initCmd, io.Discard, io.Discard); err != nil {
			return fmt.Errorf("git init: %w", err)
		}
		remoteCmd := fmt.Sprintf("cd %s && git remote add origin '%s' || git remote set-url origin '%s'", targetDir, repoURL, repoURL)
		if err := g.executor.Run(ctx, remoteCmd, io.Discard, io.Discard); err != nil {
			return fmt.Errorf("git remote add: %w", err)
		}
	}

	// fetch + checkout + pull
	steps := []string{
		fmt.Sprintf("cd %s && %sgit fetch origin", targetDir, envPrefix),
		fmt.Sprintf("cd %s && %sgit checkout -B %s origin/%s", targetDir, envPrefix, branch, branch),
		fmt.Sprintf("cd %s && %sgit pull origin %s", targetDir, envPrefix, branch),
	}

	for _, cmd := range steps {
		if err := g.executor.Run(ctx, cmd, io.Discard, io.Discard); err != nil {
			return fmt.Errorf("git command failed: %w", err)
		}
	}

	return nil
}

// GetCommitSHA 在远程服务器上获取当前目录的 Commit SHA
func (g *GitService) GetCommitSHA(dir string) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	var stdoutBuf strings.Builder
	if err := g.executor.Run(ctx, fmt.Sprintf("cd %s && git rev-parse HEAD", dir), &stdoutBuf, io.Discard); err != nil {
		return "", fmt.Errorf("git rev-parse: %w", err)
	}
	return strings.TrimSpace(stdoutBuf.String()), nil
}

// parseBranchList 解析 git ls-remote 输出
func parseBranchList(output string) []git.Branch {
	var branches []git.Branch
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
		branches = append(branches, git.Branch{
			Name:      name,
			CommitSHA: sha,
			UpdatedAt: time.Now().Format(time.RFC3339),
		})
	}
	return branches
}
