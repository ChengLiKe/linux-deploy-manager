package nodeinit

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/linux-deploy-manager/internal/model"
	"github.com/linux-deploy-manager/internal/remote/sshclient"
	"gorm.io/gorm"
)

// PhaseConfig 初始化阶段配置
type PhaseConfig struct {
	Name    string                                             // 阶段名称 system / tools / runtime / config_sync
	Steps   []StepConfig                                       // 步骤列表
	OnError func(ctx context.Context, failedIdx int) error     // 失败时的回滚回调
}

// StepConfig 步骤配置
type StepConfig struct {
	Name    string                                             // 步骤名称
	Command string                                             // 执行的命令
	Retries int                                                // 最大重试次数（默认 2）
}

// InitEngine 节点初始化引擎
type InitEngine struct {
	db      *gorm.DB
}

// NewInitEngine 创建初始化引擎
func NewInitEngine(db *gorm.DB) *InitEngine {
	return &InitEngine{db: db}
}

// InitResult 初始化结果
type InitResult struct {
	NodeID   uint   `json:"node_id"`
	Status   string `json:"status"`    // success / failed / rolled_back
	Phases   []PhaseResult `json:"phases"`
}

// PhaseResult 阶段执行结果
type PhaseResult struct {
	Name    string `json:"name"`
	Status  string `json:"status"`    // running / success / failed / skipped
	Steps   []StepResult `json:"steps"`
}

// StepResult 步骤执行结果
type StepResult struct {
	Name    string `json:"name"`
	Status  string `json:"status"`    // success / failed
	Output  string `json:"output"`
	Error   string `json:"error,omitempty"`
}

// Execute 执行节点初始化
func (e *InitEngine) Execute(ctx context.Context, client *sshclient.Client, node *model.ServerNode) *InitResult {
	result := &InitResult{
		NodeID: node.ID,
		Status: "success",
	}

	// 更新节点状态为初始化中
	e.updateNodeStatus(node.ID, "initializing")

	phases := e.buildPhases(client)
	rollbackStack := make([]int, 0) // 已成功执行的 phase 索引

	for i, phase := range phases {
		// 检查 context 是否已取消
		if ctx.Err() != nil {
			result.Status = "failed"
			result.Phases = append(result.Phases, PhaseResult{
				Name: phase.Name, Status: "skipped",
			})
			continue
		}

		pr := e.executePhase(ctx, client, node.ID, phase)
		result.Phases = append(result.Phases, pr)

		if pr.Status == "success" {
			rollbackStack = append(rollbackStack, i)
		} else {
			// 执行回滚
			result.Status = "rolled_back"
			e.rollback(ctx, client, node.ID, phases, rollbackStack)
			e.updateNodeStatus(node.ID, "init_failed")
			return result
		}
	}

	// 全部成功
	if result.Status == "success" {
		e.updateNodeStatus(node.ID, "ready")
	}
	return result
}

// buildPhases 构建初始化阶段
func (e *InitEngine) buildPhases(client *sshclient.Client) []PhaseConfig {
	return []PhaseConfig{
		{
			Name: "system",
			Steps: []StepConfig{
				{Name: "检测操作系统", Command: "cat /etc/os-release 2>/dev/null | head -3 || uname -a", Retries: 1},
				{Name: "检测系统架构", Command: "uname -m", Retries: 1},
				{Name: "检测磁盘空间", Command: "df -h / | tail -1", Retries: 1},
				{Name: "检测内存", Command: "free -m | grep Mem", Retries: 1},
			},
		},
		{
			Name: "tools",
			Steps: []StepConfig{
				{Name: "安装 curl", Command: detectInstallCmd("curl"), Retries: 2},
				{Name: "安装 git", Command: detectInstallCmd("git"), Retries: 2},
				{Name: "安装 unzip", Command: detectInstallCmd("unzip"), Retries: 2},
			},
		},
		{
			Name: "runtime",
			Steps: []StepConfig{
				{Name: "安装 Docker", Command: "which docker 2>/dev/null || (curl -fsSL https://get.docker.com | sh)", Retries: 1},
				{Name: "安装 Node.js (nvm)", Command: "export NVM_DIR=\"$HOME/.nvm\" && [ -s \"$NVM_DIR/nvm.sh\" ] || (curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash)", Retries: 1},
			},
		},
		{
			Name: "config_sync",
			Steps: []StepConfig{
				{Name: "配置 SSH keepalive", Command: "mkdir -p ~/.ssh && grep -q 'ServerAliveInterval' ~/.ssh/config 2>/dev/null || echo -e 'Host *\\n\\tServerAliveInterval 60\\n\\tServerAliveCountMax 3' >> ~/.ssh/config && chmod 600 ~/.ssh/config", Retries: 1},
			},
		},
	}
}

