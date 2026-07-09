#!/bin/bash
#
# ===========================================================================
#  Linux Deploy Manager — 一键自动发布脚本
#  功能：代码提交 → 本地构建验证 → 打 Tag → 推送触发 CI/CD 发布
# ===========================================================================
#
# 用法:
#   ./release.sh                              # 交互式填写
#   ./release.sh -m "feat: 新增自动更新功能"    # 指定 commit 信息
#   ./release.sh -m "fix: 修复bug" -e staging  # 发布到测试环境
#   ./release.sh -m "fix: 更新版本号至 1.1.1，移除不必要的构建配置" -e production # 发布到生产环境
#   ./release.sh -m "msg" --skip-build         # 跳过本地构建验证
#   ./release.sh --dry-run                    # 预览模式，不执行实际操作
#   ./release.sh --help                       # 查看帮助
#
# 环境说明:
#   staging    → 推送到 main 分支（触发 CI 检查）
#   production → 推送到 tag（触发 CI 检查 + 自动构建安装包）
# ===========================================================================

set -euo pipefail

# ── 颜色 & 工具函数 ──────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

info()    { echo -e "${GREEN}[✓]${NC} $*"; }
warn()    { echo -e "${YELLOW}[!]${NC} $*"; }
error()   { echo -e "${RED}[✗]${NC} $*"; }
step()    { echo -e "\n${BLUE}━━━ ${BOLD}$*${NC}${BLUE} ━━━${NC}"; }
header()  { echo -e "${CYAN}${BOLD}$*${NC}"; }

# ── 默认配置 ─────────────────────────────────────────
PROJECT_ROOT="$(cd "$(dirname "$0")" && pwd)"
GIT_REMOTE="origin"
DEFAULT_BRANCH="main"

COMMIT_MSG=""
ENVIRONMENT="production"
SKIP_BUILD=false
DRY_RUN=false

# ── 参数解析 ─────────────────────────────────────────
usage() {
  header "用法:"
  echo -e "  $(basename "$0") [选项]"
  echo ""
  header "选项:"
  echo -e "  -m, --message <msg>    提交信息（不传则交互式输入）"
  echo -e "  -e, --environment <env> 目标环境: staging | production（默认 production）"
  echo -e "      --skip-build        跳过本地构建验证"
  echo -e "      --dry-run           预览模式，只显示要执行的操作"
  echo -e "      --help              显示此帮助信息"
  echo ""
  header "示例:"
  echo "  ./release.sh"
  echo "  ./release.sh -m 'feat: 新增自动更新功能'"
  echo "  ./release.sh -m 'fix: 修复部署bug' -e staging"
  echo "  ./release.sh -m 'feat: v2.0' -e production --skip-build"
  exit 0
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -m|--message)     COMMIT_MSG="$2";      shift 2 ;;
    -e|--environment) ENVIRONMENT="$2";     shift 2 ;;
    --skip-build)     SKIP_BUILD=true;      shift   ;;
    --dry-run)        DRY_RUN=true;         shift   ;;
    --help)           usage                          ;;
    *) error "未知参数: $1"; echo "使用 --help 查看帮助"; exit 1 ;;
  esac
done

# ── 环境校验 ─────────────────────────────────────────
validate_env() {
  case "$ENVIRONMENT" in
    staging|production) ;;
    *) error "不支持的环境: $ENVIRONMENT（可选: staging / production）"; exit 1 ;;
  esac
}
validate_env

# ── 进入项目目录 ─────────────────────────────────────
cd "$PROJECT_ROOT"

# ── 前置检查 ─────────────────────────────────────────
step "1/6  前置环境检查"

# 检查 git
if ! command -v git &>/dev/null; then
  error "Git 未安装，请先安装 Git"
  exit 1
fi

# 检查是否在 git 仓库中
if ! git rev-parse --git-dir &>/dev/null; then
  error "当前目录不是一个 Git 仓库"
  exit 1
fi

# 检查远程仓库
if ! git remote get-url "$GIT_REMOTE" &>/dev/null; then
  error "远程仓库 '$GIT_REMOTE' 未配置"
  exit 1
fi

REMOTE_URL=$(git remote get-url "$GIT_REMOTE")
info "项目: $(basename "$PROJECT_ROOT")"
info "远程: $REMOTE_URL"
info "分支: $(git rev-parse --abbrev-ref HEAD)"
info "环境: $ENVIRONMENT"

# 检查 uncommitted 文件
if [ -n "$(git status --porcelain)" ]; then
  warn "存在未提交的更改:"
  git status --short
  echo ""
  read -rp "是否继续提交所有更改? [Y/n]: " confirm
  if [[ ! "$confirm" =~ ^[Yy]?$ ]]; then
    error "用户取消操作"
    exit 1
  fi
fi

# ── 交互式输入 Commit 信息 ──────────────────────────
step "2/6  提交信息"

