# 快速开始指南

## 5 分钟上手

### 1. 启动服务

```bash
sudo linux-deploy-manager -bind 0.0.0.0 -port 8080
```

### 2. 访问并设置密码

打开浏览器访问 `http://<服务器IP>:8080`，首次访问会自动跳转到设置页面，设置 root 密码。

### 3. 创建 SSH 密钥

进入 **密钥管理** → **创建密钥** → 选择算法（推荐 Ed25519）→ 保存。

将生成的公钥添加到你的 Git 仓库（GitHub/GitLab/Gitea）的 Deploy Keys 中。

### 4. 创建部署模板

进入 **模板管理** → **创建模板**，填写：

| 字段 | 示例值 |
|---|---|
| 名称 | my-project |
| Git 仓库 | `git@github.com:yourname/my-project.git` |
| SSH 密钥 | 选择刚创建的密钥 |
| 代码目录 | `/opt/my-project` |
| 部署模式 | local |
| 部署命令 | `cd /opt/my-project && make deploy` |
| 预部署命令 | `cd /opt/my-project && make build` |
| 超时时间 | 600 秒 |

### 5. 触发部署

进入模板详情 → **部署** → 选择分支 → **确认部署**。

实时日志会通过 WebSocket 推送到页面，部署完成后可下载日志文件。

---

## 典型部署场景

### 场景 1：静态网站部署（Nginx）

**模板配置：**
- Git 仓库：`git@github.com:company/website.git`
- 代码目录：`/var/www/website`
- 部署命令：`cp -r /var/www/website/dist/* /usr/share/nginx/html/ && systemctl reload nginx`
- 环境变量：`NGINX_ROOT=/usr/share/nginx/html`

### 场景 2：Docker 应用部署

**模板配置：**
- Git 仓库：`git@github.com:company/api-service.git`
- 代码目录：`/opt/api-service`
- 预部署命令：`cd /opt/api-service && docker-compose down`
- 部署命令：`cd /opt/api-service && docker-compose up -d --build`
- 后部署命令：`docker system prune -f`

### 场景 3：Go 服务部署（systemd）

**模板配置：**
- Git 仓库：`git@github.com:company/go-service.git`
- 代码目录：`/opt/go-service`
- 预部署命令：`cd /opt/go-service && go build -o bin/app ./cmd/server`
- 部署命令：`systemctl restart go-service && systemctl status go-service`

---

## 环境变量配置

支持 `.env` 格式：

```
DATABASE_URL=postgres://user:pass@localhost/db
REDIS_HOST=localhost
REDIS_PORT=6379
API_KEY=sk-live-xxxxxxxx
```

部署时自动写入 `代码目录/.env` 文件。

---

## 常用命令速查

```bash
# 查看日志
sudo journalctl -u linux-deploy-manager -f

# 查看数据库
sudo sqlite3 /var/lib/linux-deploy-manager/db.sqlite ".tables"

# 查看密钥
sudo ls -la /var/lib/linux-deploy-manager/keys/

# 查看部署日志
sudo ls -la /var/log/linux-deploy-manager/deploy/
```
