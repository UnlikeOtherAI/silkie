package mobile

import (
	"strings"
	"testing"

	"github.com/unlikeotherai/selkie/internal/config"
)

func TestRenderMobileWGConfig(t *testing.T) {
	h := &Handler{cfg: config.Config{
		WGOverlayCIDR:     "10.100.0.0/16",
		WGServerPublicKey: "server-public-key",
		WGServerEndpoint:  "relay.selkie.live",
		WGServerPort:      51820,
	}}

	got, err := h.renderMobileWGConfig("10.100.0.9")
	if err != nil {
		t.Fatalf("renderMobileWGConfig: %v", err)
	}
	for _, want := range []string{
		"[Interface]",
		"Address = 10.100.0.9/32",
		"Endpoint = relay.selkie.live:51820",
		"AllowedIPs = 10.100.0.1/32",
		"PersistentKeepalive = 25",
	} {
		if !strings.Contains(got, want) {
			t.Fatalf("config missing %q:\n%s", want, got)
		}
	}
}
