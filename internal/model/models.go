package model

import "time"

// ServerNode 远程服务器节点
type ServerNode struct {
	ID          uint       `gorm:"primaryKey" json:"id"`
	Name        string     `gorm:"size:50;not null" json:"name"`
	Host        string     `gorm:"size:255;not null" json:"host"`
	Port        int        `gorm:"default:22" json:"port"`
	User        string     `gorm:"size:50;default:'root'" json:"user"`
	AuthType    string     `gorm:"size:20;not null;default:'key'" json:"auth_type"`
	ServerKeyID *uint      `json:"server_key_id"`
	Password    string     `gorm:"size:255" json:"-"` // 加密存储，不返回前端
	Status      string     `gorm:"size:20;default:'unknown'" json:"status"`
	InitStatus  string     `gorm:"size:20;default:'pending'" json:"init_status"`
	// pending / initializing / ready / init_failed
	InitVersion string     `gorm:"size:20;default:''" json:"init_version"`
	LastCheckAt *time.Time `json:"last_check_at"`
	Description string     `gorm:"size:500" json:"description"`
	CreatedAt   time.Time  `json:"created_at"`
	UpdatedAt   time.Time  `json:"updated_at"`

	ServerKey *SSHKey `gorm:"foreignKey:ServerKeyID" json:"server_key,omitempty"`
}

// SSHKey SSH 密钥
type SSHKey struct {
	ID          uint      `gorm:"primaryKey" json:"id"`
	Name        string    `gorm:"size:50;not null;uniqueIndex" json:"name"`
	Algorithm   string    `gorm:"size:20;not null;default:'ed25519'" json:"algorithm"`
	PublicKey   string    `gorm:"type:text;not null" json:"public_key"`
	PrivatePath string    `gorm:"size:255;not null" json:"-"`                       // 不返回给前端
	Source      string    `gorm:"size:20;not null;default:'managed'" json:"source"` // managed: 应用生成, system: 系统 ~/.ssh
	KeyType     string    `gorm:"size:20;not null;default:'git'" json:"key_type"`   // git: 连接Git仓库, server: 连接服务器
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

// Project 项目（可部署的应用单元）
type Project struct {
	ID              uint      `gorm:"primaryKey" json:"id"`
	Name            string    `gorm:"size:50;not null;uniqueIndex" json:"name"`
	Description     string    `gorm:"size:500;default:''" json:"description"`
	GitURL          string    `gorm:"size:255;not null" json:"git_url"`
	SSHKeyID        uint      `gorm:"not null" json:"ssh_key_id"`
	ServerNodeID    *uint     `json:"server_node_id"`
	CodeDir         string    `gorm:"size:4096;not null" json:"code_dir"`
	DeployDir       string    `gorm:"size:4096;default:''" json:"deploy_dir"`
	EnvFormat       string    `gorm:"size:20;default:'dotenv'" json:"env_format"`
	EnvContent      string    `gorm:"type:text;default:''" json:"env_content"`
	EnvEncrypted    bool      `gorm:"default:false" json:"env_encrypted"`
	DeployMode      string    `gorm:"size:20;not null;default:'local'" json:"deploy_mode"`
	PreCmd          string    `gorm:"type:text;default:''" json:"pre_cmd"`
	DeployCmd       string    `gorm:"type:text;default:''" json:"deploy_cmd"`
	PostCmd         string    `gorm:"type:text;default:''" json:"post_cmd"`
	TimeoutSec      int       `gorm:"default:600" json:"timeout_sec"`
	ContainerConfig string    `gorm:"type:text;default:''" json:"container_config"`
	LocalConfig     string    `gorm:"type:text;default:''" json:"local_config"`
	Status          string    `gorm:"size:20;default:'draft'" json:"status"`
	CreatedAt       time.Time `json:"created_at"`
	UpdatedAt       time.Time `json:"updated_at"`

	SSHKey     SSHKey      `gorm:"foreignKey:SSHKeyID" json:"-"`
	ServerNode *ServerNode  `gorm:"foreignKey:ServerNodeID" json:"-"`
	Tasks      []DeployTask `gorm:"foreignKey:ProjectID" json:"-"`
}

// DeployTask 部署任务
type DeployTask struct {
	ID        uint       `gorm:"primaryKey" json:"id"`
	ProjectID uint       `gorm:"not null;index" json:"project_id"`
	Branch    string     `gorm:"size:255;not null" json:"branch"`
	CommitSHA string     `gorm:"size:40;default:''" json:"commit_sha"`
	Status    string     `gorm:"size:20;not null;default:'pending'" json:"status"`
	StartedAt *time.Time `json:"started_at"`
	EndedAt   *time.Time `json:"ended_at"`
	LogPath   string     `gorm:"size:4096;not null" json:"log_path"`
	TriggeredBy string  `gorm:"size:100;default:'root'" json:"triggered_by"`
	ErrorMsg  string     `gorm:"type:text;default:''" json:"error_msg"`
	CreatedAt time.Time  `json:"created_at"`

	Project Project `gorm:"foreignKey:ProjectID" json:"-"`
}

// ProjectHistory 项目部署历史快照
type ProjectHistory struct {
	ID             uint      `gorm:"primaryKey" json:"id"`
	ProjectID      uint      `json:"project_id"`
	TaskID         uint      `json:"task_id"`
	ConfigSnapshot string    `gorm:"type:text;not null" json:"config_snapshot"`
	CreatedAt      time.Time `json:"created_at"`
}

// Setting 项目级设置（键值对）
type Setting struct {
	ID        uint      `gorm:"primaryKey" json:"id"`
	Key       string    `gorm:"size:100;not null;uniqueIndex" json:"key"`
	Value     string    `gorm:"type:text;not null" json:"value"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// NodeInitLog 节点初始化日志
type NodeInitLog struct {
	ID        uint       `gorm:"primaryKey" json:"id"`
	NodeID    uint       `gorm:"not null;index" json:"node_id"`
	Phase     string     `gorm:"size:20;not null" json:"phase"`      // system / tools / runtime / config_sync
	Status    string     `gorm:"size:20;not null" json:"status"`     // running / success / failed / rolled_back
	StepName  string     `gorm:"size:100" json:"step_name"`
	Output    string     `gorm:"type:text" json:"output"`
	ErrorMsg  string     `gorm:"type:text" json:"error_msg"`
	StartedAt time.Time  `json:"started_at"`
	EndedAt   *time.Time `json:"ended_at"`
}
