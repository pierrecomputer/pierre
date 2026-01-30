package storage

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestCommitFromDiffStreamsMetadataAndChunks(t *testing.T) {
	var requestPath string
	var headerAgent string
	var headerContentType string
	var lines []string

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestPath = r.URL.Path
		headerAgent = r.Header.Get("Code-Storage-Agent")
		headerContentType = r.Header.Get("Content-Type")
		lines = readNDJSONLines(t, r.Body)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"commit":{"commit_sha":"def456","tree_sha":"abc123","target_branch":"main","pack_bytes":84,"blob_count":0},"result":{"branch":"main","old_sha":"0000000000000000000000000000000000000000","new_sha":"def456","success":true,"status":"ok"}}`))
	}))
	defer server.Close()

	client, err := NewClient(Options{Name: "acme", Key: testKey, APIBaseURL: server.URL})
	if err != nil {
		t.Fatalf("client error: %v", err)
	}
	repo := &Repo{ID: "repo", DefaultBranch: "main", client: client}

	result, err := repo.CreateCommitFromDiff(nil, CommitFromDiffOptions{
		TargetBranch:    "main",
		CommitMessage:   "Apply patch",
		ExpectedHeadSHA: "abc123",
		Author:          CommitSignature{Name: "Author Name", Email: "author@example.com"},
		Diff:            "diff --git a/file.txt b/file.txt\n",
	})
	if err != nil {
		t.Fatalf("commit from diff error: %v", err)
	}

	if requestPath != "/api/v1/repos/diff-commit" {
		t.Fatalf("unexpected path: %s", requestPath)
	}
	if headerContentType != "application/x-ndjson" {
		t.Fatalf("unexpected content type: %s", headerContentType)
	}
	if headerAgent == "" || !strings.Contains(headerAgent, "code-storage-go-sdk/") {
		t.Fatalf("missing Code-Storage-Agent header")
	}
	if len(lines) != 2 {
		t.Fatalf("expected 2 ndjson lines, got %d", len(lines))
	}

	var metadataEnvelope map[string]interface{}
	if err := json.Unmarshal([]byte(lines[0]), &metadataEnvelope); err != nil {
		t.Fatalf("decode metadata: %v", err)
	}
	metadata := metadataEnvelope["metadata"].(map[string]interface{})
	if metadata["target_branch"] != "main" {
		t.Fatalf("unexpected target_branch: %#v", metadata["target_branch"])
	}
	if metadata["expected_head_sha"] != "abc123" {
		t.Fatalf("unexpected expected_head_sha")
	}
	if metadata["commit_message"] != "Apply patch" {
		t.Fatalf("unexpected commit_message")
	}

	var chunkEnvelope map[string]interface{}
	if err := json.Unmarshal([]byte(lines[1]), &chunkEnvelope); err != nil {
		t.Fatalf("decode chunk: %v", err)
	}
	chunk := chunkEnvelope["diff_chunk"].(map[string]interface{})
	if eof, _ := chunk["eof"].(bool); !eof {
		t.Fatalf("expected eof true")
	}
	decoded := decodeBase64(t, chunk["data"].(string))
	if string(decoded) != "diff --git a/file.txt b/file.txt\n" {
		t.Fatalf("unexpected diff payload")
	}

	if result.CommitSHA != "def456" {
		t.Fatalf("unexpected result: %#v", result)
	}
}

func TestCommitFromDiffRequiresDiff(t *testing.T) {
	client, err := NewClient(Options{Name: "acme", Key: testKey})
	if err != nil {
		t.Fatalf("client error: %v", err)
	}
	repo := &Repo{ID: "repo", DefaultBranch: "main", client: client}

	_, err = repo.CreateCommitFromDiff(nil, CommitFromDiffOptions{
		TargetBranch:  "main",
		CommitMessage: "Apply patch",
		Author:        CommitSignature{Name: "Author", Email: "author@example.com"},
		Diff:          nil,
	})
	if err == nil || !strings.Contains(err.Error(), "createCommitFromDiff diff is required") {
		t.Fatalf("expected diff validation error, got %v", err)
	}
}

func TestCommitFromDiffErrorResponseReturnsRefUpdateError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusConflict)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"result":{"status":"conflict","message":"Head moved","branch":"main","old_sha":"abc","new_sha":"def"}}`))
	}))
	defer server.Close()

	client, err := NewClient(Options{Name: "acme", Key: testKey, APIBaseURL: server.URL})
	if err != nil {
		t.Fatalf("client error: %v", err)
	}
	repo := &Repo{ID: "repo", DefaultBranch: "main", client: client}

	_, err = repo.CreateCommitFromDiff(nil, CommitFromDiffOptions{
		TargetBranch:    "refs/heads/main",
		CommitMessage:   "Apply patch",
		ExpectedHeadSHA: "abc",
		Author:          CommitSignature{Name: "Author", Email: "author@example.com"},
		Diff:            "diff --git a/file.txt b/file.txt\n",
	})
	if err == nil {
		t.Fatalf("expected error")
	}

	var refErr *RefUpdateError
	if !errors.As(err, &refErr) {
		t.Fatalf("expected RefUpdateError, got %T", err)
	}
	if refErr.Status != "conflict" {
		t.Fatalf("unexpected status: %s", refErr.Status)
	}
	if refErr.RefUpdate == nil || refErr.RefUpdate.Branch != "main" {
		t.Fatalf("unexpected ref update")
	}
}

func TestCommitFromDiffIncludesUserAgentHeader(t *testing.T) {
	var headerAgent string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		headerAgent = r.Header.Get("Code-Storage-Agent")
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"commit":{"commit_sha":"useragent123","tree_sha":"tree456","target_branch":"main","pack_bytes":42,"blob_count":0},"result":{"branch":"main","old_sha":"0000000000000000000000000000000000000000","new_sha":"useragent123","success":true,"status":"ok"}}`))
	}))
	defer server.Close()

	client, err := NewClient(Options{Name: "acme", Key: testKey, APIBaseURL: server.URL})
	if err != nil {
		t.Fatalf("client error: %v", err)
	}
	repo := &Repo{ID: "repo", DefaultBranch: "main", client: client}

	_, err = repo.CreateCommitFromDiff(nil, CommitFromDiffOptions{
		TargetBranch:  "main",
		CommitMessage: "Test user agent",
		Author:        CommitSignature{Name: "Author Name", Email: "author@example.com"},
		Diff:          "diff --git a/test.txt b/test.txt\n",
	})
	if err != nil {
		t.Fatalf("commit from diff error: %v", err)
	}

	if headerAgent == "" || !strings.Contains(headerAgent, "code-storage-go-sdk/") {
		t.Fatalf("missing Code-Storage-Agent header")
	}
}
