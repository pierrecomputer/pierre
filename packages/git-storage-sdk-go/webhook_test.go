package storage

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"strconv"
	"strings"
	"testing"
	"time"
)

func TestParseSignatureHeader(t *testing.T) {
	header := "t=1234567890,sha256=abcdef123456"
	result := ParseSignatureHeader(header)
	if result == nil || result.Timestamp != "1234567890" || result.Signature != "abcdef123456" {
		t.Fatalf("unexpected signature header parse")
	}

	result = ParseSignatureHeader("t=1234567890, sha256=abcdef123456")
	if result == nil || result.Signature != "abcdef123456" {
		t.Fatalf("expected signature with spaces")
	}

	if ParseSignatureHeader("") != nil {
		t.Fatalf("expected nil for empty header")
	}
	if ParseSignatureHeader("invalid") != nil {
		t.Fatalf("expected nil for invalid header")
	}
	if ParseSignatureHeader("t=123") != nil {
		t.Fatalf("expected nil for missing signature")
	}
	if ParseSignatureHeader("sha256=abc") != nil {
		t.Fatalf("expected nil for missing timestamp")
	}
	if ParseSignatureHeader("timestamp=123,signature=abc") != nil {
		t.Fatalf("expected nil for wrong keys")
	}

	header = "t=1234567890,sha256=abcdef123456,v1=ignored"
	result = ParseSignatureHeader(header)
	if result == nil || result.Signature != "abcdef123456" {
		t.Fatalf("expected signature with extra fields")
	}
}

func TestValidateWebhookSignature(t *testing.T) {
	secret := "test_webhook_secret_key_123"
	payload := []byte(`{"repository":{"id":"repo","url":"https://git.example.com/org/repo"},"ref":"main","before":"abc","after":"def","customer_id":"cust","pushed_at":"2024-01-20T10:30:00Z"}`)
	stamp := time.Now().Unix()
	header := buildSignatureHeader(t, payload, secret, stamp)

	result := ValidateWebhookSignature(payload, header, secret, WebhookValidationOptions{})
	if !result.Valid || result.Timestamp != stamp {
		t.Fatalf("expected valid signature")
	}

	invalidHeader := buildSignatureHeader(t, payload, "wrong_secret", stamp)
	result = ValidateWebhookSignature(payload, invalidHeader, secret, WebhookValidationOptions{})
	if result.Valid || result.Error != "invalid signature" {
		t.Fatalf("expected invalid signature")
	}

	oldStamp := time.Now().Add(-400 * time.Second).Unix()
	header = buildSignatureHeader(t, payload, secret, oldStamp)
	result = ValidateWebhookSignature(payload, header, secret, WebhookValidationOptions{})
	if result.Valid || !strings.Contains(result.Error, "webhook timestamp too old") {
		t.Fatalf("expected old timestamp error")
	}

	futureStamp := time.Now().Add(120 * time.Second).Unix()
	header = buildSignatureHeader(t, payload, secret, futureStamp)
	result = ValidateWebhookSignature(payload, header, secret, WebhookValidationOptions{})
	if result.Valid || result.Error != "webhook timestamp is in the future" {
		t.Fatalf("expected future timestamp error")
	}

	stamp = time.Now().Add(-60 * time.Second).Unix()
	header = buildSignatureHeader(t, payload, secret, stamp)
	result = ValidateWebhookSignature(payload, header, secret, WebhookValidationOptions{MaxAgeSeconds: 30})
	if result.Valid {
		t.Fatalf("expected signature to be too old")
	}
	result = ValidateWebhookSignature(payload, header, secret, WebhookValidationOptions{MaxAgeSeconds: 120})
	if !result.Valid {
		t.Fatalf("expected signature to be valid with relaxed max age")
	}

	result = ValidateWebhookSignature(payload, "invalid_header", secret, WebhookValidationOptions{})
	if result.Valid || result.Error != "invalid signature header format" {
		t.Fatalf("expected invalid header format error")
	}

	result = ValidateWebhookSignature(payload, "t=not_a_number,sha256=abcdef", secret, WebhookValidationOptions{})
	if result.Valid || result.Error != "invalid timestamp in signature" {
		t.Fatalf("expected invalid timestamp error")
	}

	modified := []byte(strings.ReplaceAll(string(payload), "main", "master"))
	result = ValidateWebhookSignature(modified, header, secret, WebhookValidationOptions{})
	if result.Valid {
		t.Fatalf("expected modified payload to fail")
	}

	result = ValidateWebhookSignature(append(payload, ' '), header, secret, WebhookValidationOptions{})
	if result.Valid {
		t.Fatalf("expected whitespace payload to fail")
	}
}

