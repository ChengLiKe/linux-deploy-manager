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
)

const (
	envKeyName = "LDM_ENCRYPTION_KEY"
	keyLen     = 32 // AES-256
)

// deriveKey 从环境变量获取或生成加密密钥
// 如果环境变量未设置，在首次调用时自动生成并存入内存
var masterKey []byte
var masterKeySet bool // 标记密钥已初始化，避免多次清零

// WipeKey 清空内存中的加密密钥，防止进程 core dump 泄露
// 通常放在进程退出前或密钥轮换时调用
func WipeKey() {
	if masterKeySet {
		clear(masterKey)
		masterKey = nil
		masterKeySet = false
	}
}

func getMasterKey() ([]byte, error) {
	if masterKeySet {
		return masterKey, nil
	}

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

	// 自动生成密钥（仅内存，重启后失效）
	key := make([]byte, keyLen)
	if _, err := rand.Read(key); err != nil {
		return nil, fmt.Errorf("generate key: %w", err)
	}
	masterKey = key
	masterKeySet = true
	return masterKey, nil
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
