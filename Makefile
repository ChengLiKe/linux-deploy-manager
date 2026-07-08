.DEFAULT_GOAL := build

BINARY_NAME := linux-deploy-manager
VERSION ?= dev
BUILD_TIME := $(shell date +%Y%m%d-%H%M%S)
GIT_COMMIT := $(shell git rev-parse --short HEAD 2>/dev/null || echo "unknown")
LDFLAGS := -ldflags "-X main.version=$(VERSION) -X main.buildTime=$(BUILD_TIME) -X main.gitCommit=$(GIT_COMMIT)"

.PHONY: build build-web run test lint clean dev electron-dev electron-build electron-pack

# 构建前端
build-web:
	cd web && npm install && npm run build

# 同步前端产物到后端可嵌入目录（go:embed 路径不能跨越包目录）
copy-web: build-web
	rm -rf cmd/server/web/dist
	mkdir -p cmd/server/web
	cp -r web/dist cmd/server/web/dist

# 构建完整二进制（包含前端）
build: copy-web
	go build $(LDFLAGS) -o bin/$(BINARY_NAME) ./cmd/server

# 开发模式（嵌入前端产物，使用本地数据目录避免权限问题）
dev: copy-web
	go run $(LDFLAGS) ./cmd/server --mode=debug -data-dir ./data -log-dir ./logs -port 18081

# 运行测试
test:
	go test -v -race -coverprofile=coverage.out ./...
	go tool cover -func=coverage.out

# 代码检查
lint:
	golangci-lint run ./...

# 格式化代码
fmt:
	go fmt ./...

# 清理构建产物
clean:
	rm -rf bin/ web/dist/ cmd/server/web/dist coverage.out dist-electron/

# 交叉编译 Linux AMD64
build-linux-amd64: copy-web
	GOOS=linux GOARCH=amd64 go build $(LDFLAGS) -o bin/$(BINARY_NAME)-linux-amd64 ./cmd/server

# 交叉编译 Linux ARM64
build-linux-arm64: copy-web
	GOOS=linux GOARCH=arm64 go build $(LDFLAGS) -o bin/$(BINARY_NAME)-linux-arm64 ./cmd/server

# 安装到系统
install: build
	cp bin/$(BINARY_NAME) /usr/local/bin/

# Electron 开发模式（启动 Electron 窗口）
# 前置条件：Go 后端已构建（make build），Vite dev server 已启动（cd web && npm run dev）
electron-dev:
	@echo "Starting Electron in dev mode..."
	@echo "Prerequisites: make build && cd web && npm run dev"
	npx electron electron/main.js

# Electron 构建（完整流程：构建前端 + Go 二进制 + Electron 打包）
electron-build: build
	npx electron-builder

# Electron 快速打包（跳过构建，直接使用已有产物）
electron-pack:
	npx electron-builder
