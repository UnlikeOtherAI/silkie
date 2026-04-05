package auth

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"

	"github.com/unlikeotherai/silkie/internal/config"
)

type UOAClaims struct {
	Email       string `json:"email,omitempty"`
	DisplayName string `json:"display_name,omitempty"`
	Name        string `json:"name,omitempty"`
	jwt.RegisteredClaims
}

type tokenExchangeResponse struct {
	AccessToken string `json:"access_token"`
}

func BuildAuthURL() string {
	cfg := config.Load()
	baseURL := strings.TrimRight(cfg.UOABaseURL, "/")
	query := url.Values{}
	query.Set("config_url", cfg.UOAConfigURL)
	if cfg.UOARedirectURL != "" {
		query.Set("redirect_uri", cfg.UOARedirectURL)
	}

	return baseURL + "/oauth/authorize?" + query.Encode()
}

func ExchangeCode(code string) (*UOAClaims, error) {
	cfg := config.Load()
	if strings.TrimSpace(code) == "" {
		return nil, errors.New("code is required")
	}

	payload, err := json.Marshal(map[string]string{"code": code})
	if err != nil {
		return nil, fmt.Errorf("marshal code exchange payload: %w", err)
	}

	authorization := uoaAuthorizationToken(cfg.UOADomain, cfg.UOASharedSecret)
	client := &http.Client{Timeout: 10 * time.Second}
	endpoints := []string{
		strings.TrimRight(cfg.UOABaseURL, "/") + "/token",
		strings.TrimRight(cfg.UOABaseURL, "/") + "/auth/token",
	}

	var lastErr error

	for _, endpoint := range endpoints {
		request, err := http.NewRequest(http.MethodPost, endpoint, bytes.NewReader(payload))
		if err != nil {
			return nil, fmt.Errorf("build token exchange request: %w", err)
		}
		request.Header.Set("Authorization", "Bearer "+authorization)
		request.Header.Set("Content-Type", "application/json")

		response, err := client.Do(request)
		if err != nil {
			lastErr = fmt.Errorf("exchange code at %s: %w", endpoint, err)
			continue
		}

		body, readErr := io.ReadAll(response.Body)
		response.Body.Close()
		if readErr != nil {
			lastErr = fmt.Errorf("read token exchange response from %s: %w", endpoint, readErr)
			continue
		}

		if response.StatusCode >= http.StatusMultipleChoices {
			lastErr = fmt.Errorf("token exchange failed at %s: status %d", endpoint, response.StatusCode)
			if response.StatusCode == http.StatusNotFound {
				continue
			}
			continue
		}

		var tokenResponse tokenExchangeResponse
		if err := json.Unmarshal(body, &tokenResponse); err != nil {
			lastErr = fmt.Errorf("decode token exchange response from %s: %w", endpoint, err)
			continue
		}
		if tokenResponse.AccessToken == "" {
			lastErr = fmt.Errorf("token exchange at %s returned no access token", endpoint)
			continue
		}

		claims, err := verifyUOAToken(tokenResponse.AccessToken, cfg.UOASharedSecret, cfg.UOAAudience)
		if err != nil {
			lastErr = fmt.Errorf("verify access token from %s: %w", endpoint, err)
			continue
		}
		if claims.DisplayName == "" {
			claims.DisplayName = claims.Name
		}

		return claims, nil
	}

	if lastErr == nil {
		lastErr = errors.New("token exchange failed")
	}

	return nil, lastErr
}

func verifyUOAToken(tokenString string, secret string, audience string) (*UOAClaims, error) {
	claims := &UOAClaims{}
	parser := jwt.NewParser(jwt.WithValidMethods([]string{jwt.SigningMethodHS256.Alg()}))

	token, err := parser.ParseWithClaims(tokenString, claims, func(token *jwt.Token) (any, error) {
		if token.Method.Alg() != jwt.SigningMethodHS256.Alg() {
			return nil, errors.New("unexpected signing method")
		}

		return []byte(secret), nil
	})
	if err != nil {
		return nil, err
	}
	if !token.Valid {
		return nil, errors.New("token is invalid")
	}
	if audience != "" {
		aud, _ := claims.GetAudience()
		found := false
		for _, a := range aud {
			if a == audience {
				found = true
				break
			}
		}
		if !found {
			return nil, errors.New("token audience mismatch")
		}
	}

	return claims, nil
}

func uoaAuthorizationToken(domain string, secret string) string {
	sum := sha256.Sum256([]byte(domain + secret))
	return hex.EncodeToString(sum[:])
}
