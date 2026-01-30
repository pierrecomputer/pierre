package storage

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"
)

const defaultWebhookMaxAgeSeconds = 300

// ParseSignatureHeader parses the X-Pierre-Signature header.
func ParseSignatureHeader(header string) *ParsedWebhookSignature {
	header = strings.TrimSpace(header)
	if header == "" {
		return nil
	}

	var timestamp string
	var signature string

	parts := strings.Split(header, ",")
	for _, part := range parts {
		kv := strings.SplitN(strings.TrimSpace(part), "=", 2)
		if len(kv) != 2 {
			continue
		}
		switch kv[0] {
		case "t":
			timestamp = kv[1]
		case "sha256":
			signature = kv[1]
		}
	}

	if timestamp == "" || signature == "" {
		return nil
	}

	return &ParsedWebhookSignature{Timestamp: timestamp, Signature: signature}
}

// ValidateWebhookSignature validates the HMAC signature and timestamp.
func ValidateWebhookSignature(payload []byte, signatureHeader string, secret string, options WebhookValidationOptions) WebhookValidationResult {
	if strings.TrimSpace(secret) == "" {
		return WebhookValidationResult{Valid: false, Error: "empty secret is not allowed"}
	}

	parsed := ParseSignatureHeader(signatureHeader)
	if parsed == nil {
		return WebhookValidationResult{Valid: false, Error: "invalid signature header format"}
	}

	timestamp, err := strconv.ParseInt(parsed.Timestamp, 10, 64)
	if err != nil {
		return WebhookValidationResult{Valid: false, Error: "invalid timestamp in signature"}
	}

	maxAge := options.MaxAgeSeconds
	if maxAge == 0 {
		maxAge = defaultWebhookMaxAgeSeconds
	}
	if maxAge > 0 {
		now := time.Now().Unix()
		age := now - timestamp
		if age > int64(maxAge) {
			return WebhookValidationResult{Valid: false, Error: "webhook timestamp too old (" + strconv.FormatInt(age, 10) + " seconds)", Timestamp: timestamp}
		}
		if age < -60 {
			return WebhookValidationResult{Valid: false, Error: "webhook timestamp is in the future", Timestamp: timestamp}
		}
	}

	signedData := parsed.Timestamp + "." + string(payload)
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(signedData))
	expected := mac.Sum(nil)
	provided, err := hex.DecodeString(parsed.Signature)
	if err != nil {
		return WebhookValidationResult{Valid: false, Error: "invalid signature", Timestamp: timestamp}
	}

	if len(expected) != len(provided) || !hmac.Equal(expected, provided) {
		return WebhookValidationResult{Valid: false, Error: "invalid signature", Timestamp: timestamp}
	}

	return WebhookValidationResult{Valid: true, Timestamp: timestamp}
}

// ValidateWebhook validates the webhook signature and parses the payload.
func ValidateWebhook(payload []byte, headers http.Header, secret string, options WebhookValidationOptions) WebhookValidation {
	signatureHeader := headers.Get("X-Pierre-Signature")
	if signatureHeader == "" {
		signatureHeader = headers.Get("x-pierre-signature")
	}
	if signatureHeader == "" {
		return WebhookValidation{WebhookValidationResult: WebhookValidationResult{Valid: false, Error: "missing or invalid X-Pierre-Signature header"}}
	}

	eventType := headers.Get("X-Pierre-Event")
	if eventType == "" {
		eventType = headers.Get("x-pierre-event")
	}
	if eventType == "" {
		return WebhookValidation{WebhookValidationResult: WebhookValidationResult{Valid: false, Error: "missing or invalid X-Pierre-Event header"}}
	}

	validation := ValidateWebhookSignature(payload, signatureHeader, secret, options)
	if !validation.Valid {
		return WebhookValidation{WebhookValidationResult: validation}
	}

	validation.EventType = eventType

	var raw json.RawMessage
	if err := json.Unmarshal(payload, &raw); err != nil {
		validation.Valid = false
		validation.Error = "invalid JSON payload"
		return WebhookValidation{WebhookValidationResult: validation}
	}

	converted, err := convertWebhookPayload(eventType, payload)
	if err != nil {
		validation.Valid = false
		validation.Error = err.Error()
		return WebhookValidation{WebhookValidationResult: validation}
	}

	return WebhookValidation{WebhookValidationResult: validation, Payload: &converted}
}

type rawWebhookPushEvent struct {
	Repository struct {
		ID  string `json:"id"`
		URL string `json:"url"`
	} `json:"repository"`
	Ref        string `json:"ref"`
	Before     string `json:"before"`
	After      string `json:"after"`
	CustomerID string `json:"customer_id"`
	PushedAt   string `json:"pushed_at"`
}

func convertWebhookPayload(eventType string, payload []byte) (WebhookEventPayload, error) {
	if eventType == "push" {
		var raw rawWebhookPushEvent
		if err := json.Unmarshal(payload, &raw); err != nil {
			return WebhookEventPayload{}, err
		}
		if raw.Repository.ID == "" || raw.Repository.URL == "" || raw.Ref == "" || raw.Before == "" || raw.After == "" || raw.CustomerID == "" || raw.PushedAt == "" {
			return WebhookEventPayload{}, errors.New("invalid push payload")
		}
		return WebhookEventPayload{Push: &WebhookPushEvent{
			Type:        "push",
			Repository:  WebhookRepository{ID: raw.Repository.ID, URL: raw.Repository.URL},
			Ref:         raw.Ref,
			Before:      raw.Before,
			After:       raw.After,
			CustomerID:  raw.CustomerID,
			PushedAt:    parseTime(raw.PushedAt),
			RawPushedAt: raw.PushedAt,
		}}, nil
	}

	return WebhookEventPayload{Unknown: &WebhookUnknownEvent{Type: eventType, Raw: payload}}, nil
}