if [ -z "$COMMIT_MSG" ]; then
  echo "请输入提交信息（留空则退出）:"
  read -rp "> " COMMIT_MSG
  if [ -z "$COMMIT_MSG" ]; then
    error "提交信息不能为空"
    exit 1
  fi
fi

info "提交信息: $COMMIT_MSG"

# 预览模式：到此为止
if [ "$DRY_RUN" = true ]; then
  echo ""
  header "═════════════════════════════════════════════"
  header "  [DRY RUN] 预览模式 — 以下操作将被执行"
  header "═════════════════════════════════════════════"
  echo "  1. git add -A"
  echo "  2. git commit -m \"$COMMIT_MSG\""
  if [ "$SKIP_BUILD" = false ]; then
    echo "  3. 本地构建验证（前端 + Go 后端）"
  fi
  echo "  4. 打 Tag（从 package.json 读取版本）"
  echo "  5. git push origin main"
  echo "  6. git push origin <tag>"
  echo ""
  info "预览完成，未执行任何实际操作"
  exit 0
fi

# ── Commit ───────────────────────────────────────────
step "3/6  提交代码"

echo "添加到暂存区..."
git add -A

# 检查是否有文件需要提交
if [ -z "$(git status --porcelain)" ]; then
  warn "没有新的更改需要提交，跳过 commit 步骤"
else
  echo "执行提交..."
  if ! git commit -m "$COMMIT_MSG"; then
    error "Git 提交失败"
    exit 1
  fi
  COMMIT_HASH=$(git rev-parse --short HEAD)
  info "提交成功: $COMMIT_HASH"
fi

# ── 本地构建验证 ─────────────────────────────────────
step "4/6  本地构建验证"

if [ "$SKIP_BUILD" = true ]; then
  warn "已跳过本地构建（--skip-build）"
else
  # 检查必要的构建工具
  if ! command -v go &>/dev/null; then
    error "Go 未安装，请先安装 Go 1.22+ 或使用 --skip-build 跳过"
    exit 1
  fi
  if ! command -v node &>/dev/null; then
    error "Node.js 未安装，无法构建前端"
    exit 1
  fi

  # 前端构建
  echo ""
  echo "→ 构建前端..."
  if [ -d "web" ]; then
    if [ ! -d "web/node_modules" ]; then
      echo "  安装前端依赖..."
      (cd web && npm install) || {
        error "前端依赖安装失败"
        exit 1
      }
    fi
    (cd web && npm run build) || {
      error "前端构建失败，请检查代码后重试"
      exit 1
    }
    # 拷贝到 Go embed 目录
    rm -rf cmd/server/web/dist
    mkdir -p cmd/server/web
    cp -r web/dist cmd/server/web/dist
    info "前端构建成功"
  else
    warn "找不到 web/ 目录，跳过前端构建"
  fi

  # Go 后端构建
  echo ""
  echo "→ 构建 Go 后端..."
  CGO_ENABLED=0 go build -ldflags '-s -w' -o /dev/null ./cmd/server || {
    error "Go 后端编译失败，请检查代码后重试"
    exit 1
  }
  info "Go 后端编译成功"

  # Go vet
  echo ""
  echo "→ 代码静态检查..."
  go vet ./... || {
    warn "go vet 发现警告，建议修复后再发布"
    read -rp "是否继续发布? [y/N]: " continue_anyway
    if [[ ! "$continue_anyway" =~ ^[Yy]$ ]]; then
      error "用户取消发布"
      exit 1
    fi
  }
  info "代码检查通过"
fi

# ── 版本号 & Tag ──────────────────────────────────
step "5/6  版本管理"

# 从 package.json 读取当前版本
PKG_VERSION=""
if [ -f "package.json" ]; then
  PKG_VERSION=$(grep -o '"version": *"[^"]*"' package.json | head -1 | cut -d'"' -f4)
fi

# 获取最新的 tag 版本
LATEST_TAG=$(git tag --list 'v*' --sort=-v:refname | head -1)
LATEST_VERSION="${LATEST_TAG#v}"

echo "  当前 package.json 版本: ${PKG_VERSION:-未知}"
echo "  最新 Git Tag 版本:      ${LATEST_VERSION:-无}"

