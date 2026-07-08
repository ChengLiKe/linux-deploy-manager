package service

import "github.com/linux-deploy-manager/internal/repository"

// SettingService 项目级设置服务
type SettingService struct {
	repo repository.SettingRepository
}

// NewSettingService 创建设置服务
func NewSettingService(repo repository.SettingRepository) *SettingService {
	return &SettingService{repo: repo}
}

const (
	// SettingKeySudoPassword sudo 密码设置项
	SettingKeySudoPassword = "sudo_password"
	// SettingKeySudoEnabled 是否启用 sudo 执行 docker 命令
	SettingKeySudoEnabled = "sudo_enabled"
)

// Get 获取设置值
func (s *SettingService) Get(key string) (string, error) {
	return s.repo.Get(key)
}

// Set 设置值
func (s *SettingService) Set(key, value string) error {
	return s.repo.Set(key, value)
}

// GetSudoPassword 获取项目级 sudo 密码
func (s *SettingService) GetSudoPassword() (string, error) {
	return s.repo.Get(SettingKeySudoPassword)
}

// SetSudoPassword 设置项目级 sudo 密码
func (s *SettingService) SetSudoPassword(password string) error {
	return s.repo.Set(SettingKeySudoPassword, password)
}

// GetSudoEnabled 获取是否启用 sudo
func (s *SettingService) GetSudoEnabled() (bool, error) {
	val, err := s.repo.Get(SettingKeySudoEnabled)
	if err != nil || val == "" {
		return false, err
	}
	return val == "true", nil
}

// SetSudoEnabled 设置是否启用 sudo
func (s *SettingService) SetSudoEnabled(enabled bool) error {
	val := "false"
	if enabled {
		val = "true"
	}
	return s.repo.Set(SettingKeySudoEnabled, val)
}
