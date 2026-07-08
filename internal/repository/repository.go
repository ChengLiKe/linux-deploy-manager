package repository

import (
	"gorm.io/gorm"

	"github.com/linux-deploy-manager/internal/model"
)

// Repositories 聚合所有仓库
type Repositories struct {
	Key        KeyRepository
	ServerNode ServerNodeRepository
	Template   TemplateRepository
	Task       TaskRepository
	Setting    SettingRepository
}

// New 创建所有仓库实例
func New(db *gorm.DB) *Repositories {
	return &Repositories{
		Key:        &keyRepo{db: db},
		ServerNode: &serverNodeRepo{db: db},
		Template:   &templateRepo{db: db},
		Task:       &taskRepo{db: db},
		Setting:    &settingRepo{db: db},
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
	err := r.db.Model(&model.Template{}).Where("ssh_key_id = ?", id).Count(&count).Error
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

// TemplateRepository 模板仓库接口
type TemplateRepository interface {
	Create(t *model.Template) error
	Get(id uint) (*model.Template, error)
	List(page, pageSize int, status string) ([]model.Template, int64, error)
	Update(t *model.Template) error
	Delete(id uint) error
}

type templateRepo struct {
	db *gorm.DB
}

func (r *templateRepo) Create(t *model.Template) error {
	return r.db.Create(t).Error
}

func (r *templateRepo) Get(id uint) (*model.Template, error) {
	var t model.Template
	if err := r.db.First(&t, id).Error; err != nil {
		return nil, err
	}
	return &t, nil
}

func (r *templateRepo) List(page, pageSize int, status string) ([]model.Template, int64, error) {
	var templates []model.Template
	var total int64

	query := r.db.Model(&model.Template{})
	if status != "" {
		query = query.Where("status = ?", status)
	}

	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	if err := query.Offset((page - 1) * pageSize).Limit(pageSize).Find(&templates).Error; err != nil {
		return nil, 0, err
	}
	return templates, total, nil
}

func (r *templateRepo) Update(t *model.Template) error {
	return r.db.Save(t).Error
}

func (r *templateRepo) Delete(id uint) error {
	return r.db.Delete(&model.Template{}, id).Error
}

// TaskRepository 部署任务仓库接口
type TaskRepository interface {
	Create(task *model.DeployTask) error
	Get(id uint) (*model.DeployTask, error)
	List(templateID uint, status string, page, pageSize int) ([]model.DeployTask, int64, error)
	GetLatestByTemplate(templateID uint, status string) (*model.DeployTask, error)
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

func (r *taskRepo) List(templateID uint, status string, page, pageSize int) ([]model.DeployTask, int64, error) {
	var tasks []model.DeployTask
	var total int64

	query := r.db.Model(&model.DeployTask{})
	if templateID > 0 {
		query = query.Where("template_id = ?", templateID)
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

func (r *taskRepo) GetLatestByTemplate(templateID uint, status string) (*model.DeployTask, error) {
	var task model.DeployTask
	query := r.db.Where("template_id = ?", templateID)
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
