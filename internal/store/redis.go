package store

import (
	"context"
	"fmt"

	redis "github.com/redis/go-redis/v9"
	"github.com/unlikeotherai/silkie/internal/config"
)

type Redis struct {
	*redis.Client
}

func NewRedis(ctx context.Context, cfg config.Config) (*Redis, error) {
	if cfg.RedisURL == "" {
		return nil, fmt.Errorf("redis url is required")
	}

	options, err := redis.ParseURL(cfg.RedisURL)
	if err != nil {
		return nil, fmt.Errorf("parse redis url: %w", err)
	}

	client := redis.NewClient(options)
	store := &Redis{Client: client}
	if err := store.Ping(ctx); err != nil {
		_ = store.Close()
		return nil, fmt.Errorf("ping redis: %w", err)
	}

	return store, nil
}

func (r *Redis) Ping(ctx context.Context) error {
	if r == nil || r.Client == nil {
		return fmt.Errorf("redis client is nil")
	}

	return r.Client.Ping(ctx).Err()
}

func (r *Redis) Close() error {
	if r == nil || r.Client == nil {
		return nil
	}

	return r.Client.Close()
}
