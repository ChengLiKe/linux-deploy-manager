package service

import (
	"fmt"

	"github.com/linux-deploy-manager/internal/repository"
)

// SettingService 项目级设置服务
type SettingService struct {
	repo repository.SettingRepository
}

// NewSettingService 创建设置服务
func NewSettingService(repo repository.SettingRepository) *SettingService {
	return &SettingService{repo: repo}
}

const (
	SettingKeySudoPassword = "sudo_password"
	SettingKeySudoEnabled  = "sudo_enabled"
	SettingKeyTheme        = "theme"
)

// allowedSettingKeys 允许通过 API 设置的白名单 key
var allowedSettingKeys = map[string]bool{
	SettingKeySudoPassword: true,
	SettingKeySudoEnabled:  true,
	SettingKeyTheme:        true,
}

// Get 获取配置值
func (s *SettingService) Get(key string) (string, error) {
	return s.repo.Get(key)
}

// Set 设置配置项（仅允许白名单 key）
func (s *SettingService) Set(key, value string) error {
	if !allowedSettingKeys[key] {
		return fmt.Errorf("setting key %q is not allowed", key)
	}
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

// GetSudoEnabled 获取 sudo 是否启用
func (s *SettingService) GetSudoEnabled() (bool, error) {
	val, err := s.repo.Get(SettingKeySudoEnabled)
	if err != nil {
		return false, err
	}
	return val == "true", nil
}

// SetSudoEnabled 设置 sudo 是否启用
func (s *SettingService) SetSudoEnabled(enabled bool) error {
	return s.repo.Set(SettingKeySudoEnabled, fmt.Sprintf("%t", enabled))
}
