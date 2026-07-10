package repository

import (
	"gorm.io/gorm"

	"github.com/linux-deploy-manager/internal/model"
)

// Repositories 聚合所有仓库
type Repositories struct {
	Key        KeyRepository
	ServerNode ServerNodeRepository
	Project    ProjectRepository
	Task       TaskRepository
	Setting    SettingRepository
	ServerURL  ServerURLRepository
	Deployment DeploymentRepository
}

// New 创建所有仓库实例
func New(db *gorm.DB) *Repositories {
	return &Repositories{
		Key:        &keyRepo{db: db},
		ServerNode: &serverNodeRepo{db: db},
		Project:    &projectRepo{db: db},
		Task:       &taskRepo{db: db},
		Setting:    &settingRepo{db: db},
		ServerURL:  &serverURLRepo{db: db},
		Deployment: &deploymentRepo{db: db},
	}
}

// KeyRepository SSH 密钥仓库接口
type KeyRepository interface {
	Create(key *model.SSHKey) error
	Get(id uint) (*model.SSHKey, error)
	GetByName(name string) (*model.SSHKey, error)
	List() ([]model.SSHKey, error)
	Delete(id uint) error
	CountUsage(id uint) (int64, error)
	UpsertSystemKey(key *model.SSHKey) error
	DeleteSystemKeysNotIn(names []string) error
}

type keyRepo struct {
	db *gorm.DB
}

func (r *keyRepo) Create(key *model.SSHKey) error {
	return r.db.Create(key).Error
}

func (r *keyRepo) Get(id uint) (*model.SSHKey, error) {
	var key model.SSHKey
	if err := r.db.First(&key, id).Error; err != nil {
		return nil, err
	}
	return &key, nil
}

func (r *keyRepo) GetByName(name string) (*model.SSHKey, error) {
	var key model.SSHKey
	if err := r.db.Where("name = ?", name).First(&key).Error; err != nil {
		return nil, err
	}
	return &key, nil
}

func (r *keyRepo) List() ([]model.SSHKey, error) {
	var keys []model.SSHKey
	if err := r.db.Order("source DESC, name ASC").Find(&keys).Error; err != nil {
		return nil, err
	}
	return keys, nil
}

func (r *keyRepo) Delete(id uint) error {
	return r.db.Delete(&model.SSHKey{}, id).Error
}

func (r *keyRepo) CountUsage(id uint) (int64, error) {
	var count int64
	err := r.db.Model(&model.Project{}).Where("ssh_key_id = ?", id).Count(&count).Error
	return count, err
}

// UpsertSystemKey 按名称插入或更新系统密钥
func (r *keyRepo) UpsertSystemKey(key *model.SSHKey) error {
	var existing model.SSHKey
	err := r.db.Where("name = ? AND source = ?", key.Name, key.Source).First(&existing).Error
	if err != nil {
		if err == gorm.ErrRecordNotFound {
			return r.db.Create(key).Error
		}
		return err
	}
	// 已存在则更新公钥与路径
	existing.PublicKey = key.PublicKey
	existing.PrivatePath = key.PrivatePath
	existing.Algorithm = key.Algorithm
	return r.db.Save(&existing).Error
}

// DeleteSystemKeysNotIn 删除不在给定名称列表中的系统密钥
func (r *keyRepo) DeleteSystemKeysNotIn(names []string) error {
	if len(names) == 0 {
		return r.db.Where("source = ?", "system").Delete(&model.SSHKey{}).Error
	}
	return r.db.Where("source = ? AND name NOT IN ?", "system", names).Delete(&model.SSHKey{}).Error
}

// ProjectRepository 项目仓库接口
type ProjectRepository interface {
	Create(p *model.Project) error
	Get(id uint) (*model.Project, error)
	List(page, pageSize int, status string) ([]model.Project, int64, error)
	Update(p *model.Project) error
	Delete(id uint) error
}

type projectRepo struct {
	db *gorm.DB
}

func (r *projectRepo) Create(p *model.Project) error {
	return r.db.Create(p).Error
}

func (r *projectRepo) Get(id uint) (*model.Project, error) {
	var p model.Project
	if err := r.db.First(&p, id).Error; err != nil {
		return nil, err
	}
	return &p, nil
}

func (r *projectRepo) List(page, pageSize int, status string) ([]model.Project, int64, error) {
	var projects []model.Project
	var total int64

	query := r.db.Model(&model.Project{})
	if status != "" {
		query = query.Where("status = ?", status)
	}

	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	if err := query.Offset((page - 1) * pageSize).Limit(pageSize).Find(&projects).Error; err != nil {
		return nil, 0, err
	}
	return projects, total, nil
}

func (r *projectRepo) Update(p *model.Project) error {
	return r.db.Save(p).Error
}

func (r *projectRepo) Delete(id uint) error {
	return r.db.Delete(&model.Project{}, id).Error
}

// TaskRepository 部署任务仓库接口
type TaskRepository interface {
	Create(task *model.DeployTask) error
	Get(id uint) (*model.DeployTask, error)
	List(projectID uint, status string, page, pageSize int) ([]model.DeployTask, int64, error)
	GetLatestByProject(projectID uint, status string) (*model.DeployTask, error)
	Update(task *model.DeployTask) error
}

type taskRepo struct {
	db *gorm.DB
}

func (r *taskRepo) Create(task *model.DeployTask) error {
	return r.db.Create(task).Error
}

