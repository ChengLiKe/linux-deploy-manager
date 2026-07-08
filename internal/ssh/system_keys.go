package ssh

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"golang.org/x/crypto/ssh"
)

// SystemKey 表示从 ~/.ssh/ 扫描到的系统密钥
type SystemKey struct {
	Name        string
	Algorithm   string
	PublicKey   string
	PrivatePath string
}

// wellKnownSystemKeyNames 常见系统 SSH 私钥文件名
var wellKnownSystemKeyNames = []string{
	"id_rsa",
	"id_ed25519",
	"id_ecdsa",
	"id_dsa",
}

// ScanSystemKeys 扫描当前用户 ~/.ssh/ 目录下的系统密钥
func ScanSystemKeys() ([]SystemKey, error) {
	homeDir, err := os.UserHomeDir()
	if err != nil {
		return nil, fmt.Errorf("get user home dir: %w", err)
	}

	sshDir := filepath.Join(homeDir, ".ssh")
	entries, err := os.ReadDir(sshDir)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, fmt.Errorf("read ssh dir: %w", err)
	}

	var keys []SystemKey
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		name := entry.Name()
		if !isWellKnownPrivateKey(name) {
			continue
		}

		privatePath := filepath.Join(sshDir, name)
		// 跳过软链接/特殊文件，只处理普通文件
		info, err := entry.Info()
		if err != nil || !info.Mode().IsRegular() {
			continue
		}

		pubPath := privatePath + ".pub"
		publicKey, algorithm, err := readPublicKey(privatePath, pubPath)
		if err != nil {
			// 无法读取公钥则跳过
			continue
		}

		keys = append(keys, SystemKey{
			Name:        name,
			Algorithm:   algorithm,
			PublicKey:   publicKey,
			PrivatePath: privatePath,
		})
	}

	return keys, nil
}

func isWellKnownPrivateKey(name string) bool {
	for _, known := range wellKnownSystemKeyNames {
		if name == known {
			return true
		}
	}
	return false
}

// readPublicKey 优先读取 .pub 文件，否则从私钥推导公钥
func readPublicKey(privatePath, pubPath string) (publicKey string, algorithm string, err error) {
	if data, err := os.ReadFile(pubPath); err == nil {
		pub, _, _, _, err := ssh.ParseAuthorizedKey(data)
		if err == nil {
			return string(data), strings.ToLower(pub.Type()), nil
		}
	}

	// 从私钥推导
	privData, err := os.ReadFile(privatePath)
	if err != nil {
		return "", "", fmt.Errorf("read private key: %w", err)
	}

	signer, err := ssh.ParsePrivateKey(privData)
	if err != nil {
		return "", "", fmt.Errorf("parse private key: %w", err)
	}

	pub := signer.PublicKey()
	pubBytes := ssh.MarshalAuthorizedKey(pub)
	return string(pubBytes), strings.ToLower(pub.Type()), nil
}
