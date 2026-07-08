package deployer

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/linux-deploy-manager/internal/git"
	"github.com/linux-deploy-manager/internal/sysutil"
)

// Deployer 部署执行器
type Deployer struct {
	taskBuffers map[string]*LogBuffer
	cancelFuncs map[string]context.CancelFunc
	mu          sync.RWMutex
}

// NewDeployer 创建部署器
func NewDeployer() *Deployer {
	return &Deployer{
		taskBuffers: make(map[string]*LogBuffer),
		cancelFuncs: make(map[string]context.CancelFunc),
	}
}

// GetTaskLogBuffer 获取指定任务的日志缓冲区
func (d *Deployer) GetTaskLogBuffer(taskID string) *LogBuffer {
	d.mu.RLock()
	buf, ok := d.taskBuffers[taskID]
	d.mu.RUnlock()
	if ok {
		return buf
	}
	return nil
}

// createTaskLogBuffer 为任务创建新的日志缓冲区
func (d *Deployer) createTaskLogBuffer(taskID string) *LogBuffer {
	d.mu.Lock()
	defer d.mu.Unlock()
	buf := NewLogBuffer()
	d.taskBuffers[taskID] = buf
	return buf
}

// removeTaskLogBuffer 清理任务日志缓冲区
func (d *Deployer) removeTaskLogBuffer(taskID string) {
	d.mu.Lock()
	defer d.mu.Unlock()
	delete(d.taskBuffers, taskID)
}

// Config 部署配置
type Config struct {
	Name            string
	GitURL          string
	SSHKeyPath      string
	CodeDir         string
	DeployDir       string
	Branch          string
	EnvVars         map[string]string
	PreDeployCmd    string
	DeployCmd       string
	PostDeployCmd   string
	DeployMode      string
	ContainerConfig string
	LocalConfig     string
	TimeoutSec      int
	SudoPassword    string // 项目级 sudo 密码
	SudoEnabled     bool   // 是否启用 sudo 执行 docker 命令（来自系统设置）
	LogDir          string // 日志持久化目录，部署完成后写入 task_{id}.log
}

