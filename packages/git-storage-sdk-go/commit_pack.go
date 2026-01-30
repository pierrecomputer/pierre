package storage

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"
)

type commitPackAck struct {
	Commit struct {
		CommitSHA    string `json:"commit_sha"`
		TreeSHA      string `json:"tree_sha"`
		TargetBranch string `json:"target_branch"`
		PackBytes    int    `json:"pack_bytes"`
		BlobCount    int    `json:"blob_count"`
	} `json:"commit"`
	Result struct {
		Branch  string `json:"branch"`
		OldSHA  string `json:"old_sha"`
		NewSHA  string `json:"new_sha"`
		Success bool   `json:"success"`
		Status  string `json:"status"`
		Message string `json:"message,omitempty"`
	} `json:"result"`
}

type commitPackResponse struct {
	Commit *struct {
		CommitSHA    string `json:"commit_sha"`
		TreeSHA      string `json:"tree_sha"`
		TargetBranch string `json:"target_branch"`
		PackBytes    int    `json:"pack_bytes"`
		BlobCount    int    `json:"blob_count"`
	} `json:"commit,omitempty"`
	Result struct {
		Branch  string `json:"branch"`
		OldSHA  string `json:"old_sha"`
		NewSHA  string `json:"new_sha"`
		Success *bool  `json:"success"`
		Status  string `json:"status"`
		Message string `json:"message"`
	} `json:"result"`
}

type errorEnvelope struct {
	Error string `json:"error"`
}

func buildCommitResult(ack commitPackAck) (CommitResult, error) {
	refUpdate := RefUpdate{
		Branch: ack.Result.Branch,
		OldSHA: ack.Result.OldSHA,
		NewSHA: ack.Result.NewSHA,
	}

	if !ack.Result.Success {
		message := ack.Result.Message
		if strings.TrimSpace(message) == "" {
			message = "commit failed with status " + ack.Result.Status
		}
		return CommitResult{}, newRefUpdateError(message, ack.Result.Status, &refUpdate)
	}

	return CommitResult{
		CommitSHA:    ack.Commit.CommitSHA,
		TreeSHA:      ack.Commit.TreeSHA,
		TargetBranch: ack.Commit.TargetBranch,
		PackBytes:    ack.Commit.PackBytes,
		BlobCount:    ack.Commit.BlobCount,
		RefUpdate:    refUpdate,
	}, nil
}

func parseCommitPackError(resp *http.Response, fallbackMessage string) (string, string, *RefUpdate, error) {
	body, err := readAll(resp)
	if err != nil {
		return "", "", nil, err
	}

	statusLabel := defaultStatusLabel(resp.StatusCode)
	var refUpdate *RefUpdate
	message := ""

	var parsed commitPackResponse
	if err := json.Unmarshal(body, &parsed); err == nil {
		if strings.TrimSpace(parsed.Result.Status) != "" {
			statusLabel = strings.TrimSpace(parsed.Result.Status)
		}
		if parsed.Result.Message != "" {
			message = strings.TrimSpace(parsed.Result.Message)
		}
		refUpdate = partialRefUpdate(parsed.Result.Branch, parsed.Result.OldSHA, parsed.Result.NewSHA)
	}

	if message == "" {
		var errEnv errorEnvelope
		if err := json.Unmarshal(body, &errEnv); err == nil {
			if strings.TrimSpace(errEnv.Error) != "" {
				message = strings.TrimSpace(errEnv.Error)
			}
		}
	}

	if message == "" && len(body) > 0 {
		message = strings.TrimSpace(string(body))
	}

	if message == "" {
		if fallbackMessage != "" {
			message = fallbackMessage
		} else {
			message = "commit request failed (" + strconv.Itoa(resp.StatusCode) + " " + resp.Status + ")"
		}
	}

	return message, statusLabel, refUpdate, nil
}

func defaultStatusLabel(statusCode int) string {
	status := inferRefUpdateReason(strconv.Itoa(statusCode))
	if status == RefUpdateReasonUnknown {
		return string(RefUpdateReasonFailed)
	}
	return string(status)
}

func partialRefUpdate(branch string, oldSHA string, newSHA string) *RefUpdate {
	branch = strings.TrimSpace(branch)
	oldSHA = strings.TrimSpace(oldSHA)
	newSHA = strings.TrimSpace(newSHA)

	if branch == "" && oldSHA == "" && newSHA == "" {
		return nil
	}
	return &RefUpdate{Branch: branch, OldSHA: oldSHA, NewSHA: newSHA}
}

func readAll(resp *http.Response) ([]byte, error) {
	if resp.Body == nil {
		return nil, errors.New("response body is empty")
	}
	return io.ReadAll(resp.Body)
}
