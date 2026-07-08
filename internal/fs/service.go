package fs

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

// DirEntry 目录项
type DirEntry struct {
	Name  string `json:"name"`
	Path  string `json:"path"`
	IsDir bool   `json:"is_dir"`
}

// ListDir 列出指定路径下的目录（不包含文件）
func ListDir(path string) ([]DirEntry, error) {
	// 防止路径穿越：清理并确保是绝对路径
	absPath, err := filepath.Abs(path)
	if err != nil {
		return nil, fmt.Errorf("resolve path: %w", err)
	}

	if strings.Contains(absPath, "..") {
		return nil, fmt.Errorf("invalid path")
	}

	entries, err := os.ReadDir(absPath)
	if err != nil {
		return nil, fmt.Errorf("read dir: %w", err)
	}

	var dirs []DirEntry
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		info, err := entry.Info()
		if err != nil {
			continue
		}
		dirs = append(dirs, DirEntry{
			Name:  info.Name(),
			Path:  filepath.Join(absPath, info.Name()),
			IsDir: true,
		})
	}

	return dirs, nil
}

// CheckDirResult 目录检查结果
type CheckDirResult struct {
	Exists    bool   `json:"exists"`
	HasGit    bool   `json:"has_git"`
	RemoteURL string `json:"remote_url"`
	Match     *bool  `json:"match"` // nil when no .git, true/false when has .git
	Message   string `json:"message"`
}

// CheckDir 检查目标部署目录的状态
func CheckDir(codeDir, name, gitURL string) (*CheckDirResult, error) {
	targetDir := filepath.Join(codeDir, name)

	// 防止路径穿越
	absPath, err := filepath.Abs(targetDir)
	if err != nil {
		return nil, fmt.Errorf("resolve path: %w", err)
	}
	if strings.Contains(absPath, "..") {
		return nil, fmt.Errorf("invalid path")
	}

	result := &CheckDirResult{}

	// 检查目录是否存在
	if _, err := os.Stat(absPath); os.IsNotExist(err) {
		result.Exists = false
		result.HasGit = false
		result.Message = "目录不存在，将创建新目录进行首次部署"
		return result, nil
	}
	result.Exists = true

	// 检查是否有 .git
	gitDir := filepath.Join(absPath, ".git")
	if _, err := os.Stat(gitDir); os.IsNotExist(err) {
		result.HasGit = false
		result.Message = "目录已存在，但未检测到 Git 仓库，部署可能覆盖现有文件"
		return result, nil
	}
	result.HasGit = true

	// 读取远程 origin URL
	cmd := exec.Command("git", "-C", absPath, "remote", "get-url", "origin")
	out, err := cmd.Output()
	if err != nil {
		result.RemoteURL = ""
		result.Message = "目录存在 Git 仓库，但无法读取远程地址"
		return result, nil
	}
	result.RemoteURL = strings.TrimSpace(string(out))

	// 比较远程 URL
	match := strings.TrimRight(result.RemoteURL, "/") == strings.TrimRight(gitURL, "/")
	result.Match = &match
	if match {
		result.Message = "目录已存在且 Git 远程地址匹配，将执行重新部署"
	} else {
		result.Message = fmt.Sprintf("警告：目录已存在 Git 仓库，但远程地址不匹配（现有：%s，配置：%s）", result.RemoteURL, gitURL)
	}

	return result, nil
}
