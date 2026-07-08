package handler

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
	"github.com/linux-deploy-manager/internal/service"
	"github.com/linux-deploy-manager/internal/sysutil"
)

type localCfg struct {
	ExecType    string `json:"exec_type"`
	ServiceName string `json:"service_name"`
}

type containerCfg struct {
	ComposeFile string `json:"compose_file"`
}

func parseLocalCfg(s string) *localCfg {
	c := &localCfg{ExecType: "direct"}
	if s != "" {
		json.Unmarshal([]byte(s), c)
	}
	return c
}

func parseContainerCfg(s string) *containerCfg {
	c := &containerCfg{ComposeFile: "docker-compose.yml"}
	if s != "" {
		json.Unmarshal([]byte(s), c)
	}
	return c
}

type clientCommand struct {
	Action string                 `json:"action"`
	Params map[string]interface{} `json:"params"`
}

type tailParams struct {
	Service string `json:"service"`
	Since   string `json:"since"`
	Until   string `json:"until"`
	Tail    int    `json:"tail"`
	Filter  string `json:"filter"`
	Level   string `json:"level"`
}

type serverMsg struct {
	Type    string   `json:"type"`
	Data    string   `json:"data,omitempty"`
	Level   string   `json:"level,omitempty"`
	Service string   `json:"service,omitempty"`
	Status  string   `json:"status,omitempty"`
	Message string   `json:"message,omitempty"`
	Services []string `json:"services,omitempty"`
	Lines   int      `json:"lines,omitempty"`
}

type InstanceLogHandler struct {
	svc      *service.Service
	upgrader websocket.Upgrader
}

func NewInstanceLogHandler(svc *service.Service) *InstanceLogHandler {
	return &InstanceLogHandler{
		svc: svc,
		upgrader: websocket.Upgrader{
			CheckOrigin: func(r *http.Request) bool { return true },
		},
	}
}

type session struct {
	conn          *websocket.Conn
	mu            sync.Mutex
	cancel        context.CancelFunc
	cmd           *exec.Cmd
	cmdMu         sync.Mutex
	templateID    uint
	svc           *service.Service
	wd            string
	deployMode    string
	localCfg      *localCfg
	containerCfg  *containerCfg
	sudoPassword  string
	composeFile   string
	composeWorkDir string
}

func (s *session) send(v interface{}) {
	s.mu.Lock()
	defer s.mu.Unlock()
	data, err := json.Marshal(v)
	if err != nil {
		return
	}
	s.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
	s.conn.WriteMessage(websocket.TextMessage, data)
}

func (s *session) stopStream() {
	s.cmdMu.Lock()
	defer s.cmdMu.Unlock()
	if s.cancel != nil {
		s.cancel()
		s.cancel = nil
	}
	if s.cmd != nil && s.cmd.Process != nil {
		s.cmd.Process.Kill()
		go s.cmd.Wait()
		s.cmd = nil
	}
}

func (s *session) getServices() []string {
	cmd := exec.Command("docker-compose", "-f", s.composeFile, "config", "--services")
	cmd.Dir = s.composeWorkDir
	out, err := cmd.Output()
	if err != nil {
		return nil
	}
	lines := strings.Split(strings.TrimSpace(string(out)), "\n")
	var services []string
	for _, l := range lines {
		if l != "" {
			services = append(services, l)
		}
	}
	return services
}

func detectLevel(line string) string {
	upper := strings.ToUpper(line)
	switch {
	case strings.Contains(upper, "[ERROR]") || strings.Contains(upper, "ERROR:"):
		return "error"
	case strings.Contains(upper, "[WARN]") || strings.Contains(upper, "[WARNING]") || strings.Contains(upper, "WARN:"):
		return "warn"
	case strings.Contains(upper, "[DEBUG]") || strings.Contains(upper, "DEBUG:"):
		return "debug"
	default:
		return "info"
	}
}

func (s *session) buildContainerExecCmd(params tailParams) *exec.Cmd {
	args := []string{"-f", s.composeFile, "logs", "-f", "--tail=100"}
	if params.Tail > 0 {
		args = []string{"-f", s.composeFile, "logs", "-f", fmt.Sprintf("--tail=%d", params.Tail)}
	}
	if params.Since != "" {
		args = append(args, "--since", params.Since)
	}
	if params.Service != "" {
		args = append(args, params.Service)
	}

	if s.sudoPassword != "" {
		cmdLine := fmt.Sprintf("cd %s && docker-compose %s", s.composeWorkDir, strings.Join(args, " "))
		return sysutil.ShellCommandContextWithSudo(context.Background(), cmdLine, s.sudoPassword)
	}
	cmd := exec.Command("docker-compose", args...)
	cmd.Dir = s.composeWorkDir
	return cmd
}

