package ratelimit

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	redis "github.com/redis/go-redis/v9"
)

type Decision struct {
	Allowed    bool
	Count      int64
	RetryAfter time.Duration
}

type Limiter interface {
	Allow(ctx context.Context, key string, limit int64, window time.Duration) (Decision, error)
}

type RedisLimiter struct {
	client redis.Cmdable
	prefix string
}

var allowScript = redis.NewScript(`
local current = redis.call('INCR', KEYS[1])
if current == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
return {current, redis.call('PTTL', KEYS[1])}
`)

var peekScript = redis.NewScript(`
local current = redis.call('GET', KEYS[1])
if not current then
  return {0, 0}
end
return {tonumber(current), redis.call('PTTL', KEYS[1])}
`)

func NewRedisLimiter(client redis.Cmdable) *RedisLimiter {
	if client == nil {
		return nil
	}
	return &RedisLimiter{client: client, prefix: "ratelimit"}
}

func (l *RedisLimiter) Allow(ctx context.Context, key string, limit int64, window time.Duration) (Decision, error) {
	if l == nil || l.client == nil {
		return Decision{}, errors.New("rate limiter unavailable")
	}
	if strings.TrimSpace(key) == "" {
		return Decision{}, errors.New("rate limit key is required")
	}
	if limit <= 0 {
		return Decision{}, errors.New("rate limit must be positive")
	}
	if window <= 0 {
		return Decision{}, errors.New("rate limit window must be positive")
	}

	decision, err := l.bump(ctx, key, window)
	if err != nil {
		return Decision{}, err
	}
	decision.Allowed = decision.Count <= limit
	return decision, nil
}

func (l *RedisLimiter) Hit(ctx context.Context, key string, window time.Duration) (Decision, error) {
	if l == nil || l.client == nil {
		return Decision{}, errors.New("rate limiter unavailable")
	}
	if strings.TrimSpace(key) == "" {
		return Decision{}, errors.New("rate limit key is required")
	}
	if window <= 0 {
		return Decision{}, errors.New("rate limit window must be positive")
	}

	return l.bump(ctx, key, window)
}

func (l *RedisLimiter) Peek(ctx context.Context, key string) (Decision, error) {
	if l == nil || l.client == nil {
		return Decision{}, errors.New("rate limiter unavailable")
	}
	if strings.TrimSpace(key) == "" {
		return Decision{}, errors.New("rate limit key is required")
	}

	result, err := peekScript.Run(ctx, l.client, []string{l.redisKey(key)}).Result()
	if err != nil {
		return Decision{}, fmt.Errorf("peek rate limit: %w", err)
	}
	return parseDecision(result)
}

func (l *RedisLimiter) bump(ctx context.Context, key string, window time.Duration) (Decision, error) {
	result, err := allowScript.Run(ctx, l.client, []string{l.redisKey(key)}, window.Milliseconds()).Result()
	if err != nil {
		return Decision{}, fmt.Errorf("increment rate limit: %w", err)
	}
	return parseDecision(result)
}

func Key(parts ...string) string {
	clean := make([]string, 0, len(parts))
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		clean = append(clean, part)
	}
	return strings.Join(clean, ":")
}

func HashToken(value string) string {
	sum := sha256.Sum256([]byte(strings.TrimSpace(value)))
	return hex.EncodeToString(sum[:])
}

func (l *RedisLimiter) redisKey(key string) string {
	if l.prefix == "" {
		return key
	}
	return l.prefix + ":" + key
}

func parseDecision(result any) (Decision, error) {
	values, ok := result.([]any)
	if !ok || len(values) != 2 {
		return Decision{}, fmt.Errorf("unexpected rate limit result: %T", result)
	}

	count, err := toInt64(values[0])
	if err != nil {
		return Decision{}, err
	}
	ttlMillis, err := toInt64(values[1])
	if err != nil {
		return Decision{}, err
	}
	if ttlMillis < 0 {
		ttlMillis = 0
	}

	return Decision{
		Count:      count,
		RetryAfter: time.Duration(ttlMillis) * time.Millisecond,
	}, nil
}

func toInt64(value any) (int64, error) {
	switch v := value.(type) {
	case int64:
		return v, nil
	case int:
		return int64(v), nil
	case string:
		parsed, err := strconv.ParseInt(v, 10, 64)
		if err == nil {
			return parsed, nil
		}
	case float64:
		return int64(v), nil
	}
	return 0, fmt.Errorf("unexpected integer result type %T", value)
}
