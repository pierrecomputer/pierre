package storage

import (
	"bytes"
	"encoding/base64"
	"io"
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

func readNDJSONLines(t *testing.T, body io.Reader) []string {
	t.Helper()
	data, err := io.ReadAll(body)
	if err != nil {
		t.Fatalf("read ndjson body: %v", err)
	}
	data = bytes.TrimSpace(data)
	if len(data) == 0 {
		return nil
	}
	parts := bytes.Split(data, []byte("\n"))
	lines := make([]string, len(parts))
	for i, part := range parts {
		lines[i] = string(part)
	}
	return lines
}

func decodeBase64(t *testing.T, value string) []byte {
	t.Helper()
	decoded, err := base64.StdEncoding.DecodeString(value)
	if err != nil {
		t.Fatalf("decode base64: %v", err)
	}
	return decoded
}

func boolPtr(value bool) *bool {
	return &value
}
