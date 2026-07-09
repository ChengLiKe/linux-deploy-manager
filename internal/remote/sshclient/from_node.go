package sshclient

import (
	"context"
	"fmt"
	"os"

	"github.com/linux-deploy-manager/internal/crypto"
	"github.com/linux-deploy-manager/internal/model"
	"github.com/linux-deploy-manager/internal/repository"
)

// NewClientFromNode 根据节点信息创建并连接 SSH 客户端
// 自动处理密码解密（兼容加密后的新数据与明文的旧数据）
// 所有调用方都使用此函数，无需自行处理密码
func NewClientFromNode(node *model.ServerNode, keyRepo repository.KeyRepository) (*Client, error) {
	ctx := context.Background()
	var client *Client
	var err error

	switch node.AuthType {
	case "key":
		if node.ServerKeyID == nil {
			return nil, fmt.Errorf("server node %s: key auth but no server_key_id", node.Name)
		}
		key, err := keyRepo.Get(*node.ServerKeyID)
		if err != nil {
			return nil, fmt.Errorf("get key: %w", err)
		}
		keyData, err := os.ReadFile(key.PrivatePath)
		if err != nil {
			return nil, fmt.Errorf("read private key: %w", err)
		}
		client, err = NewClientWithKey(node.Host, node.Port, node.User, keyData)
		if err != nil {
			return nil, err
		}
	case "password":
		password := node.Password
		// 先尝试解密（新数据），失败则使用原值（旧明文数据）
		if password != "" {
			decrypted, dErr := crypto.Decrypt(password)
			if dErr == nil {
				password = string(decrypted)
			}
		}
		client, err = NewClientWithPassword(node.Host, node.Port, node.User, password)
		if err != nil {
			return nil, err
		}
	default:
		return nil, fmt.Errorf("unsupported auth type: %s", node.AuthType)
	}

	if err := client.Connect(ctx); err != nil {
		client.Close()
		return nil, err
	}
	return client, nil
}
