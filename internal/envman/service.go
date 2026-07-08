package envman

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/linux-deploy-manager/internal/sysutil"
)

// ToolInfo 环境管理工具信息
type ToolInfo struct {
	Installed bool     `json:"installed"`
	Version   string   `json:"version"`
	Envs      []string `json:"envs"`
}

// DetectAll 检测所有支持的环境管理工具
func DetectAll() map[string]ToolInfo {
	return map[string]ToolInfo{
		"nvm":   detectNVM(),
		"conda": detectConda(),
		"pyenv": detectPyenv(),
	}
}

// ListEnvs 列出指定工具的所有环境
func ListEnvs(tool string) ([]string, error) {
	switch tool {
	case "nvm":
		return listNVMEnvs()
	case "conda":
		return listCondaEnvs()
	case "pyenv":
		return listPyenvEnvs()
	default:
		return nil, fmt.Errorf("unsupported env manager: %s", tool)
	}
}

// CreateEnv 创建新的环境
func CreateEnv(tool, env string) error {
	if env == "" {
		return fmt.Errorf("environment name/version is required")
	}
	switch tool {
	case "nvm":
		return createNVMEnv(env)
	case "conda":
		return createCondaEnv(env)
	case "pyenv":
		return createPyenvEnv(env)
	default:
		return fmt.Errorf("unsupported env manager: %s", tool)
	}
}

func createNVMEnv(version string) error {
	nvmSh := filepath.Join(homeDir(), ".nvm", "nvm.sh")
	if _, err := os.Stat(nvmSh); err != nil {
		return fmt.Errorf("nvm not installed")
	}
	script := fmt.Sprintf("source %s && nvm install %s", sysutil.ShellEscape(nvmSh), sysutil.ShellEscape(version))
	cmd := sysutil.ShellCommand(script)
	output, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("nvm install failed: %w\noutput: %s", err, string(output))
	}
	return nil
}

func createCondaEnv(name string) error {
	cmd := sysutil.ShellCommand(fmt.Sprintf("conda create -n %s -y", sysutil.ShellEscape(name)))
	output, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("conda create failed: %w\noutput: %s", err, string(output))
	}
	return nil
}

func createPyenvEnv(version string) error {
	cmd := sysutil.ShellCommand(fmt.Sprintf("pyenv install %s", sysutil.ShellEscape(version)))
	output, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("pyenv install failed: %w\noutput: %s", err, string(output))
	}
	return nil
}

func homeDir() string {
	if home, err := os.UserHomeDir(); err == nil && home != "" {
		return home
	}
	if dir, err := os.UserConfigDir(); err == nil && dir != "" {
		return dir
	}
	return os.TempDir()
}

func detectNVM() ToolInfo {
	nvmSh := filepath.Join(homeDir(), ".nvm", "nvm.sh")
	if _, err := os.Stat(nvmSh); err != nil {
		return ToolInfo{Installed: false}
	}
	return ToolInfo{Installed: true, Version: "installed"}
}

func listNVMEnvs() ([]string, error) {
	nvmSh := filepath.Join(homeDir(), ".nvm", "nvm.sh")
	if _, err := os.Stat(nvmSh); err != nil {
		return nil, fmt.Errorf("nvm not installed")
	}
	script := fmt.Sprintf("source %s && nvm ls --no-colors", nvmSh)
	out, err := sysutil.ShellCommand(script).Output()
	if err != nil {
		return nil, fmt.Errorf("nvm ls failed: %w", err)
	}
	return parseNVMVersions(string(out)), nil
}

func parseNVMVersions(output string) []string {
	var versions []string
	for _, line := range strings.Split(output, "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "-") || strings.HasPrefix(line, ">>") {
			continue
		}
		// 示例行：->     v20.11.0 *
		line = strings.ReplaceAll(line, "->", "")
		line = strings.ReplaceAll(line, "*", "")
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "v") || strings.HasPrefix(line, "node") {
			versions = append(versions, line)
		}
	}
	return versions
}

func detectConda() ToolInfo {
	out, err := sysutil.ShellCommand("conda --version").Output()
	if err != nil {
		return ToolInfo{Installed: false}
	}
	return ToolInfo{Installed: true, Version: strings.TrimSpace(string(out))}
}

func listCondaEnvs() ([]string, error) {
	out, err := sysutil.ShellCommand("conda env list").Output()
	if err != nil {
		return nil, fmt.Errorf("conda env list failed: %w", err)
	}
	return parseCondaEnvs(string(out)), nil
}

func parseCondaEnvs(output string) []string {
	var envs []string
	for _, line := range strings.Split(output, "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		parts := strings.Fields(line)
		if len(parts) >= 1 {
			name := strings.TrimRight(parts[0], "*")
			if name != "" {
				envs = append(envs, name)
			}
		}
	}
	return envs
}

func detectPyenv() ToolInfo {
	out, err := sysutil.ShellCommand("pyenv --version").Output()
	if err != nil {
		pyenvBin := filepath.Join(homeDir(), ".pyenv", "bin", "pyenv")
		if _, stErr := os.Stat(pyenvBin); stErr != nil {
			return ToolInfo{Installed: false}
		}
		return ToolInfo{Installed: true, Version: "installed"}
	}
	return ToolInfo{Installed: true, Version: strings.TrimSpace(string(out))}
}

func listPyenvEnvs() ([]string, error) {
	out, err := sysutil.ShellCommand("pyenv versions --skip-aliases").Output()
	if err != nil {
		return nil, fmt.Errorf("pyenv versions failed: %w", err)
	}
	return parsePyenvVersions(string(out)), nil
}

func parsePyenvVersions(output string) []string {
	var versions []string
	for _, line := range strings.Split(output, "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "system") {
			continue
		}
		line = strings.ReplaceAll(line, "*", "")
		line = strings.TrimSpace(line)
		if line != "" {
			versions = append(versions, line)
		}
	}
	return versions
}
