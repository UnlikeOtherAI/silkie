package auth

import "testing"

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