// Execute 执行完整部署流程
func (d *Deployer) Execute(ctx context.Context, taskID string, cfg *Config, executor Executor, gitService git.Service) error {
	// 创建任务专用的日志缓冲区
	buf := d.createTaskLogBuffer(taskID)
	defer func() {
		d.persistLog(taskID, buf, cfg.LogDir)
		d.removeTaskLogBuffer(taskID)
	}()

	// 创建可取消的上下文
	execCtx, cancel := context.WithCancel(ctx)
	d.cancelFuncs[taskID] = cancel
	defer delete(d.cancelFuncs, taskID)

	// 设置执行器的工作目录和环境变量
	executor.SetWorkDir("")
	executor.SetEnv(cfg.EnvVars)

	buf.Writef("[Deploy] 开始部署任务 %s", taskID)
	buf.Writef("[Deploy] 目标分支: %s", cfg.Branch)

	// 代码实际落盘目录 = 配置目录 / 模板名称
	actualCodeDir := filepath.Join(cfg.CodeDir, cfg.Name)
	buf.Writef("[Deploy] 代码目录: %s", actualCodeDir)

	// 自动创建模板子目录
	buf.Writef("[Deploy] 创建/确认代码目录...")
	if err := d.mkdirRemote(execCtx, executor, actualCodeDir, buf); err != nil {
		buf.Writef("[Deploy] 创建目录失败: %v", err)
		return fmt.Errorf("create code dir: %w", err)
	}

	// 0. 重新部署前清理旧实例
	if err := d.cleanupPreviousInstance(execCtx, buf, cfg, executor, actualCodeDir); err != nil {
		buf.Writef("[Deploy] 清理旧实例失败: %v", err)
		return fmt.Errorf("cleanup previous instance: %w", err)
	}

	// 1. Git 拉取
	buf.Writef("[Git] 正在拉取代码...")
	if err := gitService.PullCode(execCtx, cfg.GitURL, cfg.SSHKeyPath, actualCodeDir, cfg.Branch); err != nil {
		buf.Writef("[Git] 拉取失败: %v", err)
		return fmt.Errorf("git pull: %w", err)
	}
	commitSHA, err := gitService.GetCommitSHA(actualCodeDir)
	if err != nil {
		buf.Writef("[Git] 获取 Commit SHA 失败: %s", err.Error())
	}
	buf.Writef("[Git] 拉取完成, Commit: %s", commitSHA)

	// 2. 写入环境变量
	if len(cfg.EnvVars) > 0 {
		buf.Writef("[Env] 正在写入环境变量...")
		envPath := filepath.Join(actualCodeDir, ".env")
		if err := d.writeEnvFileRemote(executor, cfg.EnvVars, envPath, buf); err != nil {
			buf.Writef("[Env] 写入失败: %v", err)
			return fmt.Errorf("write env: %w", err)
		}
		buf.Writef("[Env] 环境变量已写入 .env")
	}

	// 3. 预部署命令（本地部署可配置跳过）
	lc, _ := parseLocalConfig(cfg.LocalConfig)
	if cfg.PreDeployCmd != "" {
		if cfg.DeployMode == "local" && lc.SkipPreCmd {
			buf.Writef("[PreDeploy] 已配置跳过预部署命令")
		} else {
			buf.Writef("[PreDeploy] 执行预部署命令...")
			if err := d.runCommand(execCtx, buf, executor, cfg.PreDeployCmd, actualCodeDir, cfg.TimeoutSec); err != nil {
				buf.Writef("[PreDeploy] 失败: %v", err)
				return fmt.Errorf("pre deploy: %w", err)
			}
			buf.Writef("[PreDeploy] 完成")
		}
	}

	// 4. 执行部署（本地或容器）
	if cfg.DeployMode == "container" {
		if err := d.runContainerDeploy(execCtx, buf, cfg, executor, actualCodeDir); err != nil {
			return err
		}
	} else {
		if err := d.runLocalDeploy(execCtx, buf, cfg, executor, actualCodeDir); err != nil {
			return err
		}
	}

	// 5. 后部署命令
	if cfg.PostDeployCmd != "" {
		buf.Writef("[PostDeploy] 执行后部署命令...")
		if err := d.runCommand(execCtx, buf, executor, cfg.PostDeployCmd, actualCodeDir, cfg.TimeoutSec); err != nil {
			buf.Writef("[PostDeploy] 失败: %v", err)
			return fmt.Errorf("post deploy: %w", err)
		}
		buf.Writef("[PostDeploy] 完成")
	}

	buf.Writef("[Deploy] 部署成功！")
	return nil
}

// Cancel 取消部署
func (d *Deployer) Cancel(taskID string) error {
	if cancel, ok := d.cancelFuncs[taskID]; ok {
		cancel()
		d.logf(taskID, "[Deploy] 部署已取消")
		return nil
	}
	return fmt.Errorf("task %s not found or not running", taskID)
}

// cleanupPreviousInstance 重新部署前清理旧实例
func (d *Deployer) cleanupPreviousInstance(ctx context.Context, buf *LogBuffer, cfg *Config, executor Executor, actualCodeDir string) error {
	if cfg.DeployMode == "container" {
		cc, err := parseContainerConfig(cfg.ContainerConfig)
		if err != nil {
			buf.Writef("[Cleanup] 解析容器配置失败: %v", err)
			return fmt.Errorf("parse container config: %w", err)
		}

		// sudo 来自系统设置
		sudoPassword := ""
		if cfg.SudoEnabled {
			sudoPassword = cfg.SudoPassword
			if sudoPassword == "" {
				buf.Writef("[Cleanup] 警告：系统设置已启用 sudo，但未配置 sudo 密码")
			}
		}

		workDir := actualCodeDir
		composeFile := cc.ComposeFile
		if composeFile != "" && composeFile != "docker-compose.yml" && strings.Contains(composeFile, "/") {
			workDir = filepath.Join(actualCodeDir, filepath.Dir(composeFile))
			composeFile = filepath.Base(composeFile)
		}

		downCmd := "docker-compose down"
		if composeFile != "docker-compose.yml" && !strings.Contains(downCmd, " -f ") {
			downCmd = fmt.Sprintf("%s -f %s", downCmd, composeFile)
		}

		buf.Writef("[Cleanup] 清理旧容器: %s", downCmd)
		if err := d.runCommand(ctx, buf, executor, downCmd, workDir, cfg.TimeoutSec); err != nil {
			buf.Writef("[Cleanup] 清理旧容器失败（可能无旧容器）: %v", err)
		} else {
			buf.Writef("[Cleanup] 旧容器已清理")
		}
		return nil
	}

	// 本地部署：结束上次部署进程
	if err := d.killOldProcess(ctx, buf, executor, actualCodeDir); err != nil {
		buf.Writef("[Cleanup] 结束旧进程失败: %v", err)
		return err
	}
	return nil
}