func TestValidateWebhook(t *testing.T) {
	secret := "test_webhook_secret_key_123"
	payload := []byte(`{"repository":{"id":"repo_abc123","url":"https://git.example.com/org/repo"},"ref":"main","before":"abc123","after":"def456","customer_id":"cust_123","pushed_at":"2024-01-20T10:30:00Z"}`)
	stamp := time.Now().Unix()
	header := buildSignatureHeader(t, payload, secret, stamp)

	headers := http.Header{}
	headers.Set("x-pierre-signature", header)
	headers.Set("x-pierre-event", "push")

	result := ValidateWebhook(payload, headers, secret, WebhookValidationOptions{})
	if !result.Valid || result.EventType != "push" {
		t.Fatalf("expected valid webhook")
	}
	if result.Payload == nil || result.Payload.Push == nil {
		t.Fatalf("expected push payload")
	}
	if result.Payload.Push.CustomerID != "cust_123" || result.Payload.Push.Repository.ID != "repo_abc123" {
		t.Fatalf("unexpected push payload contents")
	}

	uppercase := http.Header{}
	uppercase.Set("X-Pierre-Signature", header)
	uppercase.Set("X-Pierre-Event", "push")
	result = ValidateWebhook(payload, uppercase, secret, WebhookValidationOptions{})
	if !result.Valid {
		t.Fatalf("expected valid webhook with uppercase headers")
	}

	missingSig := http.Header{}
	missingSig.Set("x-pierre-event", "push")
	result = ValidateWebhook(payload, missingSig, secret, WebhookValidationOptions{})
	if result.Valid || result.Error != "missing or invalid X-Pierre-Signature header" {
		t.Fatalf("expected missing signature error")
	}

	missingEvent := http.Header{}
	missingEvent.Set("x-pierre-signature", header)
	result = ValidateWebhook(payload, missingEvent, secret, WebhookValidationOptions{})
	if result.Valid || result.Error != "missing or invalid X-Pierre-Event header" {
		t.Fatalf("expected missing event error")
	}

	invalidJSON := []byte("not valid json")
	badHeader := buildSignatureHeader(t, invalidJSON, secret, stamp)
	badHeaders := http.Header{}
	badHeaders.Set("x-pierre-signature", badHeader)
	badHeaders.Set("x-pierre-event", "push")
	result = ValidateWebhook(invalidJSON, badHeaders, secret, WebhookValidationOptions{})
	if result.Valid || result.Error != "invalid JSON payload" {
		t.Fatalf("expected invalid JSON payload error")
	}

	wrongSig := buildSignatureHeader(t, payload, "wrong_secret", stamp)
	wrongHeaders := http.Header{}
	wrongHeaders.Set("x-pierre-signature", wrongSig)
	wrongHeaders.Set("x-pierre-event", "push")
	result = ValidateWebhook(payload, wrongHeaders, secret, WebhookValidationOptions{})
	if result.Valid || result.Error != "invalid signature" {
		t.Fatalf("expected invalid signature error")
	}
}

func TestWebhookEmptyInputs(t *testing.T) {
	secret := "test_webhook_secret_key_123"
	payload := []byte(`{"repository":{"id":"repo","url":"https://git.example.com/org/repo"},"ref":"main","before":"abc","after":"def","customer_id":"cust","pushed_at":"2024-01-20T10:30:00Z"}`)
	stamp := time.Now().Unix()
	header := buildSignatureHeader(t, payload, secret, stamp)

	result := ValidateWebhookSignature([]byte{}, header, secret, WebhookValidationOptions{})
	if result.Valid {
		t.Fatalf("expected empty payload to fail")
	}

	result = ValidateWebhookSignature(payload, header, "", WebhookValidationOptions{})
	if result.Valid || result.Error != "empty secret is not allowed" {
		t.Fatalf("expected empty secret error")
	}

	result = ValidateWebhookSignature(payload, "", secret, WebhookValidationOptions{})
	if result.Valid || result.Error != "invalid signature header format" {
		t.Fatalf("expected empty header error")
	}
}

func buildSignatureHeader(t *testing.T, payload []byte, secret string, timestamp int64) string {
	t.Helper()
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(strconv.FormatInt(timestamp, 10) + "." + string(payload)))
	signature := hex.EncodeToString(mac.Sum(nil))
	return "t=" + strconv.FormatInt(timestamp, 10) + ",sha256=" + signature
}
