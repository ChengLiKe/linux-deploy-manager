# 安装指南

## 系统要求

- Linux 发行版（Ubuntu 20.04+ / Debian 11+ / CentOS 8+ / Rocky Linux 9+）
- 系统 `git` 命令（`git --version` ≥ 2.20）
- 系统 `bash`（部署命令执行环境）
- 可选：Go 1.23+（如需自行编译）

## 二进制安装（推荐）

### 1. 创建用户和数据目录

```bash
sudo useradd -r -s /bin/false ldm
sudo mkdir -p /var/lib/linux-deploy-manager /var/log/linux-deploy-manager
sudo chown ldm:ldm /var/lib/linux-deploy-manager /var/log/linux-deploy-manager
```

> 注意：虽然程序以 `ldm` 用户运行，但部署命令通常需要 root 权限。实际使用中建议以 root 运行或配置 sudo 免密。

### 2. 下载二进制

```bash
# AMD64
sudo wget -O /usr/local/bin/linux-deploy-manager \
  https://github.com/yourname/linux-deploy-manager/releases/latest/download/linux-deploy-manager-linux-amd64

# ARM64
sudo wget -O /usr/local/bin/linux-deploy-manager \
  https://github.com/yourname/linux-deploy-manager/releases/latest/download/linux-deploy-manager-linux-arm64

sudo chmod +x /usr/local/bin/linux-deploy-manager
```

### 3. 创建 systemd 服务

```bash
sudo tee /etc/systemd/system/linux-deploy-manager.service << 'EOF'
[Unit]
Description=开发管理器
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=root
ExecStart=/usr/local/bin/linux-deploy-manager \
  -bind 0.0.0.0 \
  -port 8080 \
  -data-dir /var/lib/linux-deploy-manager \
  -log-dir /var/log/linux-deploy-manager
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now linux-deploy-manager
```

### 4. 验证服务状态

```bash
sudo systemctl status linux-deploy-manager
sudo journalctl -u linux-deploy-manager -f
```

### 5. 访问 Web UI

```bash
curl http://localhost:8080
```

首次访问会自动跳转 `/setup` 页面，设置初始密码。

---

## 源码编译安装

### 前提条件

- Go 1.23+
- Node.js 18+ + npm

### 编译步骤

```bash
# 1. 克隆仓库
git clone https://github.com/yourname/linux-deploy-manager.git
cd linux-deploy-manager

# 2. 构建（自动构建前端 + 后端）
make build

# 3. 安装
sudo cp bin/linux-deploy-manager /usr/local/bin/
sudo mkdir -p /var/lib/linux-deploy-manager /var/log/linux-deploy-manager

# 4. 创建 systemd 服务（见上方）
# 5. 启动服务
sudo systemctl enable --now linux-deploy-manager
```

---

## 反向代理配置（Nginx）

```nginx
server {
    listen 80;
    server_name deploy.example.com;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400;  # WebSocket 长连接
    }
}
```

> 如需 HTTPS，建议配合 certbot 或手动配置 SSL 证书。

---

## 更新升级

```bash
# 1. 停止服务
sudo systemctl stop linux-deploy-manager

# 2. 备份数据
sudo cp -r /var/lib/linux-deploy-manager /var/lib/linux-deploy-manager.bak

# 3. 替换二进制
sudo wget -O /usr/local/bin/linux-deploy-manager \
  https://github.com/yourname/linux-deploy-manager/releases/latest/download/linux-deploy-manager-linux-amd64
sudo chmod +x /usr/local/bin/linux-deploy-manager

# 4. 启动服务
sudo systemctl start linux-deploy-manager

# 5. 验证
sudo systemctl status linux-deploy-manager
```

---

## 卸载

```bash
sudo systemctl stop linux-deploy-manager
sudo systemctl disable linux-deploy-manager
sudo rm /etc/systemd/system/linux-deploy-manager.service
sudo rm /usr/local/bin/linux-deploy-manager
sudo rm -rf /var/lib/linux-deploy-manager /var/log/linux-deploy-manager
sudo systemctl daemon-reload
```

> 数据目录包含 SQLite 数据库和 SSH 密钥，删除前请确认无需保留。