// GetLogBuffer 获取日志缓冲区（兼容旧调用，返回 nil）
func (d *Deployer) GetLogBuffer() *LogBuffer {
	return nil
}

// persistLog 将日志缓冲区内容持久化到文件
func (d *Deployer) persistLog(taskID string, buf *LogBuffer, logDir string) {
	if logDir == "" {
		return
	}
	logDir = filepath.Join(logDir, "deploy")
	if err := os.MkdirAll(logDir, 0755); err != nil {
		return
	}
	logPath := filepath.Join(logDir, fmt.Sprintf("task_%s.log", taskID))
	lines := buf.GetLines()
	_ = os.WriteFile(logPath, []byte(strings.Join(lines, "\n")), 0644)
}

// logf 格式化日志并写入（兼容旧调用）
func (d *Deployer) logf(taskID string, format string, args ...interface{}) {
	buf := d.GetTaskLogBuffer(taskID)
	if buf != nil {
		buf.Writef(format, args...)
	}
}

// runCommand 执行命令并实时捕获输出
func (d *Deployer) runCommand(ctx context.Context, buf *LogBuffer, executor Executor, command, workDir string, timeoutSec int) error {
	if timeoutSec <= 0 {
		timeoutSec = 600
	}
	executor.SetWorkDir(workDir)
	stdoutW := newLogWriter(buf, "")
	stderrW := newLogWriter(buf, "[stderr] ")
	return executor.Run(ctx, command, stdoutW, stderrW)
}

// writeEnvFile 写入 .env 文件
func writeEnvFile(vars map[string]string, filepath string) error {
	f, err := os.Create(filepath)
	if err != nil {
		return err
	}
	defer f.Close()

	for k, v := range vars {
		if _, err := f.WriteString(fmt.Sprintf("%s=%s\n", k, v)); err != nil {
			return err
		}
	}
	return nil
}

// LocalConfig 本地部署配置
type LocalConfig struct {
	ExecType      string `json:"exec_type"`
	RuntimeEnv    string `json:"runtime_env"`
	EnvManager    string `json:"env_manager"`
	EnvManagerEnv string `json:"env_manager_env"`
	ServiceName   string `json:"service_name"`
	RunUser       string `json:"run_user"`
	SkipPreCmd    bool   `json:"skip_pre_cmd"`
}

// ContainerConfig 容器部署配置（仅支持 docker-compose）
type ContainerConfig struct {
	ComposeFile string `json:"compose_file"`
	BuildCmd    string `json:"build_cmd"`
	UpCmd       string `json:"up_cmd"`
	UseSudo     bool   `json:"use_sudo"`
}

func parseLocalConfig(s string) (*LocalConfig, error) {
	if s == "" {
		return &LocalConfig{ExecType: "direct", RuntimeEnv: "nodejs", EnvManager: "none"}, nil
	}
	var cfg LocalConfig
	if err := json.Unmarshal([]byte(s), &cfg); err != nil {
		return nil, err
	}
	if cfg.ExecType == "" {
		cfg.ExecType = "direct"
	}
	if cfg.RuntimeEnv == "" {
		cfg.RuntimeEnv = "nodejs"
	}
	if cfg.EnvManager == "" {
		cfg.EnvManager = "none"
	}
	return &cfg, nil
}

var runtimeCheckCommands = map[string]string{
	"nodejs": "node --version",
	"python": "python --version",
	"java":   "java -version",
	"go":     "go version",
	"php":    "php --version",
	"ruby":   "ruby --version",
	"dotnet": "dotnet --version",
}

const pidFileName = ".ldm-pid"

// pidFilePath 返回 PID 文件路径
func pidFilePath(codeDir string) string {
	return filepath.Join(codeDir, pidFileName)
}