# 确定发布的版本号
# 如果 package.json 版本比最新 tag 新，用 package.json 版本
# 否则提示用户输入
if [ -n "$PKG_VERSION" ] && [ -n "$LATEST_VERSION" ]; then
  if [ "$PKG_VERSION" != "$LATEST_VERSION" ]; then
    RELEASE_VERSION="$PKG_VERSION"
  else
    # 版本相同，提示用户更新 package.json 或手动输入
    echo ""
    warn "package.json 版本 ($PKG_VERSION) 与最新 tag 相同"
    echo "请选择:"
    echo "  1) 手动输入新版本号"
    echo "  2) 自动递增补丁号（${PKG_VERSION} → $(echo "$PKG_VERSION" | awk -F. '{print $1"."$2"."$3+1}')）"
    echo "  3) 取消"
    read -rp "请选择 [1/2/3]: " ver_choice
    case "$ver_choice" in
      1) read -rp "输入新版本号: " RELEASE_VERSION ;;
      2) RELEASE_VERSION=$(echo "$PKG_VERSION" | awk -F. '{print $1"."$2"."$3+1}') ;;
      3) error "用户取消"; exit 1 ;;
      *) error "无效选择"; exit 1 ;;
    esac
  fi
elif [ -n "$PKG_VERSION" ]; then
  RELEASE_VERSION="$PKG_VERSION"
else
  read -rp "输入发布版本号（如 1.2.0）: " RELEASE_VERSION
fi

if [ -z "$RELEASE_VERSION" ]; then
  error "版本号不能为空"
  exit 1
fi

RELEASE_TAG="v$RELEASE_VERSION"
echo ""
info "发布版本: $RELEASE_TAG"

# 检查 tag 是否已存在
if git rev-parse "$RELEASE_TAG" &>/dev/null 2>&1; then
  warn "Tag '$RELEASE_TAG' 已存在"
  if [ "$ENVIRONMENT" = "production" ]; then
    read -rp "是否覆盖已有 tag 并强制推送? [y/N]: " force_tag
    if [[ ! "$force_tag" =~ ^[Yy]$ ]]; then
      error "用户取消操作"
      exit 1
    fi
    git tag -d "$RELEASE_TAG"
  else
    # staging 环境不走 tag 覆盖
    error "Tag '$RELEASE_TAG' 已存在，staging 环境不允许覆盖 tag"
    exit 1
  fi
fi

# ── 二次确认 ─────────────────────────────────────────
step "6/6  执行发布"

echo ""
header "════════════════════════════════════════════════════"
header "  即将执行以下操作"
header "════════════════════════════════════════════════════"
echo "  目标环境:  ${BOLD}$ENVIRONMENT${NC}"
echo "  提交信息:  $COMMIT_MSG"
echo "  版本 Tag:  ${BOLD}$RELEASE_TAG${NC}"
echo ""
if [ "$ENVIRONMENT" = "staging" ]; then
  echo "  推送:      main 分支 → 触发 CI 检查"
else
  echo "  推送:      main 分支 + Tag → 触发 CI 构建并发布到 GitHub Releases"
fi
echo ""

if [ "$ENVIRONMENT" = "production" ]; then
  echo -e "${YELLOW}${BOLD}⚠  生产环境发布后将生成安装包并推送给所有用户！${NC}"
fi
echo ""

read -rp "确认执行以上操作? [y/N]: " final_confirm
if [[ ! "$final_confirm" =~ ^[Yy]$ ]]; then
  error "用户取消发布"
  exit 1
fi

# ── 推送 main 分支 ──────────────────────────────────
echo ""
echo "→ 推送 main 分支到远程..."
if ! git push "$GIT_REMOTE" "$DEFAULT_BRANCH"; then
  error "推送 main 分支失败，请检查网络或权限"
  exit 1
fi
info "main 分支推送成功"

# ── 打 Tag 并推送（仅 production） ──────────────────
if [ "$ENVIRONMENT" = "production" ]; then
  echo ""
  echo "→ 创建 Tag: $RELEASE_TAG ..."
  git tag "$RELEASE_TAG"

  echo "→ 推送 Tag 到远程..."
  if ! git push "$GIT_REMOTE" "$RELEASE_TAG"; then
    error "推送 Tag 失败，尝试强制推送..."
    if ! git push "$GIT_REMOTE" "$RELEASE_TAG" --force; then
      error "强制推送 Tag 也失败，请手动处理"
      exit 1
    fi
  fi
  info "Tag 推送成功: $RELEASE_TAG"
fi

# ── 完成 ─────────────────────────────────────────────
echo ""
header "════════════════════════════════════════════════════"
header "  ✅ 发布成功！"
header "════════════════════════════════════════════════════"

echo ""
echo "  提交:     $COMMIT_MSG"

if [ "$ENVIRONMENT" = "production" ]; then
  echo "  版本:     $RELEASE_TAG"
  echo "  GitHub:   https://github.com/ChengLiKe/linux-deploy-manager/releases/tag/$RELEASE_TAG"
  echo ""
  echo "  ⏳ CI/CD 正在运行，构建完成后会自动上传安装包到 Releases"
  echo "  📦 安装包准备好后，已有客户端将自动检测到更新并提示用户"
else
  echo "  CI 检查:  https://github.com/ChengLiKe/linux-deploy-manager/actions"
fi

echo ""
echo -e "${GREEN}${BOLD}✨ 发布流程完成！${NC}"
