package auth

import (
	"net/http"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

type uoaConfigClaims struct {
	Domain             string         `json:"domain"`
	RedirectURLs       []string       `json:"redirect_urls"`
	EnabledAuthMethods []string       `json:"enabled_auth_methods"`
	UserScope          string         `json:"user_scope"`
	UITheme            map[string]any `json:"ui_theme"`
	LanguageConfig     string         `json:"language_config"`
	jwt.RegisteredClaims
}

// ServeUOAConfig returns the signed client configuration JWT consumed by UOA.
func (h *CallbackHandler) ServeUOAConfig(w http.ResponseWriter, _ *http.Request) {
	if h.cfg.UOADomain == "" || h.cfg.UOARedirectURL == "" || h.cfg.UOAAudience == "" || h.cfg.UOASharedSecret == "" {
		http.Error(w, "uoa config is incomplete", http.StatusInternalServerError)
		return
	}

	now := time.Now()
	claims := uoaConfigClaims{
		Domain:             h.cfg.UOADomain,
		RedirectURLs:       []string{h.cfg.UOARedirectURL},
		EnabledAuthMethods: []string{"email", "google", "apple"},
		UserScope:          "global",
		UITheme:            map[string]any{},
		LanguageConfig:     "en",
		RegisteredClaims: jwt.RegisteredClaims{
			Audience:  jwt.ClaimStrings{h.cfg.UOAAudience},
			Issuer:    h.cfg.UOADomain,
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(5 * time.Minute)),
		},
	}

	token, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(h.cfg.UOASharedSecret))
	if err != nil {
		http.Error(w, "failed to sign config", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/jwt")
	_, _ = w.Write([]byte(token))
}