// isLocalExecutor 判断执行器是否为本地执行器（用于区分本地/远程部署的平台差异）
func isLocalExecutor(e Executor) bool {
	_, ok := e.(*LocalExecutor)
	return ok
}

// killOldProcess 根据 PID 文件结束上次部署的进程
func (d *Deployer) killOldProcess(ctx context.Context, buf *LogBuffer, executor Executor, codeDir string) error {
	pidFile := pidFilePath(codeDir)

	// Windows 本地部署：直接在宿主机上用 Go 原生命中进程，避免依赖 cat/kill 等 Unix 命令
	if runtime.GOOS == "windows" && isLocalExecutor(executor) {
		return d.killOldProcessLocalWindows(buf, codeDir)
	}

	// 通过 Executor 读取远程 PID 文件（远程 Linux / 本地 Linux 走此处）
	var stdoutBuf strings.Builder
	executor.SetWorkDir("")
	if err := executor.Run(ctx, "cat "+pidFile, &stdoutBuf, io.Discard); err != nil {
		// 文件不存在或读取失败，忽略
		return nil
	}

	data := strings.TrimSpace(stdoutBuf.String())
	if data == "" {
		return nil
	}

	var pid int
	if _, err := fmt.Sscanf(data, "%d", &pid); err != nil {
		buf.Writef("[Local] PID 文件格式错误，删除旧文件")
		_ = executor.Run(ctx, "rm -f "+pidFile, io.Discard, io.Discard)
		return nil
	}

	if pid <= 0 {
		_ = executor.Run(ctx, "rm -f "+pidFile, io.Discard, io.Discard)
		return nil
	}

	buf.Writef("[Local] 发现上次部署进程 PID=%d，尝试结束...", pid)
	// 发送 SIGTERM
	if err := executor.Run(ctx, fmt.Sprintf("kill -15 %d 2>/dev/null || true", pid), io.Discard, io.Discard); err != nil {
		buf.Writef("[Local] SIGTERM 失败: %v，尝试 SIGKILL", err)
	}

	// 等待进程退出（通过检查 /proc/pid 是否存在）
	for i := 0; i < 10; i++ {
		var checkBuf strings.Builder
		if err := executor.Run(ctx, fmt.Sprintf("kill -0 %d 2>/dev/null || echo 'gone'", pid), &checkBuf, io.Discard); err != nil {
			break
		}
		if strings.Contains(checkBuf.String(), "gone") {
			buf.Writef("[Local] 旧进程已结束")
			break
		}
		time.Sleep(500 * time.Millisecond)
	}

	// 强制 SIGKILL
	_ = executor.Run(ctx, fmt.Sprintf("kill -9 %d 2>/dev/null || true", pid), io.Discard, io.Discard)
	buf.Writef("[Local] 等待超时，强制结束")

	_ = executor.Run(ctx, "rm -f "+pidFile, io.Discard, io.Discard)
	return nil
}

// killOldProcessLocalWindows Windows 本地部署专用：直接读取 PID 文件并用 taskkill 结束整个进程树
func (d *Deployer) killOldProcessLocalWindows(buf *LogBuffer, codeDir string) error {
	pidFile := pidFilePath(codeDir)
	data, err := os.ReadFile(pidFile)
	if err != nil {
		// 文件不存在，说明没有旧进程
		return nil
	}

	pidStr := strings.TrimSpace(string(data))
	if pidStr == "" {
		return nil
	}
	var pid int
	if _, err := fmt.Sscanf(pidStr, "%d", &pid); err != nil || pid <= 0 {
		buf.Writef("[Local] PID 文件格式错误，删除旧文件")
		_ = os.Remove(pidFile)
		return nil
	}

	buf.Writef("[Local] 发现上次部署进程 PID=%d，尝试结束...", pid)
	// /T 结束进程树，/F 强制
	if out, err := exec.Command("taskkill", "/T", "/F", "/PID", strconv.Itoa(pid)).CombinedOutput(); err != nil {
		buf.Writef("[Local] taskkill 返回: %s", strings.TrimSpace(string(out)))
	}
	time.Sleep(1 * time.Second)
	_ = os.Remove(pidFile)
	buf.Writef("[Local] 旧进程已结束")
	return nil
}

