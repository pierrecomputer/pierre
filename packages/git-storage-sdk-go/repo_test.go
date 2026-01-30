package storage

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestRemoteURLJWT(t *testing.T) {
	client, err := NewClient(Options{Name: "acme", Key: testKey, StorageBaseURL: "acme.code.storage"})
	if err != nil {
		t.Fatalf("client error: %v", err)
	}
	repo := &Repo{ID: "repo-1", DefaultBranch: "main", client: client}

	remote, err := repo.RemoteURL(nil, RemoteURLOptions{})
	if err != nil {
		t.Fatalf("remote url error: %v", err)
	}
	if !strings.Contains(remote, "repo-1.git") {
		t.Fatalf("expected repo in url: %s", remote)
	}
	claims := parseJWTFromURL(t, remote)
	if claims["repo"] != "repo-1" {
		t.Fatalf("expected repo claim")
	}
}

func TestEphemeralRemoteURL(t *testing.T) {
	client, err := NewClient(Options{Name: "acme", Key: testKey, StorageBaseURL: "acme.code.storage"})
	if err != nil {
		t.Fatalf("client error: %v", err)
	}
	repo := &Repo{ID: "repo-1", DefaultBranch: "main", client: client}

	remote, err := repo.EphemeralRemoteURL(nil, RemoteURLOptions{})
	if err != nil {
		t.Fatalf("remote url error: %v", err)
	}
	if !strings.Contains(remote, "repo-1+ephemeral.git") {
		t.Fatalf("expected ephemeral url: %s", remote)
	}
}

func TestListFilesEphemeral(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		if q.Get("ref") != "feature/demo" || q.Get("ephemeral") != "true" {
			t.Fatalf("unexpected query: %s", r.URL.RawQuery)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"paths":["docs/readme.md"],"ref":"refs/namespaces/ephemeral/refs/heads/feature/demo"}`))
	}))
	defer server.Close()

	client, err := NewClient(Options{Name: "acme", Key: testKey, APIBaseURL: server.URL})
	if err != nil {
		t.Fatalf("client error: %v", err)
	}
	repo := &Repo{ID: "repo", DefaultBranch: "main", client: client}

	flag := true
	result, err := repo.ListFiles(nil, ListFilesOptions{Ref: "feature/demo", Ephemeral: &flag})
	if err != nil {
		t.Fatalf("list files error: %v", err)
	}
	if result.Ref == "" || len(result.Paths) != 1 {
		t.Fatalf("unexpected result")
	}
}

func TestGrepRequestBody(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]interface{}
		_ = json.NewDecoder(r.Body).Decode(&body)
		if body["rev"] != "main" {
			t.Fatalf("expected rev main")
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"query":{"pattern":"SEARCH","case_sensitive":false},"repo":{"ref":"main","commit":"deadbeef"},"matches":[],"has_more":false}`))
	}))
	defer server.Close()

	client, err := NewClient(Options{Name: "acme", Key: testKey, APIBaseURL: server.URL})
	if err != nil {
		t.Fatalf("client error: %v", err)
	}
	repo := &Repo{ID: "repo", DefaultBranch: "main", client: client}

	_, err = repo.Grep(nil, GrepOptions{
		Ref:   "main",
		Paths: []string{"src/"},
		Query: GrepQuery{Pattern: "SEARCH", CaseSensitive: boolPtr(false)},
	})
	if err != nil {
		t.Fatalf("grep error: %v", err)
	}
}

func TestCreateBranchTTL(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		token := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
		claims := parseJWTFromToken(t, token)
		exp := int64(claims["exp"].(float64))
		iat := int64(claims["iat"].(float64))
		if exp-iat != 600 {
			t.Fatalf("expected ttl 600, got %d", exp-iat)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"message":"branch created","target_branch":"feature/demo","target_is_ephemeral":false}`))
	}))
	defer server.Close()

	client, err := NewClient(Options{Name: "acme", Key: testKey, APIBaseURL: server.URL})
	if err != nil {
		t.Fatalf("client error: %v", err)
	}
	repo := &Repo{ID: "repo", DefaultBranch: "main", client: client}

	_, err = repo.CreateBranch(nil, CreateBranchOptions{BaseBranch: "main", TargetBranch: "feature/demo", InvocationOptions: InvocationOptions{TTL: 600 * time.Second}})
	if err != nil {
		t.Fatalf("create branch error: %v", err)
	}
}

func TestRestoreCommitConflict(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusConflict)
		payload := map[string]interface{}{
			"commit": map[string]interface{}{
				"commit_sha":    "cafefeed",
				"tree_sha":      "feedface",
				"target_branch": "main",
				"pack_bytes":    0,
			},
			"result": map[string]interface{}{
				"branch":  "main",
				"old_sha": "old",
				"new_sha": "new",
				"success": false,
				"status":  "precondition_failed",
				"message": "branch moved",
			},
		}
		_ = json.NewEncoder(w).Encode(payload)
	}))
	defer server.Close()

	client, err := NewClient(Options{Name: "acme", Key: testKey, APIBaseURL: server.URL})
	if err != nil {
		t.Fatalf("client error: %v", err)
	}
	repo := &Repo{ID: "repo", DefaultBranch: "main", client: client}

	_, err = repo.RestoreCommit(nil, RestoreCommitOptions{
		TargetBranch:    "main",
		TargetCommitSHA: "abc",
		Author:          CommitSignature{Name: "Author", Email: "author@example.com"},
	})
	if err == nil {
		t.Fatalf("expected error")
	}
	if !strings.Contains(err.Error(), "branch moved") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestNoteWritePayload(t *testing.T) {
	var captured []byte
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		captured, _ = io.ReadAll(r.Body)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"sha":"abc","target_ref":"refs/notes/commits","new_ref_sha":"def","result":{"success":true,"status":"ok"}}`))
	}))
	defer server.Close()

	client, err := NewClient(Options{Name: "acme", Key: testKey, APIBaseURL: server.URL})
	if err != nil {
		t.Fatalf("client error: %v", err)
	}
	repo := &Repo{ID: "repo", DefaultBranch: "main", client: client}

	_, err = repo.CreateNote(nil, CreateNoteOptions{SHA: "abc", Note: "note"})
	if err != nil {
		t.Fatalf("create note error: %v", err)
	}

	var payload map[string]interface{}
	_ = json.Unmarshal(captured, &payload)
	if payload["action"] != "add" {
		t.Fatalf("expected add action")
	}
}

func TestCommitDiffQuery(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		if q.Get("sha") != "abc" || q.Get("baseSha") != "base" {
			t.Fatalf("unexpected query: %s", r.URL.RawQuery)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"sha":"abc","stats":{"files":1,"additions":1,"deletions":0,"changes":1},"files":[],"filtered_files":[]}`))
	}))
	defer server.Close()

	client, err := NewClient(Options{Name: "acme", Key: testKey, APIBaseURL: server.URL})
	if err != nil {
		t.Fatalf("client error: %v", err)
	}
	repo := &Repo{ID: "repo", DefaultBranch: "main", client: client}

	_, err = repo.GetCommitDiff(nil, GetCommitDiffOptions{SHA: "abc", BaseSHA: "base"})
	if err != nil {
		t.Fatalf("commit diff error: %v", err)
	}
}

func boolPtr(value bool) *bool {
	return &value
}
