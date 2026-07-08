#!/bin/bash
set -e

APP_NAME="linux-deploy-manager"
COMPOSE_FILE="docker-compose.yml"
DATA_DIR="/var/lib/$APP_NAME"
LOG_DIR="/var/log/$APP_NAME"
PORT=18081

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

info()  { echo -e "${GREEN}[INFO]${NC} $1"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }

echo "=============================="
echo "  $APP_NAME 部署脚本"
echo "=============================="

# ── 检查 Docker ──────────────────────────────────────
if ! command -v docker &>/dev/null; then
  echo "错误: 未安装 Docker，请先安装 Docker"
  exit 1
fi
if ! command -v docker-compose &>/dev/null && ! docker compose version &>/dev/null; then
  echo "错误: 未安装 docker-compose"
  exit 1
fi
info "Docker 环境正常"
DOCKER_COMPOSE="docker-compose"
docker compose version &>/dev/null && DOCKER_COMPOSE="docker compose"

# ── 配置项目目录 ─────────────────────────────────────
EXTRA_VOLUMES=""
SSH_VOLUME=""

read -p "是否挂载 ~/.ssh 用于 Git 拉取? [Y/n]: " USE_SSH
if [[ "$USE_SSH" =~ ^[Yy]?$ ]]; then
  SSH_VOLUME="      - ~/.ssh:/root/.ssh:ro"
fi

echo ""
echo "需要部署的项目代码目录（如 /home/user/project）"
echo "多个目录用空格分隔，直接回车跳过:"
read -p "> " -a CODE_DIRS

GEN_COMPOSE=false
if [ ${#CODE_DIRS[@]} -gt 0 ]; then
  GEN_COMPOSE=true
  for dir in "${CODE_DIRS[@]}"; do
    dir="$(eval echo "$dir")"
    if [ -d "$dir" ]; then
      EXTRA_VOLUMES+="      - $dir:$dir"$'\n'
      info "添加挂载: $dir"
    else
      warn "目录不存在，跳过: $dir"
    fi
  done
fi

# ── 生成 docker-compose.yml ──────────────────────────
if [ "$GEN_COMPOSE" = true ] || [ -n "$SSH_VOLUME" ]; then
  info "生成 docker-compose.yml ..."
  cat > "$COMPOSE_FILE" << EOF
services:
  $APP_NAME:
    build: .
    container_name: $APP_NAME
    restart: unless-stopped
    ports:
      - "${PORT}:${PORT}"
    environment:
      - TZ=Asia/Shanghai
      - LDM_BIND=0.0.0.0
    volumes:
      - ldm_data:$DATA_DIR
      - ldm_logs:$LOG_DIR
      - /var/run/docker.sock:/var/run/docker.sock
$SSH_VOLUME
${EXTRA_VOLUMES}    deploy:
      resources:
        limits:
          memory: 256M
        reservations:
          memory: 128M

volumes:
  ldm_data:
  ldm_logs:
EOF
  info "docker-compose.yml 已生成"
fi

# ── 构建并启动 ────────────────────────────────────────
echo ""
info "开始构建镜像..."
$DOCKER_COMPOSE build

echo ""
info "启动服务..."
$DOCKER_COMPOSE up -d

echo ""
info "部署完成!"
echo "  访问: http://$(curl -s ifconfig.me 2>/dev/null || echo '服务器IP'):$PORT"
echo "  首次访问会自动跳转到设置密码页面"
echo ""
echo "常用命令:"
echo "  查看日志: $DOCKER_COMPOSE logs -f"
echo "  重启服务: $DOCKER_COMPOSE restart"
echo "  停止服务: $DOCKER_COMPOSE down"
