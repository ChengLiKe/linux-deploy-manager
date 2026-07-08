package service

import (
	"testing"

	"github.com/linux-deploy-manager/internal/model"
	"github.com/linux-deploy-manager/internal/repository"
	"github.com/stretchr/testify/assert"
)

// mockRepo 模拟 Repository 用于测试
type mockRepo struct {
	*repository.Repositories
	serverNodeRepo *mockServerNodeRepo
	projectRepo    *mockProjectRepo
	taskRepo       *mockTaskRepo
}

type mockServerNodeRepo struct {
	repository.ServerNodeRepository
	nodes map[uint]*model.ServerNode
}

func (m *mockServerNodeRepo) Get(id uint) (*model.ServerNode, error) {
	if n, ok := m.nodes[id]; ok {
		return n, nil
	}
	return nil, assert.AnError
}

func (m *mockServerNodeRepo) Create(node *model.ServerNode) error {
	m.nodes[node.ID] = node
	return nil
}

func (m *mockServerNodeRepo) Update(node *model.ServerNode) error {
	m.nodes[node.ID] = node
	return nil
}

type mockProjectRepo struct {
	repository.ProjectRepository
	projects map[uint]*model.Project
}

type mockTaskRepo struct {
	repository.TaskRepository
	tasks map[uint]*model.DeployTask
}

func TestCreateServerNode(t *testing.T) {
	svc := &ServerNodeService{
		repo:    &mockServerNodeRepo{nodes: make(map[uint]*model.ServerNode)},
		keyRepo: nil,
	}

	node, err := svc.Create(&CreateServerNodeRequest{
		Name:     "test-node",
		Host:     "192.168.1.1",
		Port:     22,
		User:     "root",
		AuthType: "key",
	})
	assert.NoError(t, err)
	assert.NotNil(t, node)
	assert.Equal(t, "test-node", node.Name)
	assert.Equal(t, "unknown", node.Status)
}

func TestCreateServerNodeWithDefaults(t *testing.T) {
	svc := &ServerNodeService{
		repo:    &mockServerNodeRepo{nodes: make(map[uint]*model.ServerNode)},
		keyRepo: nil,
	}

	node, err := svc.Create(&CreateServerNodeRequest{
		Name:     "default-node",
		Host:     "192.168.1.2",
		AuthType: "password",
		Password: "test-pass",
	})
	assert.NoError(t, err)
	assert.Equal(t, 22, node.Port)  // 默认端口
	assert.Equal(t, "root", node.User) // 默认用户
}
