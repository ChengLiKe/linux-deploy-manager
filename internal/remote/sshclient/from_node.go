package sshclient

import (
	"context"
	"fmt"
	"os"

	"github.com/linux-deploy-manager/internal/model"
	"github.com/linux-deploy-manager/internal/repository"
)

// NewClientFromNode 根据节点信息创建并连接 SSH 客户端
// password 是已解密/原始的密码，传入前需自行解密
// 这是 server_node_service, task_service, connectivity 三处 createSSHClient 的公共函数
func NewClientFromNode(node *model.ServerNode, password string, keyRepo repository.KeyRepository) (*Client, error) {
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
