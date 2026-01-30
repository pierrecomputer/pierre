package storage

import "testing"

func TestPackageName(t *testing.T) {
	if PackageName == "" {
		t.Fatalf("expected PackageName")
	}
	if PackageName != "code-storage-go-sdk" {
		t.Fatalf("unexpected package name: %s", PackageName)
	}
}

func TestPackageVersion(t *testing.T) {
	if PackageVersion == "" {
		t.Fatalf("expected PackageVersion")
	}
}

func TestUserAgent(t *testing.T) {
	agent := userAgent()
	if agent == "" {
		t.Fatalf("expected user agent")
	}
	expected := PackageName + "/" + PackageVersion
	if agent != expected {
		t.Fatalf("unexpected user agent: %s", agent)
	}
}