// checkRuntimeEnv 检查本地运行环境是否已安装
func (d *Deployer) checkRuntimeEnv(ctx context.Context, buf *LogBuffer, executor Executor, runtimeEnv string) error {
	cmd, ok := runtimeCheckCommands[runtimeEnv]
	if !ok || cmd == "" {
		return nil
	}
	buf.Writef("[Local] 检查运行环境 %s...", runtimeEnv)
	// 工作目录：本地 Windows 不能用 "/"，改用系统临时目录；远程 Linux 用 "/"
	checkWorkDir := "/"
	if isLocalExecutor(executor) && runtime.GOOS == "windows" {
		checkWorkDir = os.TempDir()
	}
	if err := d.runCommand(ctx, buf, executor, cmd, checkWorkDir, 30); err != nil {
		buf.Writef("[Local] 运行环境检查失败，请确认 %s 已安装: %v", runtimeEnv, err)
		return fmt.Errorf("runtime env check failed: %w", err)
	}
	buf.Writef("[Local] 运行环境检查通过")
	return nil
}

func parseContainerConfig(s string) (*ContainerConfig, error) {
	cfg := &ContainerConfig{
		ComposeFile: "docker-compose.yml",
		BuildCmd:    "docker-compose build",
		UpCmd:       "docker-compose up -d",
	}
	if s == "" {
		return cfg, nil
	}
	if err := json.Unmarshal([]byte(s), cfg); err != nil {
		return nil, err
	}
	if cfg.ComposeFile == "" {
		cfg.ComposeFile = "docker-compose.yml"
	}
	if cfg.BuildCmd == "" {
		cfg.BuildCmd = "docker-compose build"
	}
	if cfg.UpCmd == "" {
		cfg.UpCmd = "docker-compose up -d"
	}
	return cfg, nil
}

// wrapEnvManager 用 nvm/conda 等环境管理工具包装命令
func wrapEnvManager(cmd, manager, env string) string {
	if env == "" {
		return cmd
	}
	switch manager {
	case "nvm":
		return fmt.Sprintf(`export NVM_DIR="$HOME/.nvm" && [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" && nvm use %s && %s`, env, cmd)
	case "conda":
		return fmt.Sprintf(`source "$HOME/miniconda3/etc/profile.d/conda.sh" 2>/dev/null || source /opt/conda/etc/profile.d/conda.sh && conda activate %s && %s`, env, cmd)
	case "pyenv":
		return fmt.Sprintf(`export PYENV_ROOT="$HOME/.pyenv" && export PATH="$PYENV_ROOT/bin:$PATH" && eval "$(pyenv init -)" && pyenv shell %s && %s`, env, cmd)
	default:
		return cmd
	}
}

