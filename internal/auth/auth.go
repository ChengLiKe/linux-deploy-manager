package auth

import (
	"crypto/rand"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"
)

const (
	passwordFile = "admin.hash"
	jwtKeyFile   = "jwt.key"
	jwtExpire    = 7 * 24 * time.Hour
)

// Service 认证服务
type Service struct {
	dataDir string
}

// NewService 创建认证服务
func NewService(dataDir string) *Service {
	return &Service{dataDir: dataDir}
}

// IsFirstRun 检查是否首次运行（未设置密码）
func (s *Service) IsFirstRun() bool {
	_, err := os.Stat(filepath.Join(s.dataDir, passwordFile))
	return os.IsNotExist(err)
}

// SetupPassword 设置初始密码
func (s *Service) SetupPassword(password string) error {
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return fmt.Errorf("hash password: %w", err)
	}
	return s.writeSecureFile(filepath.Join(s.dataDir, passwordFile), hash)
}

// writeSecureFile 写入文件并确保权限为 0600
func (s *Service) writeSecureFile(path string, data []byte) error {
	if err := os.WriteFile(path, data, 0600); err != nil {
		return err
	}
	return os.Chmod(path, 0600)
}

// VerifyPassword 验证密码
func (s *Service) VerifyPassword(password string) bool {
	hash, err := os.ReadFile(filepath.Join(s.dataDir, passwordFile))
	if err != nil {
		return false
	}
	return bcrypt.CompareHashAndPassword(hash, []byte(password)) == nil
}

// ChangePassword 修改密码
func (s *Service) ChangePassword(oldPassword, newPassword string) error {
	if !s.VerifyPassword(oldPassword) {
		return fmt.Errorf("old password incorrect")
	}
	return s.SetupPassword(newPassword)
}

// GenerateToken 生成 JWT Token
func (s *Service) GenerateToken() (string, error) {
	key, err := s.getJWTKey()
	if err != nil {
		return "", err
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"sub": "admin",
		"iat": time.Now().Unix(),
		"exp": time.Now().Add(jwtExpire).Unix(),
	})
	return token.SignedString(key)
}

// ValidateToken 验证 JWT Token
func (s *Service) ValidateToken(tokenString string) (*jwt.Token, error) {
	key, err := s.getJWTKey()
	if err != nil {
		return nil, err
	}

	return jwt.Parse(tokenString, func(token *jwt.Token) (interface{}, error) {
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
		}
		return key, nil
	})
}

// getJWTKey 获取或生成 JWT 密钥
func (s *Service) getJWTKey() ([]byte, error) {
	keyPath := filepath.Join(s.dataDir, jwtKeyFile)

	// 尝试读取现有密钥
	if key, err := os.ReadFile(keyPath); err == nil {
		return key, nil
	}

	// 生成新密钥
	key := make([]byte, 32)
	if _, err := rand.Read(key); err != nil {
		return nil, fmt.Errorf("generate jwt key: %w", err)
	}

	if err := s.writeSecureFile(keyPath, key); err != nil {
		return nil, fmt.Errorf("write jwt key: %w", err)
	}
	return key, nil
}
