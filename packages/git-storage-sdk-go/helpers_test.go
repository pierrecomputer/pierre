package storage

import (
	"net/url"
	"strings"
	"testing"

	"github.com/golang-jwt/jwt/v5"
)

const testKey = "-----BEGIN PRIVATE KEY-----\nMIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgy3DPdzzsP6tOOvmorjbx6L7mpFmKKL2hNWNW3urkN8ehRANCAAQ7/DPhGH3kaWl0YEIO+W9WmhyCclDGyTh6suablSura7ZDG8hpm3oNsq/ykC3Scfsw6ZTuuVuLlXKV/be/Xr0d\n-----END PRIVATE KEY-----\n"

func parseJWTFromURL(t *testing.T, rawURL string) jwt.MapClaims {
	t.Helper()
	parsed, err := url.Parse(rawURL)
	if err != nil {
		t.Fatalf("parse url: %v", err)
	}
	password, ok := parsed.User.Password()
	if !ok || strings.TrimSpace(password) == "" {
		t.Fatalf("jwt not found in url")
	}
	claims := jwt.MapClaims{}
	_, err = jwt.ParseWithClaims(password, claims, func(token *jwt.Token) (interface{}, error) {
		key, err := parseECPrivateKey([]byte(testKey))
		if err != nil {
			return nil, err
		}
		return &key.PublicKey, nil
	})
	if err != nil {
		t.Fatalf("parse jwt: %v", err)
	}
	return claims
}

func parseJWTFromToken(t *testing.T, token string) jwt.MapClaims {
	t.Helper()
	if strings.TrimSpace(token) == "" {
		t.Fatalf("jwt token is empty")
	}
	claims := jwt.MapClaims{}
	_, err := jwt.ParseWithClaims(token, claims, func(token *jwt.Token) (interface{}, error) {
		key, err := parseECPrivateKey([]byte(testKey))
		if err != nil {
			return nil, err
		}
		return &key.PublicKey, nil
	})
	if err != nil {
		t.Fatalf("parse jwt: %v", err)
	}
	return claims
}