func (r *taskRepo) Get(id uint) (*model.DeployTask, error) {
	var task model.DeployTask
	if err := r.db.First(&task, id).Error; err != nil {
		return nil, err
	}
	return &task, nil
}

func (r *taskRepo) List(projectID uint, status string, page, pageSize int) ([]model.DeployTask, int64, error) {
	var tasks []model.DeployTask
	var total int64

	query := r.db.Model(&model.DeployTask{})
	if projectID > 0 {
		query = query.Where("project_id = ?", projectID)
	}
	if status != "" {
		query = query.Where("status = ?", status)
	}

	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	if err := query.Order("created_at DESC").Offset((page - 1) * pageSize).Limit(pageSize).Find(&tasks).Error; err != nil {
		return nil, 0, err
	}
	return tasks, total, nil
}

func (r *taskRepo) GetLatestByProject(projectID uint, status string) (*model.DeployTask, error) {
	var task model.DeployTask
	query := r.db.Where("project_id = ?", projectID)
	if status != "" {
		query = query.Where("status = ?", status)
	}
	if err := query.Order("created_at DESC").First(&task).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil, nil
		}
		return nil, err
	}
	return &task, nil
}

func (r *taskRepo) Update(task *model.DeployTask) error {
	return r.db.Save(task).Error
}

// SettingRepository 设置仓库接口
type SettingRepository interface {
	Get(key string) (string, error)
	Set(key, value string) error
}

type settingRepo struct {
	db *gorm.DB
}

func (r *settingRepo) Get(key string) (string, error) {
	var s model.Setting
	if err := r.db.Where("`key` = ?", key).First(&s).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			return "", nil
		}
		return "", err
	}
	return s.Value, nil
}

func (r *settingRepo) Set(key, value string) error {
	var s model.Setting
	err := r.db.Where("`key` = ?", key).First(&s).Error
	if err != nil {
		if err == gorm.ErrRecordNotFound {
			return r.db.Create(&model.Setting{Key: key, Value: value}).Error
		}
		return err
	}
	s.Value = value
	return r.db.Save(&s).Error
}

// ── Deployment ──────────────────────────────────

// DeploymentRepository 部署配置仓库接口
type DeploymentRepository interface {
	Create(d *model.Deployment) error
	Get(id uint) (*model.Deployment, error)
	List(projectID uint, page, pageSize int) ([]model.Deployment, int64, error)
	Update(d *model.Deployment) error
	Delete(id uint) error
	CountByProject(projectID uint) (int64, error)
}

type deploymentRepo struct {
	db *gorm.DB
}

func (r *deploymentRepo) Create(d *model.Deployment) error {
	return r.db.Create(d).Error
}

func (r *deploymentRepo) Get(id uint) (*model.Deployment, error) {
	var d model.Deployment
	if err := r.db.Preload("Project").Preload("ServerNode").First(&d, id).Error; err != nil {
		return nil, err
	}
	return &d, nil
}

func (r *deploymentRepo) List(projectID uint, page, pageSize int) ([]model.Deployment, int64, error) {
	var deployments []model.Deployment
	var total int64

	query := r.db.Model(&model.Deployment{})
	if projectID > 0 {
		query = query.Where("project_id = ?", projectID)
	}

	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	if err := query.Preload("Project").Preload("ServerNode").Order("created_at DESC").Offset((page - 1) * pageSize).Limit(pageSize).Find(&deployments).Error; err != nil {
		return nil, 0, err
	}
	return deployments, total, nil
}

func (r *deploymentRepo) Update(d *model.Deployment) error {
	return r.db.Save(d).Error
}

func (r *deploymentRepo) Delete(id uint) error {
	return r.db.Delete(&model.Deployment{}, id).Error
}

func (r *deploymentRepo) CountByProject(projectID uint) (int64, error) {
	var count int64
	err := r.db.Model(&model.Deployment{}).Where("project_id = ?", projectID).Count(&count).Error
	return count, err
}

// ServerURLRepository 服务器网址仓库接口
type ServerURLRepository interface {
	List(nodeID uint) ([]model.ServerURL, error)
	Get(id uint) (*model.ServerURL, error)
	Create(url *model.ServerURL) error
	Update(url *model.ServerURL) error
	Delete(id uint) error
	ListGroups(nodeID uint) ([]string, error)
}

type serverURLRepo struct {
	db *gorm.DB
}

func (r *serverURLRepo) List(nodeID uint) ([]model.ServerURL, error) {
	var urls []model.ServerURL
	err := r.db.Where("node_id = ?", nodeID).Order("sort_order ASC, id ASC").Find(&urls).Error
	return urls, err
}

func (r *serverURLRepo) Get(id uint) (*model.ServerURL, error) {
	var u model.ServerURL
	err := r.db.First(&u, id).Error
	if err != nil {
		return nil, err
	}
	return &u, nil
}

func (r *serverURLRepo) Create(u *model.ServerURL) error {
	return r.db.Create(u).Error
}

func (r *serverURLRepo) Update(u *model.ServerURL) error {
	return r.db.Save(u).Error
}

func (r *serverURLRepo) Delete(id uint) error {
	return r.db.Delete(&model.ServerURL{}, id).Error
}

func (r *serverURLRepo) ListGroups(nodeID uint) ([]string, error) {
	var groups []string
	err := r.db.Model(&model.ServerURL{}).Where("node_id = ?", nodeID).
		Select("DISTINCT `group`").Order("`group` ASC").Pluck("`group`", &groups).Error
	return groups, err
}
