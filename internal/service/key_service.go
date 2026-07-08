package service

import (
	"fmt"
	"os"
	"path/filepath"

	"github.com/linux-deploy-manager/internal/model"
	"github.com/linux-deploy-manager/internal/repository"
	"github.com/linux-deploy-manager/internal/ssh"
)

// KeyService SSH 密钥服务
type KeyService struct {
	repo       repository.KeyRepository
	sshManager *ssh.Manager
}

// NewKeyService 创建密钥服务
func NewKeyService(repo repository.KeyRepository, keysDir string) *KeyService {
	return &KeyService{repo: repo, sshManager: ssh.NewManager(keysDir)}
}

// CreateKeyRequest 创建密钥请求
type CreateKeyRequest struct {
	Name      string `json:"name" binding:"required,min=1,max=50"`
	Algorithm string `json:"algorithm" binding:"omitempty,oneof=rsa ed25519"`
	KeyType   string `json:"key_type" binding:"omitempty,oneof=git server"`
}

// Create 创建密钥
func (s *KeyService) Create(req *CreateKeyRequest) (*model.SSHKey, error) {
	if req.Algorithm == "" {
		req.Algorithm = "ed25519"
	}
	if req.KeyType == "" {
		req.KeyType = "git"
	}

	// 检查名称是否已存在（包括系统密钥）
	if _, err := s.repo.GetByName(req.Name); err == nil {
		return nil, fmt.Errorf("密钥名称 %s 已存在", req.Name)
	}

	// 生成密钥对
	privatePath, publicKey, err := s.sshManager.GenerateKey(req.Name, req.Algorithm)
	if err != nil {
		return nil, fmt.Errorf("generate key: %w", err)
	}

	key := &model.SSHKey{
		Name:        req.Name,
		Algorithm:   req.Algorithm,
		PublicKey:   publicKey,
		PrivatePath: privatePath,
		Source:      "managed",
		KeyType:     req.KeyType,
	}
	if err := s.repo.Create(key); err != nil {
		return nil, fmt.Errorf("create key in db: %w", err)
	}
	return key, nil
}

// ImportKeyRequest 导入密钥请求
type ImportKeyRequest struct {
	Name       string `json:"name" binding:"required,min=1,max=50"`
	KeyType    string `json:"key_type" binding:"omitempty,oneof=git server"`
	PublicKey  string `json:"public_key" binding:"required"`
	PrivateKey string `json:"private_key" binding:"required"`
	Algorithm  string `json:"algorithm" binding:"omitempty,oneof=rsa ed25519 dsa ecdsa"`
}

// ImportKey 导入已有的密钥对
func (s *KeyService) ImportKey(req *ImportKeyRequest) (*model.SSHKey, error) {
	if req.KeyType == "" {
		req.KeyType = "git"
	}
	if req.Algorithm == "" {
		req.Algorithm = "ed25519"
	}

	// 检查名称是否已存在
	if _, err := s.repo.GetByName(req.Name); err == nil {
		return nil, fmt.Errorf("密钥名称 %s 已存在", req.Name)
	}

	// 在密钥存储目录下创建子目录
	keyDir := filepath.Join(s.sshManager.KeysDir(), req.Name)
	if err := os.MkdirAll(keyDir, 0700); err != nil {
		return nil, fmt.Errorf("create key directory: %w", err)
	}

	// 写入私钥文件
	privatePath := filepath.Join(keyDir, "private")
	if err := os.WriteFile(privatePath, []byte(req.PrivateKey), 0600); err != nil {
		return nil, fmt.Errorf("write private key: %w", err)
	}

	// 写入公钥文件
	publicPath := filepath.Join(keyDir, "public")
	if err := os.WriteFile(publicPath, []byte(req.PublicKey), 0644); err != nil {
		os.RemoveAll(keyDir) // 回滚
		return nil, fmt.Errorf("write public key: %w", err)
	}

	key := &model.SSHKey{
		Name:        req.Name,
		Algorithm:   req.Algorithm,
		PublicKey:   req.PublicKey,
		PrivatePath: privatePath,
		Source:      "managed",
		KeyType:     req.KeyType,
	}
	if err := s.repo.Create(key); err != nil {
		os.RemoveAll(keyDir) // 回滚
		return nil, fmt.Errorf("create key in db: %w", err)
	}
	return key, nil
}

// Get 获取密钥
func (s *KeyService) Get(id uint) (*model.SSHKey, error) {
	return s.repo.Get(id)
}

// List 列出所有密钥
func (s *KeyService) List() ([]model.SSHKey, error) {
	return s.repo.List()
}

// Delete 删除密钥
func (s *KeyService) Delete(id uint) error {
	key, err := s.repo.Get(id)
	if err != nil {
		return err
	}

	if key.Source == "system" {
		return fmt.Errorf("系统密钥 %s 不允许删除", key.Name)
	}

	// 检查是否被模板引用
	count, err := s.repo.CountUsage(id)
	if err != nil {
		return fmt.Errorf("check usage: %w", err)
	}
	if count > 0 {
		return fmt.Errorf("该密钥正被 %d 个模板使用，请先解除关联", count)
	}

	// 删除文件系统密钥
	s.sshManager.DeleteKey(key.Name)

	return s.repo.Delete(id)
}

// SyncSystemKeys 扫描并同步当前用户的 ~/.ssh/ 系统密钥到数据库
func (s *KeyService) SyncSystemKeys() error {
	systemKeys, err := ssh.ScanSystemKeys()
	if err != nil {
		return fmt.Errorf("scan system keys: %w", err)
	}

	names := make([]string, 0, len(systemKeys))
	for _, sk := range systemKeys {
		names = append(names, sk.Name)
		key := &model.SSHKey{
			Name:        sk.Name,
			Algorithm:   sk.Algorithm,
			PublicKey:   sk.PublicKey,
			PrivatePath: sk.PrivatePath,
			Source:      "system",
			KeyType:     "git",
		}
		if err := s.repo.UpsertSystemKey(key); err != nil {
			return fmt.Errorf("upsert system key %s: %w", sk.Name, err)
		}
	}

	// 清理已不存在的系统密钥
	return s.repo.DeleteSystemKeysNotIn(names)
}