// runLocalDeploy 本地部署
func (d *Deployer) runLocalDeploy(ctx context.Context, buf *LogBuffer, cfg *Config, executor Executor, actualCodeDir string) error {
	lc, err := parseLocalConfig(cfg.LocalConfig)
	if err != nil {
		buf.Writef("[Local] 解析本地配置失败: %v", err)
		return fmt.Errorf("parse local config: %w", err)
	}

	// systemd 仅适用于 Linux；Windows 本地部署不支持，自动回退为后台模式
	if lc.ExecType == "systemd" && runtime.GOOS == "windows" && isLocalExecutor(executor) {
		lc.ExecType = "background"
		buf.Writef("[Local] Windows 不支持 systemd 服务，已自动回退为后台模式")
	}

	// 结束上次部署的进程（systemd 和容器有自己的生命周期管理，这里只处理直接/后台模式）
	if lc.ExecType != "systemd" {
		if err := d.killOldProcess(ctx, buf, executor, actualCodeDir); err != nil {
			buf.Writef("[Local] 结束旧进程失败: %v", err)
		}
	}

	// 检查运行环境
	if err := d.checkRuntimeEnv(ctx, buf, executor, lc.RuntimeEnv); err != nil {
		return err
	}

	// 默认使用部署命令
	deployCmd := cfg.DeployCmd
	if deployCmd == "" {
		buf.Writef("[Local] 未配置部署命令，跳过启动")
		return nil
	}

	// 包装环境管理工具
	// Windows 本地无 bash，且 nvm/conda/pyenv 在 Windows 上形态不同，跳过包装直接使用原始命令
	if runtime.GOOS == "windows" && isLocalExecutor(executor) {
		buf.Writef("[Local] Windows 环境下跳过 nvm/conda/pyenv 包装")
	} else {
		deployCmd = wrapEnvManager(deployCmd, lc.EnvManager, lc.EnvManagerEnv)
	}

	switch lc.ExecType {
	case "background":
		logFile := filepath.Join(actualCodeDir, "app.log")
		// 后台启动：Windows 无 nohup/&/echo $!，由平台相关的 startBackground 处理
		if err := d.startBackground(ctx, buf, executor, cfg, deployCmd, actualCodeDir, logFile); err != nil {
			buf.Writef("[Local] 启动失败: %v", err)
			return fmt.Errorf("local deploy: %w", err)
		}
		buf.Writef("[Local] 启动完成")
		return nil
	case "systemd":
		serviceName := lc.ServiceName
		if serviceName == "" {
			serviceName = filepath.Base(actualCodeDir)
		}
		runUser := lc.RunUser
		if runUser == "" {
			runUser = "root"
		}
		if err := d.setupSystemd(ctx, buf, cfg, executor, actualCodeDir, serviceName, deployCmd, runUser); err != nil {
			return err
		}
		return nil
	default:
		// 直接执行模式：Windows 无 bash，不包装 &/echo $!，直接前台运行
		if !(runtime.GOOS == "windows" && isLocalExecutor(executor)) {
			deployCmd = fmt.Sprintf("(%s) & echo $! > %s; wait", deployCmd, pidFilePath(actualCodeDir))
		}
		buf.Writef("[Local] 使用直接执行模式")
	}

	if err := d.runCommand(ctx, buf, executor, deployCmd, actualCodeDir, cfg.TimeoutSec); err != nil {
		buf.Writef("[Local] 启动失败: %v", err)
		return fmt.Errorf("local deploy: %w", err)
	}
	buf.Writef("[Local] 启动完成")
	return nil
}

// setupSystemd 创建并启动 systemd 服务
func (d *Deployer) setupSystemd(ctx context.Context, buf *LogBuffer, cfg *Config, executor Executor, actualCodeDir, serviceName, deployCmd, runUser string) error {
	servicePath := fmt.Sprintf("/etc/systemd/system/%s.service", serviceName)
	serviceContent := fmt.Sprintf(`[Unit]
Description=%s
After=network.target

[Service]
Type=simple
User=%s
WorkingDirectory=%s
ExecStart=%s
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
`, serviceName, runUser, actualCodeDir, deployCmd)

	buf.Writef("[Systemd] 写入服务文件 %s", servicePath)
	if err := d.writeRemoteFile(ctx, executor, servicePath, serviceContent, 0644); err != nil {
		buf.Writef("[Systemd] 写入服务文件失败: %v", err)
		return fmt.Errorf("write systemd service: %w", err)
	}

	commands := []string{
		"systemctl daemon-reload",
		fmt.Sprintf("systemctl enable %s", serviceName),
		fmt.Sprintf("systemctl restart %s", serviceName),
	}
	for _, cmd := range commands {
		buf.Writef("[Systemd] %s", cmd)
		if err := d.runCommand(ctx, buf, executor, cmd, "/", cfg.TimeoutSec); err != nil {
			buf.Writef("[Systemd] 失败: %v", err)
			return fmt.Errorf("systemd command: %w", err)
		}
	}
	buf.Writef("[Systemd] 服务 %s 已启动", serviceName)
	return nil
}

// checkDocker 检查 docker 和 docker-compose 是否已安装
func (d *Deployer) checkDocker(ctx context.Context, buf *LogBuffer, executor Executor) error {
	buf.Writef("[Container] 检查 Docker 环境...")
	if err := d.runCommand(ctx, buf, executor, "docker --version", "/", 30); err != nil {
		buf.Writef("[Container] Docker 未安装或无法使用: %v", err)
		return fmt.Errorf("docker not available: %w", err)
	}
	if err := d.runCommand(ctx, buf, executor, "docker-compose --version || docker compose version", "/", 30); err != nil {
		buf.Writef("[Container] docker-compose 未安装或无法使用: %v", err)
		return fmt.Errorf("docker-compose not available: %w", err)
	}
	buf.Writef("[Container] Docker 环境检查通过")
	return nil
}

