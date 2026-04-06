//nolint:testpackage // White-box tests cover package-private helpers and handlers.
package auth

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/unlikeotherai/selkie/internal/config"
	"github.com/unlikeotherai/selkie/internal/ratelimit"
	"go.uber.org/zap"
)

type fakeLimiter struct {
	decision ratelimit.Decision
	err      error
}

func (f fakeLimiter) Allow(_ context.Context, _ string, _ int64, _ time.Duration) (ratelimit.Decision, error) {
	return f.decision, f.err
}

func TestMobileRedirectURLIncludesHandoffCodeAndState(t *testing.T) {
	got, err := mobileRedirectURL("selkie://auth", "handoff-123", "state-abc")
	if err != nil {
		t.Fatalf("mobileRedirectURL: %v", err)
	}
	want := "selkie://auth?handoff_code=handoff-123&state=state-abc"
	if got != want {
		t.Fatalf("redirect url = %q, want %q", got, want)
	}
}

func TestMobileRedirectURLErrorsWithoutBaseURL(t *testing.T) {
	if _, err := mobileRedirectURL("", "handoff-123", ""); err == nil {
		t.Fatal("expected error for empty mobile redirect url")
	}
}

func TestServeMobileHandoffExchangeRateLimited(t *testing.T) {
	h := NewCallbackHandler(nil, config.Config{}, nil, zap.NewNop(), fakeLimiter{
		decision: ratelimit.Decision{Allowed: false, RetryAfter: 5 * time.Second},
	})

	req := httptest.NewRequest(http.MethodPost, "/api/v1/mobile/handoff/exchange", strings.NewReader(`{"handoff_code":"abc123"}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	h.ServeMobileHandoffExchange(rec, req)

	if rec.Code != http.StatusTooManyRequests {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusTooManyRequests)
	}
	if got := rec.Header().Get("Retry-After"); got != "5" {
		t.Fatalf("Retry-After = %q, want 5", got)
	}
	if !strings.Contains(rec.Body.String(), "rate limit exceeded") {
		t.Fatalf("body = %q, want rate limit message", rec.Body.String())
	}
}
