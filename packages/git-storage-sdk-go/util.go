package storage

import (
	"encoding/json"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"
)

func itoa(value int) string {
	return strconv.Itoa(value)
}

func decodeJSON(resp *http.Response, target interface{}) error {
	decoder := json.NewDecoder(resp.Body)
	return decoder.Decode(target)
}

func parseTime(value string) time.Time {
	if value == "" {
		return time.Time{}
	}
	if parsed, err := time.Parse(time.RFC3339Nano, value); err == nil {
		return parsed
	}
	if parsed, err := time.Parse(time.RFC3339, value); err == nil {
		return parsed
	}
	return time.Time{}
}

func normalizeDiffState(raw string) DiffFileState {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return DiffStateUnknown
	}
	leading := strings.ToUpper(trimmed[:1])
	switch leading {
	case "A":
		return DiffStateAdded
	case "M":
		return DiffStateModified
	case "D":
		return DiffStateDeleted
	case "R":
		return DiffStateRenamed
	case "C":
		return DiffStateCopied
	case "T":
		return DiffStateTypeChanged
	case "U":
		return DiffStateUnmerged
	default:
		return DiffStateUnknown
	}
}

func transformBranchDiff(raw branchDiffResponse) GetBranchDiffResult {
	result := GetBranchDiffResult{
		Branch: raw.Branch,
		Base:   raw.Base,
		Stats: DiffStats{
			Files:     raw.Stats.Files,
			Additions: raw.Stats.Additions,
			Deletions: raw.Stats.Deletions,
			Changes:   raw.Stats.Changes,
		},
	}

	for _, file := range raw.Files {
		result.Files = append(result.Files, FileDiff{
			Path:     file.Path,
			State:    normalizeDiffState(file.State),
			RawState: file.State,
			OldPath:  strings.TrimSpace(file.OldPath),
			Raw:      file.Raw,
			Bytes:    file.Bytes,
			IsEOF:    file.IsEOF,
		})
	}

	for _, file := range raw.FilteredFiles {
		result.FilteredFiles = append(result.FilteredFiles, FilteredFile{
			Path:     file.Path,
			State:    normalizeDiffState(file.State),
			RawState: file.State,
			OldPath:  strings.TrimSpace(file.OldPath),
			Bytes:    file.Bytes,
			IsEOF:    file.IsEOF,
		})
	}

	return result
}

func transformCommitDiff(raw commitDiffResponse) GetCommitDiffResult {
	result := GetCommitDiffResult{
		SHA: raw.SHA,
		Stats: DiffStats{
			Files:     raw.Stats.Files,
			Additions: raw.Stats.Additions,
			Deletions: raw.Stats.Deletions,
			Changes:   raw.Stats.Changes,
		},
	}

	for _, file := range raw.Files {
		result.Files = append(result.Files, FileDiff{
			Path:     file.Path,
			State:    normalizeDiffState(file.State),
			RawState: file.State,
			OldPath:  strings.TrimSpace(file.OldPath),
			Raw:      file.Raw,
			Bytes:    file.Bytes,
			IsEOF:    file.IsEOF,
		})
	}

	for _, file := range raw.FilteredFiles {
		result.FilteredFiles = append(result.FilteredFiles, FilteredFile{
			Path:     file.Path,
			State:    normalizeDiffState(file.State),
			RawState: file.State,
			OldPath:  strings.TrimSpace(file.OldPath),
			Bytes:    file.Bytes,
			IsEOF:    file.IsEOF,
		})
	}

	return result
}

func parseNoteWriteResponse(resp *http.Response, method string) (NoteWriteResult, error) {
	contentType := resp.Header.Get("content-type")
	var rawBody []byte
	var err error

	if resp.Body != nil {
		rawBody, err = io.ReadAll(resp.Body)
		if err != nil {
			return NoteWriteResult{}, err
		}
	}

	if strings.Contains(contentType, "application/json") && len(rawBody) > 0 {
		var payload noteWriteResponse
		if err := json.Unmarshal(rawBody, &payload); err == nil && payload.SHA != "" {
			return NoteWriteResult{
				SHA:        payload.SHA,
				TargetRef:  payload.TargetRef,
				BaseCommit: payload.BaseCommit,
				NewRefSHA:  payload.NewRefSHA,
				Result: NoteResult{
					Success: payload.Result.Success,
					Status:  payload.Result.Status,
					Message: payload.Result.Message,
				},
			}, nil
		}

		var env errorEnvelope
		if err := json.Unmarshal(rawBody, &env); err == nil && strings.TrimSpace(env.Error) != "" {
			return NoteWriteResult{}, &APIError{
				Message:    strings.TrimSpace(env.Error),
				Status:     resp.StatusCode,
				StatusText: resp.Status,
				Method:     method,
				URL:        resp.Request.URL.String(),
				Body:       env,
			}
		}
	}

	fallback := "request " + method + " " + resp.Request.URL.String() + " failed with status " + strconv.Itoa(resp.StatusCode) + " " + resp.Status
	if len(rawBody) > 0 {
		text := strings.TrimSpace(string(rawBody))
		if text != "" {
			fallback = text
		}
	}

	return NoteWriteResult{}, &APIError{
		Message:    fallback,
		Status:     resp.StatusCode,
		StatusText: resp.Status,
		Method:     method,
		URL:        resp.Request.URL.String(),
		Body:       string(rawBody),
	}
}

type restoreCommitFailure struct {
	Status    string
	Message   string
	RefUpdate *RefUpdate
}

func parseRestoreCommitPayload(body []byte) (*restoreCommitAck, *restoreCommitFailure) {
	var ack restoreCommitAck
	if err := json.Unmarshal(body, &ack); err == nil {
		if ack.Result.Success {
			return &ack, nil
		}
	}

	var failure restoreCommitResponse
	if err := json.Unmarshal(body, &failure); err == nil {
		return nil, &restoreCommitFailure{
			Status:    strings.TrimSpace(failure.Result.Status),
			Message:   strings.TrimSpace(failure.Result.Message),
			RefUpdate: partialRefUpdate(failure.Result.Branch, failure.Result.OldSHA, failure.Result.NewSHA),
		}
	}

	return nil, nil
}

func buildRestoreCommitResult(ack restoreCommitAck) (RestoreCommitResult, error) {
	refUpdate := RefUpdate{
		Branch: ack.Result.Branch,
		OldSHA: ack.Result.OldSHA,
		NewSHA: ack.Result.NewSHA,
	}

	if !ack.Result.Success {
		message := ack.Result.Message
		if strings.TrimSpace(message) == "" {
			message = "Restore commit failed with status " + ack.Result.Status
		}
		return RestoreCommitResult{}, newRefUpdateError(message, ack.Result.Status, &refUpdate)
	}

	return RestoreCommitResult{
		CommitSHA:    ack.Commit.CommitSHA,
		TreeSHA:      ack.Commit.TreeSHA,
		TargetBranch: ack.Commit.TargetBranch,
		PackBytes:    ack.Commit.PackBytes,
		RefUpdate:    refUpdate,
	}, nil
}

func httpStatusToRestoreStatus(status int) string {
	switch status {
	case 409:
		return "conflict"
	case 412:
		return "precondition_failed"
	default:
		return strconv.Itoa(status)
	}
}