// runContainerDeploy 容器化部署（仅支持 docker-compose）
func (d *Deployer) runContainerDeploy(ctx context.Context, buf *LogBuffer, cfg *Config, executor Executor, actualCodeDir string) error {
	cc, err := parseContainerConfig(cfg.ContainerConfig)
	if err != nil {
		buf.Writef("[Container] 解析容器配置失败: %v", err)
		return fmt.Errorf("parse container config: %w", err)
	}

	if err := d.checkDocker(ctx, buf, executor); err != nil {
		return err
	}

	// 切换到 compose 文件所在目录执行命令
	workDir := actualCodeDir
	composeFile := cc.ComposeFile
	if composeFile != "" && composeFile != "docker-compose.yml" && strings.Contains(composeFile, "/") {
		workDir = filepath.Join(actualCodeDir, filepath.Dir(composeFile))
		composeFile = filepath.Base(composeFile)
	}

	// 1. 执行构建命令
	buf.Writef("[Container] 执行构建命令: %s", cc.BuildCmd)
	buildCmd := cc.BuildCmd
	if composeFile != "docker-compose.yml" && !strings.Contains(buildCmd, " -f ") {
		buildCmd = fmt.Sprintf("%s -f %s", buildCmd, composeFile)
	}
	if err := d.runCommand(ctx, buf, executor, buildCmd, workDir, cfg.TimeoutSec); err != nil {
		buf.Writef("[Container] 构建命令执行失败: %v", err)
		return fmt.Errorf("container build: %w", err)
	}

	// 2. 执行启动命令
	buf.Writef("[Container] 执行启动命令: %s", cc.UpCmd)
	upCmd := cc.UpCmd
	if composeFile != "docker-compose.yml" && !strings.Contains(upCmd, " -f ") {
		upCmd = fmt.Sprintf("%s -f %s", upCmd, composeFile)
	}
	if err := d.runCommand(ctx, buf, executor, upCmd, workDir, cfg.TimeoutSec); err != nil {
		buf.Writef("[Container] 启动命令执行失败: %v", err)
		return fmt.Errorf("container up: %w", err)
	}

	buf.Writef("[Container] docker-compose 部署完成")
	return nil
}

// mkdirRemote 通过 Executor 创建远程目录
func (d *Deployer) mkdirRemote(ctx context.Context, executor Executor, dir string, buf *LogBuffer) error {
	// 本地 Windows 没有 mkdir -p，直接用 Go 创建（含多级）
	if isLocalExecutor(executor) && runtime.GOOS == "windows" {
		if err := os.MkdirAll(dir, 0755); err != nil {
			return fmt.Errorf("mkdir: %w", err)
		}
		return nil
	}
	return executor.Run(ctx, "mkdir -p "+dir, io.Discard, io.Discard)
}

// writeRemoteFile 通过 Executor 写入远程文件（使用 base64 编码避免特殊字符问题）
func (d *Deployer) writeRemoteFile(ctx context.Context, executor Executor, remotePath, content string, perm uint32) error {
	encoded := base64.StdEncoding.EncodeToString([]byte(content))
	cmd := fmt.Sprintf("echo '%s' | base64 -d > %s && chmod %o %s", encoded, sysutil.ShellEscape(remotePath), perm, sysutil.ShellEscape(remotePath))
	return executor.Run(ctx, cmd, io.Discard, io.Discard)
}

// writeEnvFileRemote 通过 Executor 写入远程 .env 文件
func (d *Deployer) writeEnvFileRemote(executor Executor, vars map[string]string, envPath string, buf *LogBuffer) error {
	var lines []string
	for k, v := range vars {
		lines = append(lines, fmt.Sprintf("%s=%s", k, v))
	}
	content := strings.Join(lines, "\n") + "\n"
	// 本地 Windows 没有 base64 -d（cmd 下不可用），直接用 Go 写文件
	if isLocalExecutor(executor) && runtime.GOOS == "windows" {
		if err := os.WriteFile(envPath, []byte(content), 0644); err != nil {
			return fmt.Errorf("write env file: %w", err)
		}
		return nil
	}
	encoded := base64.StdEncoding.EncodeToString([]byte(content))
	cmd := fmt.Sprintf("echo '%s' | base64 -d > %s", encoded, sysutil.ShellEscape(envPath))
	return executor.Run(context.Background(), cmd, io.Discard, io.Discard)
}
