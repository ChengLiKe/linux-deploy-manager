package repository

import (
	"gorm.io/gorm"

	"github.com/linux-deploy-manager/internal/model"
)

// ServerNodeRepository 服务器节点仓库接口
type ServerNodeRepository interface {
	Create(node *model.ServerNode) error
	Get(id uint) (*model.ServerNode, error)
	GetByName(name string) (*model.ServerNode, error)
	List() ([]model.ServerNode, error)
	Update(node *model.ServerNode) error
	Delete(id uint) error
	CountTemplates(id uint) (int64, error)
}

type serverNodeRepo struct {
	db *gorm.DB
}

func (r *serverNodeRepo) Create(node *model.ServerNode) error {
	return r.db.Create(node).Error
}

func (r *serverNodeRepo) Get(id uint) (*model.ServerNode, error) {
	var node model.ServerNode
	if err := r.db.Preload("ServerKey").First(&node, id).Error; err != nil {
		return nil, err
	}
	return &node, nil
}

func (r *serverNodeRepo) GetByName(name string) (*model.ServerNode, error) {
	var node model.ServerNode
	if err := r.db.Where("name = ?", name).First(&node).Error; err != nil {
		return nil, err
	}
	return &node, nil
}

func (r *serverNodeRepo) List() ([]model.ServerNode, error) {
	var nodes []model.ServerNode
	if err := r.db.Preload("ServerKey").Order("created_at DESC").Find(&nodes).Error; err != nil {
		return nil, err
	}
	return nodes, nil
}

func (r *serverNodeRepo) Update(node *model.ServerNode) error {
	return r.db.Save(node).Error
}

func (r *serverNodeRepo) Delete(id uint) error {
	return r.db.Delete(&model.ServerNode{}, id).Error
}

func (r *serverNodeRepo) CountTemplates(id uint) (int64, error) {
	var count int64
	err := r.db.Model(&model.Template{}).Where("server_node_id = ?", id).Count(&count).Error
	return count, err
}
