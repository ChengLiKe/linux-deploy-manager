package ssh

import (
	"crypto/ed25519"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/pem"
	"fmt"
	"os"
	"path/filepath"

	"golang.org/x/crypto/ssh"
)

// Manager SSH 密钥管理器
type Manager struct {
	keysDir string
}

// NewManager 创建 SSH 管理器
func NewManager(keysDir string) *Manager {
	return &Manager{keysDir: keysDir}
}

// KeysDir 返回密钥存储目录
func (m *Manager) KeysDir() string {
	return m.keysDir
}

// GenerateKey 生成 SSH 密钥对
func (m *Manager) GenerateKey(name, algorithm string) (privatePath, publicKey string, err error) {
	keyDir := filepath.Join(m.keysDir, name)
	if err := os.MkdirAll(keyDir, 0700); err != nil {
		return "", "", fmt.Errorf("create key dir: %w", err)
	}

	privPath := filepath.Join(keyDir, "private")
	pubPath := filepath.Join(keyDir, "public")

	var privKey interface{}
	var pub ssh.PublicKey

	switch algorithm {
	case "ed25519":
		_, privKey, err = ed25519.GenerateKey(rand.Reader)
		if err != nil {
			return "", "", fmt.Errorf("generate ed25519 key: %w", err)
		}
		// ed25519.PrivateKey 实现了 crypto.Signer，ssh.NewPublicKey 可以直接使用
		pub, err = ssh.NewPublicKey(privKey.(ed25519.PrivateKey).Public())
	case "rsa":
		rsaKey, genErr := rsa.GenerateKey(rand.Reader, 4096)
		if genErr != nil {
			return "", "", fmt.Errorf("generate rsa key: %w", genErr)
		}
		privKey = rsaKey
		pub, err = ssh.NewPublicKey(&rsaKey.PublicKey)
	default:
		return "", "", fmt.Errorf("unsupported algorithm: %s", algorithm)
	}
	if err != nil {
		return "", "", fmt.Errorf("generate public key: %w", err)
	}

	// 写入私钥
	privBytes, err := x509.MarshalPKCS8PrivateKey(privKey)
	if err != nil {
		return "", "", fmt.Errorf("marshal private key: %w", err)
	}
	privPEM := pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: privBytes})
	if err := os.WriteFile(privPath, privPEM, 0600); err != nil {
		return "", "", fmt.Errorf("write private key: %w", err)
	}

	// 写入公钥
	pubBytes := ssh.MarshalAuthorizedKey(pub)
	if err := os.WriteFile(pubPath, pubBytes, 0644); err != nil {
		return "", "", fmt.Errorf("write public key: %w", err)
	}

	return privPath, string(pubBytes), nil
}

// DeleteKey 删除密钥
func (m *Manager) DeleteKey(name string) error {
	return os.RemoveAll(filepath.Join(m.keysDir, name))
}

// GetPublicKey 读取公钥内容
func (m *Manager) GetPublicKey(name string) (string, error) {
	data, err := os.ReadFile(filepath.Join(m.keysDir, name, "public"))
	if err != nil {
		return "", err
	}
	return string(data), nil
}