func (s *session) streamLogs(ctx context.Context, params tailParams) {
	var cmd *exec.Cmd

	switch s.deployMode {
	case "container":
		cmd = s.buildContainerExecCmd(params)
	case "local":
		lc := s.localCfg
		switch lc.ExecType {
		case "systemd":
			if sysutil.IsWindows() {
				s.send(serverMsg{Type: "error", Message: "Windows 不支持 systemd 日志"})
				return
			}
			name := lc.ServiceName
			if name == "" {
				name = fmt.Sprintf("%d", s.templateID)
			}
			jctlArgs := []string{"-u", name, "-f", "--no-pager", "-o", "cat"}
			if params.Tail > 0 {
				jctlArgs = append(jctlArgs, "-n", fmt.Sprintf("%d", params.Tail))
			} else {
				jctlArgs = append(jctlArgs, "-n", "100")
			}
			if params.Since != "" {
				jctlArgs = append(jctlArgs, "--since", params.Since)
			}
			cmd = exec.Command("journalctl", jctlArgs...)
		case "background":
			logPath := filepath.Join(s.wd, "app.log")
			if sysutil.IsWindows() {
				// Windows 使用 PowerShell 替代 tail
				pwArgs := []string{"-NoProfile", "-Command", "Get-Content", "-Wait", "-Tail", "100"}
				if params.Tail > 0 {
					pwArgs = []string{"-NoProfile", "-Command", "Get-Content", "-Wait", "-Tail", fmt.Sprintf("%d", params.Tail)}
				}
				pwArgs = append(pwArgs, logPath)
				cmd = exec.Command("powershell", pwArgs...)
			} else {
				tailArgs := []string{"-f"}
				if params.Tail > 0 {
					tailArgs = append(tailArgs, "-n", fmt.Sprintf("%d", params.Tail))
				} else {
					tailArgs = append(tailArgs, "-n", "100")
				}
				tailArgs = append(tailArgs, logPath)
				cmd = exec.Command("tail", tailArgs...)
			}
		default:
			s.send(serverMsg{Type: "error", Message: "该部署模式不支持实时实例日志"})
			return
		}

		if s.sudoPassword != "" {
			if sysutil.IsWindows() {
				// Windows 无 sudo，忽略
				s.send(serverMsg{Type: "log", Data: "[警告] Windows 环境忽略 sudo 设置"})
			} else {
				origArgs := cmd.Args
				cmdLine := strings.Join(origArgs, " ")
				cmd = sysutil.ShellCommandContextWithSudo(context.Background(), cmdLine, s.sudoPassword)
			}
		}

	default:
		s.send(serverMsg{Type: "error", Message: fmt.Sprintf("不支持的部署模式: %s", s.deployMode)})
		return
	}

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		s.send(serverMsg{Type: "error", Message: "创建 stdout 管道失败"})
		return
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		s.send(serverMsg{Type: "error", Message: "创建 stderr 管道失败"})
		return
	}

	if s.sudoPassword != "" {
		stdin, err := cmd.StdinPipe()
		if err == nil {
			go func() {
				defer stdin.Close()
				io.WriteString(stdin, s.sudoPassword+"\n")
			}()
		}
	}

	s.cmdMu.Lock()
	s.cmd = cmd
	s.cmdMu.Unlock()

	if err := cmd.Start(); err != nil {
		s.send(serverMsg{Type: "error", Message: fmt.Sprintf("启动日志命令失败: %v", err)})
		return
	}

	s.send(serverMsg{
		Type: "meta",
		Services: s.getServices(),
		Lines: params.Tail,
	})

	lineCh := make(chan string, 1024)

	go func() {
		scanner := bufio.NewScanner(stdout)
		for scanner.Scan() {
			select {
			case lineCh <- scanner.Text():
			case <-ctx.Done():
				return
			}
		}
	}()

	go func() {
		scanner := bufio.NewScanner(stderr)
		for scanner.Scan() {
			select {
			case lineCh <- "[stderr] " + scanner.Text():
			case <-ctx.Done():
				return
			}
		}
	}()

	for {
		select {
		case line := <-lineCh:
			if params.Filter != "" && !strings.Contains(line, params.Filter) {
				continue
			}
			level := detectLevel(line)
			if params.Level != "" && level != params.Level {
				continue
			}
			s.send(serverMsg{
				Type:    "log",
				Data:    line,
				Level:   level,
				Service: params.Service,
			})
		case <-ctx.Done():
			return
		}
	}
}

