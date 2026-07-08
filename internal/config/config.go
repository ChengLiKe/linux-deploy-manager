package config

import (
	"flag"
	"os"
	"path/filepath"
	"runtime"
)

// defaultDataDir 根据操作系统返回默认数据目录
func defaultDataDir() string {
	if runtime.GOOS == "windows" {
		appData := os.Getenv("APPDATA")
		if appData == "" {
			appData = filepath.Join(os.Getenv("USERPROFILE"), "AppData", "Roaming")
		}
		return filepath.Join(appData, "linux-deploy-manager")
	}
	return "/var/lib/linux-deploy-manager"
}

// defaultLogDir 根据操作系统返回默认日志目录
func defaultLogDir() string {
	if runtime.GOOS == "windows" {
		return filepath.Join(defaultDataDir(), "logs")
	}
	return "/var/log/linux-deploy-manager"
}

// Config 应用配置
type Config struct {
	Bind    string // 绑定地址
	Port    int    // 监听端口
	DataDir string // 数据目录
	LogDir  string // 日志目录
	Mode    string // 运行模式: debug/release
}

// Load 加载配置（命令行参数优先，环境变量次之，默认值兜底）
func Load() *Config {
	// 检测 Electron 模式：LDM_PORT_FILE 存在时表示由 Electron 主进程启动
	isElectronMode := os.Getenv("LDM_PORT_FILE") != ""

	// 根据模式设置不同默认值
	// Web 模式：监听所有接口，固定端口 8080
	// Electron 模式：仅监听本地回环，随机端口（0）
	defaultBind := "0.0.0.0"
	defaultPort := 8080
	if isElectronMode {
		defaultBind = "127.0.0.1"
		defaultPort = 0
	}

	cfg := &Config{
		Bind:    defaultBind,
		Port:    defaultPort,
		DataDir: defaultDataDir(),
		LogDir:  defaultLogDir(),
		Mode:    "release",
	}

	// 命令行参数
	flag.StringVar(&cfg.Bind, "bind", cfg.Bind, "bind address")
	flag.IntVar(&cfg.Port, "port", cfg.Port, "listen port")
	flag.StringVar(&cfg.DataDir, "data-dir", cfg.DataDir, "data directory")
	flag.StringVar(&cfg.LogDir, "log-dir", cfg.LogDir, "log directory")
	flag.StringVar(&cfg.Mode, "mode", cfg.Mode, "run mode: debug/release")
	flag.Parse()

	// 环境变量覆盖
	if v := os.Getenv("LDM_BIND"); v != "" {
		cfg.Bind = v
	}
	if v := os.Getenv("LDM_DATA_DIR"); v != "" {
		cfg.DataDir = v
	}
	if v := os.Getenv("LDM_LOG_DIR"); v != "" {
		cfg.LogDir = v
	}

	// 确保路径绝对化
	if !filepath.IsAbs(cfg.DataDir) {
		if abs, err := filepath.Abs(cfg.DataDir); err == nil {
			cfg.DataDir = abs
		}
	}
	if !filepath.IsAbs(cfg.LogDir) {
		if abs, err := filepath.Abs(cfg.LogDir); err == nil {
			cfg.LogDir = abs
		}
	}

	return cfg
}
