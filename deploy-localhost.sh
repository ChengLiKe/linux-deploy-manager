#!/bin/bash
set -e

APP_NAME="linux-deploy-manager"
BINARY="/usr/local/bin/$APP_NAME"
DATA_DIR="/var/lib/$APP_NAME"
LOG_DIR="/var/log/$APP_NAME"
PORT=18081

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

info()  { echo -e "${GREEN}[INFO]${NC} $1"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }
err()   { echo -e "${RED}[ERROR]${NC} $1"; }

# 切换到脚本所在目录（项目根目录）
cd "$(dirname "$0")"

echo "=============================="
echo "  $APP_NAME 本地部署"
echo "=============================="

# ── 检查 Docker（用来编译） ──────────────────────────
if ! command -v docker &>/dev/null; then
  err "需要 Docker 来编译，请先安装 Docker"
  exit 1
fi
info "Docker 正常"

# ── 用 Docker 编译二进制（静态链接，无 glibc 依赖） ──
info "编译中（Docker 内构建，耗时约 2-3 分钟）..."
docker run -i --rm \
  -v "$(pwd):/src" -w /src \
  golang:1.23-alpine \
  sh << 'DOCKER_EOF'
set -e

# 安装编译依赖
apk add --no-cache gcc musl-dev nodejs npm

# 构建前端
cd web
npm ci --registry=https://registry.npmmirror.com
npm run build
cd ..

# 下载 Go 依赖
GOPROXY=https://goproxy.cn,direct go mod download

# 构建静态链接的二进制
CGO_ENABLED=1 go build \
  -ldflags '-linkmode external -extldflags "-static" -s -w -X main.version=1.0.0' \
  -o linux-deploy-manager \
  ./cmd/server

echo "BUILD_DONE"
DOCKER_EOF

if [ ! -f "linux-deploy-manager" ]; then
  err "编译失败，未生成二进制文件"
  exit 1
fi
info "编译成功"

# ── 停止旧服务 ───────────────────────────────────────
if systemctl is-active --quiet "$APP_NAME" 2>/dev/null; then
  info "停止旧服务..."
  systemctl stop "$APP_NAME"
fi

# ── 安装二进制 ───────────────────────────────────────
info "安装二进制到 $BINARY ..."
cp linux-deploy-manager "$BINARY"
chmod 755 "$BINARY"
rm -f linux-deploy-manager

# ── 创建数据目录 ─────────────────────────────────────
info "创建数据目录..."
mkdir -p "$DATA_DIR" "$LOG_DIR"
chmod 750 "$DATA_DIR" "$LOG_DIR"

# ── 安装 systemd 服务 ────────────────────────────────
info "安装 systemd 服务..."
cat > "/etc/systemd/system/$APP_NAME.service" << EOF
[Unit]
Description=Linux Deploy Manager
After=network.target

[Service]
ExecStart=$BINARY -data-dir $DATA_DIR -log-dir $LOG_DIR -port $PORT --mode=release
Restart=always
RestartSec=5
User=root

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable "$APP_NAME"
systemctl start "$APP_NAME"

# ── 完成 ─────────────────────────────────────────────
ip=$(curl -s ifconfig.me 2>/dev/null || echo "服务器IP")
info "部署完成!"
echo ""
echo "  访问: http://$ip:$PORT"
echo "  首次访问会自动跳转到设置密码页面"
echo ""
echo "常用命令:"
echo "  查看日志: journalctl -u $APP_NAME -f"
echo "  重启服务: systemctl restart $APP_NAME"
echo "  停止服务: systemctl stop $APP_NAME"
