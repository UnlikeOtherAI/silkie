package store

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"sort"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/unlikeotherai/silkie/internal/config"
)

type DB struct {
	*pgxpool.Pool
}

func NewDB(ctx context.Context, cfg config.Config) (*DB, error) {
	if cfg.DatabaseURL == "" {
		return nil, fmt.Errorf("database url is required")
	}

	pool, err := pgxpool.New(ctx, cfg.DatabaseURL)
	if err != nil {
		return nil, fmt.Errorf("open postgres pool: %w", err)
	}

	if err := runMigrations(ctx, pool); err != nil {
		pool.Close()
		return nil, err
	}

	return &DB{Pool: pool}, nil
}

func (db *DB) Close() {
	if db == nil || db.Pool == nil {
		return
	}

	db.Pool.Close()
}

func runMigrations(ctx context.Context, pool *pgxpool.Pool) error {
	entries, err := os.ReadDir(migrationsPath())
	if err != nil {
		return fmt.Errorf("read migrations directory: %w", err)
	}

	files := make([]string, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() || filepath.Ext(entry.Name()) != ".sql" {
			continue
		}

		files = append(files, entry.Name())
	}

	sort.Strings(files)

	for _, name := range files {
		path := filepath.Join(migrationsPath(), name)
		contents, err := os.ReadFile(path)
		if err != nil {
			return fmt.Errorf("read migration %s: %w", name, err)
		}

		if _, err := pool.Exec(ctx, string(contents)); err != nil {
			return fmt.Errorf("run migration %s: %w", name, err)
		}
	}

	return nil
}

func migrationsPath() string {
	_, filename, _, ok := runtime.Caller(0)
	if !ok {
		return "migrations"
	}

	return filepath.Join(filepath.Dir(filename), "..", "..", "migrations")
}
