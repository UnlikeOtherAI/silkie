package overlay

import (
	"net"
	"testing"
)

func TestDeviceHostOffsetRangeSkipsServerIP(t *testing.T) {
	_, cidr, err := net.ParseCIDR("10.100.0.0/16")
	if err != nil {
		t.Fatalf("parse cidr: %v", err)
	}

	first, last, err := deviceHostOffsetRange(cidr)
	if err != nil {
		t.Fatalf("deviceHostOffsetRange: %v", err)
	}

	if first != 2 {
		t.Fatalf("first offset = %d, want 2", first)
	}
	if last != 65534 {
		t.Fatalf("last offset = %d, want 65534", last)
	}
}

func TestDeviceHostOffsetRangeAllowsSingleDeviceSubnet(t *testing.T) {
	_, cidr, err := net.ParseCIDR("10.100.0.0/30")
	if err != nil {
		t.Fatalf("parse cidr: %v", err)
	}

	first, last, err := deviceHostOffsetRange(cidr)
	if err != nil {
		t.Fatalf("deviceHostOffsetRange: %v", err)
	}

	if first != 2 || last != 2 {
		t.Fatalf("offset range = %d..%d, want 2..2", first, last)
	}
}

func TestDeviceHostOffsetRangeRejectsTooSmallSubnet(t *testing.T) {
	_, cidr, err := net.ParseCIDR("10.100.0.0/31")
	if err != nil {
		t.Fatalf("parse cidr: %v", err)
	}

	if _, _, err := deviceHostOffsetRange(cidr); err == nil {
		t.Fatal("expected error for /31 subnet")
	}
}