func (s *session) readCommands() {
	defer func() {
		s.stopStream()
	}()
	for {
		_, msgBytes, err := s.conn.ReadMessage()
		if err != nil {
			return
		}

		var cmd clientCommand
		if err := json.Unmarshal(msgBytes, &cmd); err != nil {
			continue
		}

		switch cmd.Action {
		case "tail":
			params := tailParams{Tail: 100}
			if cmd.Params != nil {
				if v, ok := cmd.Params["service"]; ok {
					params.Service, _ = v.(string)
				}
				if v, ok := cmd.Params["since"]; ok {
					params.Since, _ = v.(string)
				}
				if v, ok := cmd.Params["filter"]; ok {
					params.Filter, _ = v.(string)
				}
				if v, ok := cmd.Params["level"]; ok {
					params.Level, _ = v.(string)
				}
				if v, ok := cmd.Params["tail"]; ok {
					if f, ok := v.(float64); ok {
						params.Tail = int(f)
					}
				}
			}
			go s.streamLogs(s.makeContext(), params)

		case "stop":
			s.stopStream()

		case "service_list":
			services := s.getServices()
			s.send(serverMsg{
				Type:     "meta",
				Services: services,
			})
		}
	}
}

func (s *session) makeContext() context.Context {
	ctx, cancel := context.WithCancel(context.Background())
	s.cmdMu.Lock()
	if s.cancel != nil {
		s.cancel()
	}
	s.cancel = cancel
	s.cmdMu.Unlock()
	return ctx
}

func (s *session) heartbeat() {
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()
	for range ticker.C {
		s.cmdMu.Lock()
		cancelled := s.cancel == nil
		s.cmdMu.Unlock()
		if cancelled {
			return
		}
		s.send(serverMsg{Type: "heartbeat"})
	}
}

func (h *InstanceLogHandler) Handle(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("template_id"), 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400060, "message": "无效的模板 ID"})
		return
	}

	template, err := h.svc.Template.Get(uint(id))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"code": 404060, "message": "模板不存在"})
		return
	}

	conn, err := h.upgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		return
	}

	wd := filepath.Join(template.CodeDir, template.Name)

	sess := &session{
		conn:           conn,
		templateID:     uint(id),
		svc:            h.svc,
		wd:             wd,
		deployMode:     template.DeployMode,
		localCfg:       parseLocalCfg(template.LocalConfig),
		containerCfg:   parseContainerCfg(template.ContainerConfig),
		composeFile:    "docker-compose.yml",
		composeWorkDir: wd,
	}

	cc := sess.containerCfg
	if cc.ComposeFile != "" && cc.ComposeFile != "docker-compose.yml" {
		sess.composeFile = cc.ComposeFile
		if strings.Contains(cc.ComposeFile, "/") {
			sess.composeWorkDir = filepath.Join(wd, filepath.Dir(cc.ComposeFile))
		}
	}

	sudoEnabled, _ := h.svc.Setting.GetSudoEnabled()
	if sudoEnabled {
		sess.sudoPassword, _ = h.svc.Setting.GetSudoPassword()
	}
	if sudoEnabled && sess.sudoPassword == "" {
		sess.send(serverMsg{Type: "log", Data: "[警告] 系统设置已启用 sudo，但未配置 sudo 密码，可能权限不足"})
	}

	conn.SetPongHandler(func(string) error {
		conn.SetReadDeadline(time.Now().Add(60 * time.Second))
		return nil
	})
	conn.SetReadDeadline(time.Now().Add(60 * time.Second))

	done := make(chan struct{})
	go func() {
		sess.readCommands()
		close(done)
	}()
	go sess.heartbeat()
	go sess.streamLogs(sess.makeContext(), tailParams{Tail: 100})

	<-done
	sess.stopStream()
	conn.Close()
	slog.Info("instance log session ended", "template_id", sess.templateID)
}
