1. Go 下载到当前目录，`tar` 解压到 `/usr/local`。
2. 环境变量加在末尾，conda 的 `go` 仍然优先 → `go version` 触发旧版工具链下载 → 超时。
3. 你删了旧 go，但 `~/.bashrc` 或 conda 的 `PATH` 配置可能还有残留，导致找不到 go。