package storage

import (
	"strings"
)

// APIError describes HTTP errors for non-commit endpoints.
type APIError struct {
	Message    string
	Status     int
	StatusText string
	Method     string
	URL        string
	Body       interface{}
}

func (e *APIError) Error() string {
	return e.Message
}

// RefUpdateReason describes a ref update failure reason.
type RefUpdateReason string

const (
	RefUpdateReasonPreconditionFailed RefUpdateReason = "precondition_failed"
	RefUpdateReasonConflict           RefUpdateReason = "conflict"
	RefUpdateReasonNotFound           RefUpdateReason = "not_found"
	RefUpdateReasonInvalid            RefUpdateReason = "invalid"
	RefUpdateReasonTimeout            RefUpdateReason = "timeout"
	RefUpdateReasonUnauthorized       RefUpdateReason = "unauthorized"
	RefUpdateReasonForbidden          RefUpdateReason = "forbidden"
	RefUpdateReasonUnavailable        RefUpdateReason = "unavailable"
	RefUpdateReasonInternal           RefUpdateReason = "internal"
	RefUpdateReasonFailed             RefUpdateReason = "failed"
	RefUpdateReasonUnknown            RefUpdateReason = "unknown"
)

// RefUpdateError describes failed ref updates.
type RefUpdateError struct {
	Message   string
	Status    string
	Reason    RefUpdateReason
	RefUpdate *RefUpdate
}

func (e *RefUpdateError) Error() string {
	return e.Message
}

func inferRefUpdateReason(status string) RefUpdateReason {
	if strings.TrimSpace(status) == "" {
		return RefUpdateReasonUnknown
	}

	switch strings.ToLower(strings.TrimSpace(status)) {
	case "precondition_failed":
		return RefUpdateReasonPreconditionFailed
	case "conflict":
		return RefUpdateReasonConflict
	case "not_found":
		return RefUpdateReasonNotFound
	case "invalid":
		return RefUpdateReasonInvalid
	case "timeout":
		return RefUpdateReasonTimeout
	case "unauthorized":
		return RefUpdateReasonUnauthorized
	case "forbidden":
		return RefUpdateReasonForbidden
	case "unavailable":
		return RefUpdateReasonUnavailable
	case "internal":
		return RefUpdateReasonInternal
	case "failed":
		return RefUpdateReasonFailed
	case "ok":
		return RefUpdateReasonUnknown
	default:
		return RefUpdateReasonUnknown
	}
}

func newRefUpdateError(message string, status string, refUpdate *RefUpdate) *RefUpdateError {
	return &RefUpdateError{
		Message:   message,
		Status:    status,
		Reason:    inferRefUpdateReason(status),
		RefUpdate: refUpdate,
	}
}
