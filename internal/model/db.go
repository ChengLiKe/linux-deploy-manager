package model

import (
	"fmt"
	"log/slog"
	"time"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// InitDB 初始化数据库连接
func InitDB(dbPath string) (*gorm.DB, error) {
	db, err := gorm.Open(sqlite.Open(dbPath), &gorm.Config{
		Logger: logger.New(
			slog.NewLogLogger(slog.Default().Handler(), slog.LevelInfo),
			logger.Config{
				SlowThreshold:             200 * time.Millisecond,
				LogLevel:                  logger.Warn,
				IgnoreRecordNotFoundError: true,
				Colorful:                  false,
			},
		),
	})
	if err != nil {
		return nil, fmt.Errorf("open sqlite: %w", err)
	}

	// 启用 WAL 模式提升并发性能
	sqlDB, err := db.DB()
	if err != nil {
		return nil, fmt.Errorf("get sql db: %w", err)
	}
	if _, err := sqlDB.Exec("PRAGMA journal_mode=WAL"); err != nil {
		return nil, fmt.Errorf("enable wal: %w", err)
	}
	if _, err := sqlDB.Exec("PRAGMA busy_timeout=5000"); err != nil {
		return nil, fmt.Errorf("set busy timeout: %w", err)
	}

	// 自动迁移
	if err := db.AutoMigrate(&SSHKey{}, &ServerNode{}, &Template{}, &DeployTask{}, &TemplateHistory{}, &Setting{}); err != nil {
		return nil, fmt.Errorf("auto migrate: %w", err)
	}

	slog.Info("database initialized", "path", dbPath)
	return db, nil
}
