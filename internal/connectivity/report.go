package connectivity

import "time"

// ConnectivityReport 连通性诊断报告
type ConnectivityReport struct {
	NodeID    uint              `json:"node_id"`
	NodeName  string            `json:"node_name"`
	Host      string            `json:"host"`
	Port      int               `json:"port"`
	User      string            `json:"user"`
	AuthType  string            `json:"auth_type"`
	StartTime time.Time         `json:"start_time"`
	Duration  int64             `json:"duration_ms"`
	Overall   string            `json:"overall"` // pass / partial / fail
	Items     []DiagnosticItem  `json:"items"`
	Summary   DiagnosticSummary `json:"summary"`
}

// DiagnosticItem 单条诊断项
type DiagnosticItem struct {
	ID        string          `json:"id"`         // D1, D2, ...
	Name      string          `json:"name"`       // DNS 解析, TCP 连通性, ...
	Status    string          `json:"status"`     // pass / warn / fail / skip
	Duration  int64           `json:"duration_ms"`
	Detail    string          `json:"detail"`     // 成功时的具体信息
	Error     string          `json:"error"`      // 失败时的错误描述
	Fixes     []FixSuggestion `json:"fixes"`      // 失败修复建议
	VerifyCmd string          `json:"verify_cmd"` // 辅助验证命令
}

// FixSuggestion 修复建议
type FixSuggestion struct {
	Level       string `json:"level"`       // info / warning / critical
	Title       string `json:"title"`       // 修复标题
	Description string `json:"description"` // 详细描述
	Command     string `json:"command"`     // 建议执行的命令
}

// DiagnosticSummary 诊断摘要
type DiagnosticSummary struct {
	Total   int `json:"total"`
	Passed  int `json:"passed"`
	Warned  int `json:"warned"`
	Failed  int `json:"failed"`
	Skipped int `json:"skipped"`
}

// skippedItem 创建跳过的诊断项
func skippedItem(id, name, reason string) DiagnosticItem {
	return DiagnosticItem{
		ID:     id,
		Name:   name,
		Status: "skip",
		Detail: reason,
	}
}

// passedItem 创建通过的诊断项
func passedItem(id, name, detail string, duration int64) DiagnosticItem {
	return DiagnosticItem{
		ID:       id,
		Name:     name,
		Status:   "pass",
		Detail:   detail,
		Duration: duration,
	}
}

// failedItem 创建失败的诊断项
func failedItem(id, name, errMsg string, duration int64, fixes []FixSuggestion, verifyCmd string) DiagnosticItem {
	return DiagnosticItem{
		ID:        id,
		Name:      name,
		Status:    "fail",
		Error:     errMsg,
		Duration:  duration,
		Fixes:     fixes,
		VerifyCmd: verifyCmd,
	}
}

// calculateOverall 根据各项状态计算总体结果
func (r *ConnectivityReport) calculateOverall() string {
	if r.Summary.Failed > 0 {
		return "fail"
	}
	if r.Summary.Warned > 0 {
		return "partial"
	}
	if r.Summary.Passed > 0 {
		return "pass"
	}
	return "fail"
}

// calculateSummary 汇总各项统计
func (r *ConnectivityReport) calculateSummary() DiagnosticSummary {
	s := DiagnosticSummary{Total: len(r.Items)}
	for _, item := range r.Items {
		switch item.Status {
		case "pass":
			s.Passed++
		case "warn":
			s.Warned++
		case "fail":
			s.Failed++
		case "skip":
			s.Skipped++
		}
	}
	return s
}

// Finalize 完成报告：计算持续时间和摘要
func (r *ConnectivityReport) Finalize() {
	r.Duration = time.Since(r.StartTime).Milliseconds()
	r.Summary = r.calculateSummary()
	r.Overall = r.calculateOverall()
}
