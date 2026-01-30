package storage

import (
	"bufio"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestCommitPackRequest(t *testing.T) {
	var requestPath string
	var headerAgent string
	var lines []string

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestPath = r.URL.Path
		headerAgent = r.Header.Get("Code-Storage-Agent")
		scanner := bufio.NewScanner(r.Body)
		for scanner.Scan() {
			lines = append(lines, scanner.Text())
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"commit":{"commit_sha":"abc","tree_sha":"def","target_branch":"main","pack_bytes":10,"blob_count":1},"result":{"branch":"main","old_sha":"old","new_sha":"new","success":true,"status":"ok"}}`))
	}))
	defer server.Close()

	client, err := NewClient(Options{Name: "acme", Key: testKey, APIBaseURL: server.URL})
	if err != nil {
		t.Fatalf("client error: %v", err)
	}
	repo := &Repo{ID: "repo", DefaultBranch: "main", client: client}

	builder, err := repo.CreateCommit(CommitOptions{
		TargetBranch:  "main",
		CommitMessage: "test",
		Author:        CommitSignature{Name: "Tester", Email: "test@example.com"},
	})
	if err != nil {
		t.Fatalf("builder error: %v", err)
	}

	builder, err = builder.AddFileFromString("README.md", "hello", nil)
	if err != nil {
		t.Fatalf("add file error: %v", err)
	}

	_, err = builder.Send(nil)
	if err != nil {
		t.Fatalf("send error: %v", err)
	}

	if requestPath != "/api/v1/repos/commit-pack" {
		t.Fatalf("unexpected path: %s", requestPath)
	}
	if headerAgent == "" || !strings.Contains(headerAgent, "code-storage-go-sdk/") {
		t.Fatalf("missing Code-Storage-Agent header")
	}
	if len(lines) < 1 {
		t.Fatalf("expected ndjson lines")
	}

	var first map[string]interface{}
	if err := json.Unmarshal([]byte(lines[0]), &first); err != nil {
		t.Fatalf("decode first line: %v", err)
	}
	metadata, ok := first["metadata"].(map[string]interface{})
	if !ok {
		t.Fatalf("missing metadata")
	}
	if metadata["target_branch"] != "main" {
		t.Fatalf("unexpected metadata target_branch")
	}
}

func TestCommitFromDiffRequest(t *testing.T) {
	var requestPath string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestPath = r.URL.Path
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"commit":{"commit_sha":"abc","tree_sha":"def","target_branch":"main","pack_bytes":10,"blob_count":1},"result":{"branch":"main","old_sha":"old","new_sha":"new","success":true,"status":"ok"}}`))
	}))
	defer server.Close()

	client, err := NewClient(Options{Name: "acme", Key: testKey, APIBaseURL: server.URL})
	if err != nil {
		t.Fatalf("client error: %v", err)
	}
	repo := &Repo{ID: "repo", DefaultBranch: "main", client: client}

	_, err = repo.CreateCommitFromDiff(nil, CommitFromDiffOptions{
		TargetBranch:  "main",
		CommitMessage: "test",
		Author:        CommitSignature{Name: "Tester", Email: "test@example.com"},
		Diff:          "diff content",
	})
	if err != nil {
		t.Fatalf("commit from diff error: %v", err)
	}
	if requestPath != "/api/v1/repos/diff-commit" {
		t.Fatalf("unexpected path: %s", requestPath)
	}
}
