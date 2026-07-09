package main

import (
	"embed"
	"fmt"
	"io/fs"
	"log/slog"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/linux-deploy-manager/internal/auth"
	"github.com/linux-deploy-manager/internal/config"
	"github.com/linux-deploy-manager/internal/connectivity"
	"github.com/linux-deploy-manager/internal/deployer"
	"github.com/linux-deploy-manager/internal/envman"
	"github.com/linux-deploy-manager/internal/handler"
	"github.com/linux-deploy-manager/internal/middleware"
	"github.com/linux-deploy-manager/internal/model"
	"github.com/linux-deploy-manager/internal/nodeinit"
	"github.com/linux-deploy-manager/internal/remote/sshclient"
	"github.com/linux-deploy-manager/internal/repository"
	"github.com/linux-deploy-manager/internal/service"
	"github.com/linux-deploy-manager/internal/terminal"
	"github.com/linux-deploy-manager/internal/websocket"
)

//go:embed web/dist
var webFS embed.FS

var version = "dev"

func main() {
	cfg := config.Load()

	// 初始化数据目录
	if err := os.MkdirAll(cfg.DataDir, 0750); err != nil {
		slog.Error("create data dir failed", "error", err)
		os.Exit(1)
	}
	if err := os.MkdirAll(cfg.LogDir, 0750); err != nil {
		slog.Error("create log dir failed", "error", err)
		os.Exit(1)
	}
	if err := os.MkdirAll(filepath.Join(cfg.DataDir, "keys"), 0700); err != nil {
		slog.Error("create keys dir failed", "error", err)
		os.Exit(1)
	}
	if err := os.MkdirAll(filepath.Join(cfg.LogDir, "deploy"), 0750); err != nil {
		slog.Error("create deploy log dir failed", "error", err)
		os.Exit(1)
	}

	// 初始化日志
	initLogger(cfg.LogDir)

	// 初始化数据库
	db, err := model.InitDB(filepath.Join(cfg.DataDir, "db.sqlite"))
	if err != nil {
		slog.Error("init database failed", "error", err)
		os.Exit(1)
	}

	// 初始化仓库层
	repo := repository.New(db)

	// 初始化认证模块
	authService := auth.NewService(cfg.DataDir)

	// 初始化部署引擎
	deployerEngine := deployer.NewDeployer()
	initEngine := nodeinit.NewInitEngine(db)

	// 获取允许的 CORS 来源（空格分隔，* 表示任意）
	allowedOrigins := strings.Fields(os.Getenv("LDM_ALLOWED_ORIGINS"))
	if len(allowedOrigins) == 0 {
		allowedOrigins = []string{"*"} // 开发默认
	}

	// 初始化 SSH 连接池
	sshPool := sshclient.NewPool()

	// 初始化 WebSocket 管理器
	wsManager := websocket.NewManager(authService, allowedOrigins)
	wsManager.SetLogBufferGetter(func(taskID string) websocket.LogBuffer {
		buf := deployerEngine.GetTaskLogBuffer(taskID)
		if buf == nil {
			return nil
		}
		return buf
	})

	// 初始化终端管理器
	termManager := terminal.NewManager()

	// 初始化服务层
	svc := service.New(repo, authService, filepath.Join(cfg.DataDir, "keys"), cfg.LogDir, deployerEngine, sshPool)

	// 终端 handler（供路由注册使用）
	termHandler := handler.NewTerminalHandler(svc, termManager, repo.ServerNode, repo.Key, allowedOrigins)

	// 同步当前用户的系统 SSH 密钥
	if err := svc.Key.SyncSystemKeys(); err != nil {
		slog.Error("sync system ssh keys failed", "error", err)
	}

	// 检测服务器环境管理工具
	envmanTools := envman.DetectAll()
	for name, info := range envmanTools {
		if info.Installed {
			slog.Info("env manager detected", "tool", name, "version", info.Version)
		}
	}

	// 设置 Gin
	if cfg.Mode == "release" {
		gin.SetMode(gin.ReleaseMode)
	}
	r := gin.New()
	r.Use(middleware.Recovery())
	r.Use(middleware.Logger())
	r.Use(middleware.CORS(allowedOrigins))

	// 注册 API 路由
	api := r.Group("/api/v1")
	{
		// 认证路由（不需要 JWT）
		authHandler := handler.NewAuthHandler(authService)
		api.GET("/auth/status", authHandler.Status)
		api.POST("/auth/setup", authHandler.Setup)
		api.POST("/auth/login", authHandler.Login)
		api.POST("/auth/change-password", middleware.JWTAuth(authService), authHandler.ChangePassword)

		// 需要认证的路由
		authorized := api.Group("")
		authorized.Use(middleware.JWTAuth(authService))
		{
			authorized.GET("/version", func(c *gin.Context) {
				c.JSON(http.StatusOK, gin.H{"version": version})
			})

			keyHandler := handler.NewKeyHandler(svc)
			authorized.GET("/keys", keyHandler.List)
			authorized.POST("/keys", keyHandler.Create)
			authorized.POST("/keys/import", keyHandler.Import)
			authorized.GET("/keys/:id", keyHandler.Get)
			authorized.DELETE("/keys/:id", keyHandler.Delete)
			authorized.POST("/keys/:id/test", keyHandler.Test)

			serverNodeHandler := handler.NewServerNodeHandler(svc)
			authorized.GET("/server-nodes", serverNodeHandler.List)
			authorized.POST("/server-nodes", serverNodeHandler.Create)
			authorized.GET("/server-nodes/:id", serverNodeHandler.Get)
			authorized.PUT("/server-nodes/:id", serverNodeHandler.Update)
			authorized.DELETE("/server-nodes/:id", serverNodeHandler.Delete)
			authorized.POST("/server-nodes/:id/test", serverNodeHandler.Test)
			authorized.POST("/server-nodes/:id/distribute-key", serverNodeHandler.DistributeKey)

			// 服务器网址管理
			serverURLHandler := handler.NewServerURLHandler(repo.ServerURL)
			authorized.GET("/server-nodes/:node_id/urls", serverURLHandler.List)
			authorized.POST("/server-urls", serverURLHandler.Create)
			authorized.PUT("/server-urls/:id", serverURLHandler.Update)
			authorized.DELETE("/server-urls/:id", serverURLHandler.Delete)

			fixHandler := handler.NewFixHandler(svc)
			authorized.POST("/auto-fix", fixHandler.AutoFix)

			diagnoseHandler := handler.NewDiagnoseHandler(svc, connectivity.NewConnectivityDiagnoser(repo.ServerNode, repo.Key))
			authorized.POST("/server-nodes/:id/diagnose", diagnoseHandler.Diagnose)

			initHandler := handler.NewInitHandler(svc, initEngine, db, repo.ServerNode, repo.Key)
			authorized.POST("/server-nodes/:id/init", initHandler.Init)
			authorized.GET("/server-nodes/:id/init-log", initHandler.InitLog)

			projectHandler := handler.NewProjectHandler(svc)
			authorized.GET("/projects", projectHandler.List)
			authorized.POST("/projects", projectHandler.Create)
			authorized.GET("/projects/:id", projectHandler.Get)
			authorized.PUT("/projects/:id", projectHandler.Update)
			authorized.PATCH("/projects/:id", projectHandler.Patch)
			authorized.DELETE("/projects/:id", projectHandler.Delete)
			authorized.POST("/projects/:id/clone", projectHandler.Clone)
			authorized.GET("/projects/:id/branches", projectHandler.Branches)
			authorized.POST("/projects/:id/deploy", projectHandler.Deploy)

			fsHandler := handler.NewFSHandler()
			authorized.GET("/fs/list", fsHandler.ListDir)
			authorized.POST("/fs/check-dir", fsHandler.CheckDir)

			envManHandler := handler.NewEnvManHandler()
			authorized.GET("/envman/detect", envManHandler.Detect)
			authorized.GET("/envman/envs", envManHandler.ListEnvs)
			authorized.POST("/envman/envs", envManHandler.CreateEnv)

			taskHandler := handler.NewTaskHandler(svc)
			authorized.GET("/tasks", taskHandler.List)
			authorized.GET("/tasks/:id", taskHandler.Get)
			authorized.GET("/tasks/:id/log", taskHandler.Log)
			authorized.POST("/tasks/:id/cancel", taskHandler.Cancel)
			authorized.GET("/tasks/:id/download", taskHandler.Download)

			settingHandler := handler.NewSettingHandler(svc.Setting)
			authorized.GET("/settings", settingHandler.Get)
			authorized.PUT("/settings", settingHandler.Set)
			authorized.POST("/settings", settingHandler.Set)

			// 终端管理 API
			authorized.GET("/terminal/sessions", termHandler.ListSessions)
			authorized.DELETE("/terminal/sessions/:session_id", termHandler.DisconnectSession)
		}
	}

	// WebSocket 路由
	r.GET("/ws/deploy/:task_id", wsManager.Handle)
	r.GET("/ws/instance-logs/:project_id", handler.NewInstanceLogHandler(svc, authService, allowedOrigins).Handle)
	r.GET("/ws/terminal/:node_id", termHandler.Handle)

	// 静态文件服务
	staticFS, err := fs.Sub(webFS, "web/dist")
	if err != nil {
		slog.Error("open embedded web dist failed", "error", err)
		os.Exit(1)
	}
	staticServer := middleware.ServeEmbed(http.FS(staticFS))
	r.NoRoute(staticServer)

	// 创建 TCP listener，支持随机端口（port=0 时由操作系统分配）
	addr := fmt.Sprintf("%s:%d", cfg.Bind, cfg.Port)
	listener, err := net.Listen("tcp", addr)
	if err != nil {
		slog.Error("create listener failed", "error", err)
		os.Exit(1)
	}

	// 获取实际分配的端口（当 cfg.Port=0 时，这里会返回操作系统分配的随机端口）
	actualPort := listener.Addr().(*net.TCPAddr).Port

	// Electron 模式下：将实际端口写入文件，通知 Electron 主进程
	if portFile := os.Getenv("LDM_PORT_FILE"); portFile != "" {
		if err := os.MkdirAll(filepath.Dir(portFile), 0750); err != nil {
			slog.Error("create port file dir failed", "error", err, "path", filepath.Dir(portFile))
			os.Exit(1)
		}
		if err := os.WriteFile(portFile, []byte(fmt.Sprintf("%d", actualPort)), 0644); err != nil {
			slog.Error("write port file failed", "error", err, "path", portFile)
			os.Exit(1)
		}
		slog.Info("port file written", "path", portFile, "port", actualPort)
	}

	slog.Info("server starting", "addr", listener.Addr().String(), "version", version, "mode", cfg.Mode)
	if err := r.RunListener(listener); err != nil {
		slog.Error("server failed", "error", err)
		os.Exit(1)
	}
}

func initLogger(logDir string) {
	logFile := filepath.Join(logDir, "app.log")
	f, err := os.OpenFile(logFile, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0644)
	if err != nil {
		panic(fmt.Sprintf("open log file failed: %v", err))
	}
	logger := slog.New(slog.NewJSONHandler(f, &slog.HandlerOptions{
		Level: slog.LevelInfo,
	}))
	slog.SetDefault(logger)
}
