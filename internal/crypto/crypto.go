package crypto

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
)

const (
	envKeyName = "LDM_ENCRYPTION_KEY"
	keyLen     = 32 // AES-256
)

// deriveKey 从环境变量获取或生成加密密钥
// 如果环境变量未设置，在首次调用时自动生成并存入内存
var masterKey []byte
var masterKeySet bool // 标记密钥已初始化，避免多次清零

// WipeKey 清空内存中的加密密钥，并删除持久化文件
//
// ⚠️ 安全限制：仅应在以下场景调用：
//  1. 进程正常退出前（确保敏感密钥不驻留内存/磁盘）
//  2. 确认新密钥已生成且所有活跃加密操作已完成
//
// 调用后所有已加密的数据将永久无法解密（密钥不可恢复），
// 因此禁止在运行中的密钥轮换、重新初始化等操作中途调用。
func WipeKey() {
	if masterKeySet {
		clear(masterKey)
		masterKey = nil
		masterKeySet = false
	}
	// 删除持久化密钥文件
	if fp, err := keyFilePath(); err == nil {
		os.Remove(fp) // 忽略错误，文件可能不存在
	}
}

func getMasterKey() ([]byte, error) {
	if masterKeySet {
		return masterKey, nil
	}

	// 1. 环境变量优先（用户显式设置）
	keyHex := os.Getenv(envKeyName)
	if keyHex != "" {
		key, err := hex.DecodeString(keyHex)
		if err != nil {
			return nil, fmt.Errorf("LDM_ENCRYPTION_KEY is not valid hex: %w", err)
		}
		if len(key) != keyLen {
			return nil, fmt.Errorf("LDM_ENCRYPTION_KEY must be %d bytes (got %d)", keyLen, len(key))
		}
		masterKey = key
		masterKeySet = true
		return masterKey, nil
	}

	// 2. 持久化的密钥文件（重启后保持一致性）
	if stored := loadKeyFromFile(); stored != nil {
		masterKey = stored
		masterKeySet = true
		return masterKey, nil
	}

	// 3. 自动生成密钥并持久化到文件
	key := make([]byte, keyLen)
	if _, err := rand.Read(key); err != nil {
		return nil, fmt.Errorf("generate key: %w", err)
	}
	masterKey = key
	masterKeySet = true

	if saveErr := saveKeyToFile(key); saveErr != nil {
		return nil, fmt.Errorf("key generated but persist failed: %w", saveErr)
	}

	return masterKey, nil
}

// keyFilePath 返回加密密钥持久化文件路径
func keyFilePath() (string, error) {
	configDir, err := os.UserConfigDir()
	if err != nil {
		return "", fmt.Errorf("get config dir: %w", err)
	}
	appDir := filepath.Join(configDir, "linux-deploy-manager")
	if err := os.MkdirAll(appDir, 0700); err != nil {
		return "", fmt.Errorf("create config dir: %w", err)
	}
	return filepath.Join(appDir, ".encryption_key"), nil
}

// saveKeyToFile 将密钥写入文件
func saveKeyToFile(key []byte) error {
	fp, err := keyFilePath()
	if err != nil {
		return err
	}
	// 检查是否已存在有效密钥文件
	if existing, readErr := os.ReadFile(fp); readErr == nil && len(existing) == keyLen {
		return nil // 已存在，不做覆盖
	}
	return os.WriteFile(fp, key, 0600)
}

// loadKeyFromFile 从文件加载持久化的密钥
func loadKeyFromFile() []byte {
	fp, err := keyFilePath()
	if err != nil {
		return nil
	}
	data, err := os.ReadFile(fp)
	if err != nil {
		return nil
	}
	if len(data) != keyLen {
		return nil
	}
	return data
}

// Encrypt 使用 AES-256-GCM 加密明文
// 返回 hex( nonce || ciphertext )
func Encrypt(plaintext []byte) (string, error) {
	key, err := getMasterKey()
	if err != nil {
		return "", err
	}

	block, err := aes.NewCipher(key)
	if err != nil {
		return "", fmt.Errorf("new cipher: %w", err)
	}

	aesGCM, err := cipher.NewGCM(block)
	if err != nil {
		return "", fmt.Errorf("new GCM: %w", err)
	}

	nonce := make([]byte, aesGCM.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", fmt.Errorf("nonce: %w", err)
	}

	ciphertext := aesGCM.Seal(nonce, nonce, plaintext, nil)
	return hex.EncodeToString(ciphertext), nil
}

// Decrypt 解密 AES-256-GCM 密文
// 输入: hex( nonce || ciphertext )
func Decrypt(encoded string) ([]byte, error) {
	key, err := getMasterKey()
	if err != nil {
		return nil, err
	}

	ciphertext, err := hex.DecodeString(encoded)
	if err != nil {
		return nil, fmt.Errorf("decode hex: %w", err)
	}

	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, fmt.Errorf("new cipher: %w", err)
	}

	aesGCM, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("new GCM: %w", err)
	}

	nonceSize := aesGCM.NonceSize()
	if len(ciphertext) < nonceSize {
		return nil, errors.New("ciphertext too short")
	}

	nonce, ciphertext := ciphertext[:nonceSize], ciphertext[nonceSize:]
	plaintext, err := aesGCM.Open(nil, nonce, ciphertext, nil)
	if err != nil {
		return nil, fmt.Errorf("decrypt: %w", err)
	}

	return plaintext, nil
}