// executePhase 执行单个阶段
func (e *InitEngine) executePhase(ctx context.Context, client *sshclient.Client, nodeID uint, phase PhaseConfig) PhaseResult {
	pr := PhaseResult{Name: phase.Name, Status: "success"}

	// 创建阶段日志记录
	log := e.createLog(nodeID, phase.Name, "running", "start")

	for _, step := range phase.Steps {
		sr := e.executeStep(ctx, client, step)
		pr.Steps = append(pr.Steps, sr)
		e.saveLog(nodeID, phase.Name, sr.Status, step.Name, sr.Output, sr.Error)

		if sr.Status != "success" {
			pr.Status = "failed"
			e.saveLog(nodeID, phase.Name, "failed", step.Name, sr.Output, sr.Error)
			e.finishLog(log, "failed")
			return pr
		}
	}

	e.finishLog(log, "success")
	return pr
}

// executeStep 执行单步
func (e *InitEngine) executeStep(ctx context.Context, client *sshclient.Client, step StepConfig) StepResult {
	retries := step.Retries
	if retries <= 0 {
		retries = 2
	}

	var lastErr error
	var lastOutput string

	for attempt := 0; attempt <= retries; attempt++ {
		if attempt > 0 {
			// 指数退避
			delay := time.Duration(1<<(attempt-1)) * time.Second
			select {
			case <-time.After(delay):
			case <-ctx.Done():
				return StepResult{Name: step.Name, Status: "failed", Error: "上下文已取消"}
			}
		}

		stdout, _, done, err := client.Execute(ctx, step.Command)
		if err != nil {
			lastErr = err
			continue
		}

		execErr := <-done
		if execErr != nil {
			lastErr = execErr
			lastOutput = ""
			continue
		}

		// 读取输出
		buf := make([]byte, 4096)
		n, _ := stdout.Read(buf)
		lastOutput = string(buf[:n])
		lastErr = nil
		break
	}

	if lastErr != nil {
		return StepResult{
			Name:   step.Name,
			Status: "failed",
			Output: lastOutput,
			Error:  fmt.Sprintf("重试 %d 次后仍失败: %s", retries, lastErr.Error()),
		}
	}

	return StepResult{
		Name:   step.Name,
		Status: "success",
		Output: strings.TrimSpace(lastOutput),
	}
}

// rollback 回滚已成功的阶段
func (e *InitEngine) rollback(ctx context.Context, client *sshclient.Client, nodeID uint, phases []PhaseConfig, successIndices []int) {
	// 从后往前回滚
	for i := len(successIndices) - 1; i >= 0; i-- {
		idx := successIndices[i]
		phase := phases[idx]

		for j := len(phase.Steps) - 1; j >= 0; j-- {
			step := phase.Steps[j]
			e.saveLog(nodeID, phase.Name, "rolled_back", step.Name, "", "已回滚")
		}
	}
}

// updateNodeStatus 更新节点初始化状态
func (e *InitEngine) updateNodeStatus(nodeID uint, status string) {
	e.db.Model(&model.ServerNode{}).Where("id = ?", nodeID).Update("init_status", status)
}

// createLog 创建初始化日志记录
func (e *InitEngine) createLog(nodeID uint, phase, status, stepName string) *model.NodeInitLog {
	log := &model.NodeInitLog{
		NodeID:    nodeID,
		Phase:     phase,
		Status:    status,
		StepName:  stepName,
		StartedAt: time.Now(),
	}
	e.db.Create(log)
	return log
}

// saveLog 保存初始化日志
func (e *InitEngine) saveLog(nodeID uint, phase, status, stepName, output, errorMsg string) {
	log := &model.NodeInitLog{
		NodeID:    nodeID,
		Phase:     phase,
		Status:    status,
		StepName:  stepName,
		Output:    truncateStr(output, 2000),
		ErrorMsg:  truncateStr(errorMsg, 2000),
		StartedAt: time.Now(),
	}
	now := time.Now()
	log.EndedAt = &now
	e.db.Create(log)
}

// finishLog 完成日志记录
func (e *InitEngine) finishLog(log *model.NodeInitLog, status string) {
	now := time.Now()
	e.db.Model(log).Updates(map[string]interface{}{
		"status":   status,
		"ended_at": &now,
	})
}

// detectInstallCmd 检测包管理器并返回安装命令
func detectInstallCmd(pkg string) string {
	return fmt.Sprintf("which %s 2>/dev/null || (apt-get update -qq && apt-get install -y -qq %s) 2>/dev/null || (yum install -y -q %s) 2>/dev/null || (apk add --no-cache %s) 2>/dev/null || echo 'INSTALL_FAILED'", pkg, pkg, pkg, pkg)
}

// truncateStr 截断字符串到指定长度
func truncateStr(s string, maxLen int) string {
	if len(s) <= maxLen {
		return s
	}
	return s[:maxLen] + "..."
}
