package env

import (
	"fmt"
	"os/exec"
	"strings"
)

// Format 环境变量格式
type Format string

const (
	FormatDotEnv Format = "dotenv"
	FormatJSON   Format = "json"
	FormatYAML   Format = "yaml"
	FormatPlain  Format = "plain"
)

// Manager 环境变量管理器
type Manager struct{}

// NewManager 创建环境变量管理器
func NewManager() *Manager {
	return &Manager{}
}

// Parse 解析环境变量输入
func (m *Manager) Parse(input string, format Format) (map[string]string, error) {
	result := make(map[string]string)

	switch format {
	case FormatDotEnv, FormatPlain:
		lines := strings.Split(input, "\n")
		for _, line := range lines {
			line = strings.TrimSpace(line)
			if line == "" || strings.HasPrefix(line, "#") {
				continue
			}
			parts := strings.SplitN(line, "=", 2)
			if len(parts) == 2 {
				key := strings.TrimSpace(parts[0])
				val := strings.TrimSpace(parts[1])
				val = strings.Trim(val, `"'`)
				result[key] = val
			}
		}
	case FormatJSON:
		// TODO: JSON 解析
	case FormatYAML:
		// TODO: YAML 解析
	default:
		return nil, fmt.Errorf("unsupported format: %s", format)
	}

	return result, nil
}

// WriteEnvFile 写入 .env 文件
func (m *Manager) WriteEnvFile(vars map[string]string, filepath string) error {
	var sb strings.Builder
	for k, v := range vars {
		sb.WriteString(fmt.Sprintf("%s=%s\n", k, v))
	}
	// TODO: 写入文件
	_ = sb
	return nil
}

// InjectToProcess 注入环境变量到进程
func (m *Manager) InjectToProcess(vars map[string]string, cmd *exec.Cmd) {
	for k, v := range vars {
		cmd.Env = append(cmd.Env, fmt.Sprintf("%s=%s", k, v))
	}
}

// IsSensitive 检测是否为敏感键名
func IsSensitive(key string) bool {
	sensitive := []string{"password", "secret", "token", "api_key", "private_key"}
	lower := strings.ToLower(key)
	for _, s := range sensitive {
		if strings.Contains(lower, s) {
			return true
		}
	}
	return false
}
