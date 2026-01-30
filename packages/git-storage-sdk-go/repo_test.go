package storage

import (
	"encoding/json"
	"errors"
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

func TestRemoteURLPermissionsAndTTL(t *testing.T) {
	client, err := NewClient(Options{Name: "acme", Key: testKey, StorageBaseURL: "acme.code.storage"})
	if err != nil {
		t.Fatalf("client error: %v", err)
	}
	repo := &Repo{ID: "repo-1", DefaultBranch: "main", client: client}

	remote, err := repo.RemoteURL(nil, RemoteURLOptions{
		Permissions: []Permission{PermissionGitRead},
		TTL:         2 * time.Hour,
	})
	if err != nil {
		t.Fatalf("remote url error: %v", err)
	}
	claims := parseJWTFromURL(t, remote)
	if claims["repo"] != "repo-1" {
		t.Fatalf("expected repo claim")
	}
	scopes, ok := claims["scopes"].([]interface{})
	if !ok || len(scopes) != 1 || scopes[0] != "git:read" {
		t.Fatalf("unexpected scopes")
	}
	exp := int64(claims["exp"].(float64))
	iat := int64(claims["iat"].(float64))
	if exp-iat != int64((2*time.Hour)/time.Second) {
		t.Fatalf("unexpected ttl")
	}
}

func TestRemoteURLDefaultTTL(t *testing.T) {
	client, err := NewClient(Options{Name: "acme", Key: testKey, StorageBaseURL: "acme.code.storage"})
	if err != nil {
		t.Fatalf("client error: %v", err)
	}
	repo := &Repo{ID: "repo-1", DefaultBranch: "main", client: client}

	remote, err := repo.RemoteURL(nil, RemoteURLOptions{})
	if err != nil {
		t.Fatalf("remote url error: %v", err)
	}
	claims := parseJWTFromURL(t, remote)
	scopes, ok := claims["scopes"].([]interface{})
	if !ok || len(scopes) != 2 {
		t.Fatalf("unexpected scopes")
	}
	if scopes[0] != "git:write" || scopes[1] != "git:read" {
		t.Fatalf("unexpected default scopes")
	}
	exp := int64(claims["exp"].(float64))
	iat := int64(claims["iat"].(float64))
	if exp-iat != int64((365*24*time.Hour)/time.Second) {
		t.Fatalf("unexpected default ttl")
	}
}

func TestListFilesTTL(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		token := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
		claims := parseJWTFromToken(t, token)
		exp := int64(claims["exp"].(float64))
		iat := int64(claims["iat"].(float64))
		if exp-iat != 900 {
			t.Fatalf("expected ttl 900, got %d", exp-iat)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"paths":[],"ref":"main"}`))
	}))
	defer server.Close()

	client, err := NewClient(Options{Name: "acme", Key: testKey, APIBaseURL: server.URL})
	if err != nil {
		t.Fatalf("client error: %v", err)
	}
	repo := &Repo{ID: "repo", DefaultBranch: "main", client: client}

	_, err = repo.ListFiles(nil, ListFilesOptions{InvocationOptions: InvocationOptions{TTL: 900 * time.Second}})
	if err != nil {
		t.Fatalf("list files error: %v", err)
	}
}

func TestGrepResponseParsing(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"query":{"pattern":"SEARCHME","case_sensitive":false},"repo":{"ref":"main","commit":"deadbeef"},"matches":[{"path":"src/a.ts","lines":[{"line_number":12,"text":"SEARCHME","type":"match"}]}],"has_more":false}`))
	}))
	defer server.Close()

	client, err := NewClient(Options{Name: "acme", Key: testKey, APIBaseURL: server.URL})
	if err != nil {
		t.Fatalf("client error: %v", err)
	}
	repo := &Repo{ID: "repo", DefaultBranch: "main", client: client}

	result, err := repo.Grep(nil, GrepOptions{
		Ref:   "main",
		Paths: []string{"src/"},
		Query: GrepQuery{Pattern: "SEARCHME", CaseSensitive: boolPtr(false)},
		Context: &GrepContext{
			Before: intPtr(1),
			After:  intPtr(2),
		},
		Limits: &GrepLimits{
			MaxLines:          intPtr(5),
			MaxMatchesPerFile: intPtr(7),
		},
		Pagination: &GrepPagination{
			Cursor: "abc",
			Limit:  intPtr(3),
		},
		FileFilters: &GrepFileFilters{
			IncludeGlobs: []string{"**/*.ts"},
			ExcludeGlobs: []string{"**/vendor/**"},
		},
	})
	if err != nil {
		t.Fatalf("grep error: %v", err)
	}
	if result.Query.Pattern != "SEARCHME" || result.Query.CaseSensitive == nil || *result.Query.CaseSensitive != false {
		t.Fatalf("unexpected grep query")
	}
	if result.Repo.Commit != "deadbeef" {
		t.Fatalf("unexpected repo commit")
	}
	if len(result.Matches) != 1 || result.Matches[0].Path != "src/a.ts" {
		t.Fatalf("unexpected grep matches")
	}
}

func TestCreateBranchPayloadAndResponse(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		headerAgent := r.Header.Get("Code-Storage-Agent")
		if headerAgent == "" || !strings.Contains(headerAgent, "code-storage-go-sdk/") {
			t.Fatalf("missing Code-Storage-Agent header")
		}
		var body createBranchRequest
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatalf("decode body: %v", err)
		}
		if body.BaseBranch != "main" || body.TargetBranch != "feature/demo" {
			t.Fatalf("unexpected branch payload")
		}
		if !body.BaseIsEphemeral || !body.TargetIsEphemeral {
			t.Fatalf("expected ephemeral flags")
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"message":"branch created","target_branch":"feature/demo","target_is_ephemeral":true,"commit_sha":"abc123"}`))
	}))
	defer server.Close()

	client, err := NewClient(Options{Name: "acme", Key: testKey, APIBaseURL: server.URL})
	if err != nil {
		t.Fatalf("client error: %v", err)
	}
	repo := &Repo{ID: "repo", DefaultBranch: "main", client: client}

	result, err := repo.CreateBranch(nil, CreateBranchOptions{
		BaseBranch:        "main",
		TargetBranch:      "feature/demo",
		BaseIsEphemeral:   true,
		TargetIsEphemeral: true,
	})
	if err != nil {
		t.Fatalf("create branch error: %v", err)
	}
	if result.TargetBranch != "feature/demo" || result.CommitSHA != "abc123" {
		t.Fatalf("unexpected create branch result")
	}
}

func TestRestoreCommitSuccess(t *testing.T) {
	var capturedBody map[string]interface{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewDecoder(r.Body).Decode(&capturedBody)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"commit":{"commit_sha":"abcdef0123456789abcdef0123456789abcdef01","tree_sha":"fedcba9876543210fedcba9876543210fedcba98","target_branch":"main","pack_bytes":1024},"result":{"branch":"main","old_sha":"0123456789abcdef0123456789abcdef01234567","new_sha":"89abcdef0123456789abcdef0123456789abcdef","success":true,"status":"ok"}}`))
	}))
	defer server.Close()

	client, err := NewClient(Options{Name: "acme", Key: testKey, APIBaseURL: server.URL})
	if err != nil {
		t.Fatalf("client error: %v", err)
	}
	repo := &Repo{ID: "repo", DefaultBranch: "main", client: client}

	response, err := repo.RestoreCommit(nil, RestoreCommitOptions{
		TargetBranch:    "main",
		ExpectedHeadSHA: "main",
		TargetCommitSHA: "0123456789abcdef0123456789abcdef01234567",
		CommitMessage:   "Restore \"feature\"",
		Author: CommitSignature{
			Name:  "Author Name",
			Email: "author@example.com",
		},
		Committer: &CommitSignature{
			Name:  "Committer Name",
			Email: "committer@example.com",
		},
	})
	if err != nil {
		t.Fatalf("restore commit error: %v", err)
	}
	if response.CommitSHA != "abcdef0123456789abcdef0123456789abcdef01" {
		t.Fatalf("unexpected commit sha")
	}

	metadataEnvelope, ok := capturedBody["metadata"].(map[string]interface{})
	if !ok {
		t.Fatalf("missing metadata envelope")
	}
	if metadataEnvelope["target_branch"] != "main" {
		t.Fatalf("unexpected target_branch")
	}
}

func TestRestoreCommitPreconditionFailed(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusPreconditionFailed)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"commit":null,"result":{"success":false,"status":"precondition_failed","message":"expected head SHA mismatch"}}`))
	}))
	defer server.Close()

	client, err := NewClient(Options{Name: "acme", Key: testKey, APIBaseURL: server.URL})
	if err != nil {
		t.Fatalf("client error: %v", err)
	}
	repo := &Repo{ID: "repo", DefaultBranch: "main", client: client}

	_, err = repo.RestoreCommit(nil, RestoreCommitOptions{
		TargetBranch:    "main",
		ExpectedHeadSHA: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
		TargetCommitSHA: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
		Author:          CommitSignature{Name: "Author", Email: "author@example.com"},
	})
	if err == nil {
		t.Fatalf("expected error")
	}
	var refErr *RefUpdateError
	if !errors.As(err, &refErr) {
		t.Fatalf("expected RefUpdateError, got %T", err)
	}
	if refErr.Status != "precondition_failed" {
		t.Fatalf("unexpected status: %s", refErr.Status)
	}
}

func TestRestoreCommitNotFound(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"error":"not found"}`))
	}))
	defer server.Close()

	client, err := NewClient(Options{Name: "acme", Key: testKey, APIBaseURL: server.URL})
	if err != nil {
		t.Fatalf("client error: %v", err)
	}
	repo := &Repo{ID: "repo", DefaultBranch: "main", client: client}

	_, err = repo.RestoreCommit(nil, RestoreCommitOptions{
		TargetBranch:    "main",
		TargetCommitSHA: "0123456789abcdef0123456789abcdef01234567",
		Author:          CommitSignature{Name: "Author Name", Email: "author@example.com"},
	})
	if err == nil || !strings.Contains(err.Error(), "HTTP 404") {
		t.Fatalf("expected HTTP 404 error, got %v", err)
	}
}

func TestNoteWriteAppendAndDelete(t *testing.T) {
	var requests []map[string]interface{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var payload map[string]interface{}
		_ = json.NewDecoder(r.Body).Decode(&payload)
		requests = append(requests, payload)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"sha":"abc","target_ref":"refs/notes/commits","new_ref_sha":"def","result":{"success":true,"status":"ok"}}`))
	}))
	defer server.Close()

	client, err := NewClient(Options{Name: "acme", Key: testKey, APIBaseURL: server.URL})
	if err != nil {
		t.Fatalf("client error: %v", err)
	}
	repo := &Repo{ID: "repo", DefaultBranch: "main", client: client}

	if _, err := repo.AppendNote(nil, AppendNoteOptions{SHA: "abc", Note: "note append"}); err != nil {
		t.Fatalf("append note error: %v", err)
	}
	if _, err := repo.DeleteNote(nil, DeleteNoteOptions{SHA: "abc"}); err != nil {
		t.Fatalf("delete note error: %v", err)
	}

	if len(requests) != 2 {
		t.Fatalf("expected two note requests")
	}
	if requests[0]["action"] != "append" {
		t.Fatalf("expected append action")
	}
	if _, ok := requests[1]["action"]; ok {
		t.Fatalf("did not expect action for delete")
	}
}

func TestGetNote(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		if q.Get("sha") != "abc123" {
			t.Fatalf("unexpected sha query: %s", q.Get("sha"))
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"sha":"abc123","note":"hello notes","ref_sha":"def456"}`))
	}))
	defer server.Close()

	client, err := NewClient(Options{Name: "acme", Key: testKey, APIBaseURL: server.URL})
	if err != nil {
		t.Fatalf("client error: %v", err)
	}
	repo := &Repo{ID: "repo", DefaultBranch: "main", client: client}

	result, err := repo.GetNote(nil, GetNoteOptions{SHA: "abc123"})
	if err != nil {
		t.Fatalf("get note error: %v", err)
	}
	if result.Note != "hello notes" || result.RefSHA != "def456" {
		t.Fatalf("unexpected note result")
	}
}

func TestFileStreamEphemeral(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		if q.Get("path") != "docs/readme.md" {
			t.Fatalf("unexpected path")
		}
		if q.Get("ref") != "feature/demo" {
			t.Fatalf("unexpected ref")
		}
		if q.Get("ephemeral") != "true" {
			t.Fatalf("unexpected ephemeral")
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{}`))
	}))
	defer server.Close()

	client, err := NewClient(Options{Name: "acme", Key: testKey, APIBaseURL: server.URL})
	if err != nil {
		t.Fatalf("client error: %v", err)
	}
	repo := &Repo{ID: "repo", DefaultBranch: "main", client: client}

	flag := true
	resp, err := repo.FileStream(nil, GetFileOptions{Path: "docs/readme.md", Ref: "feature/demo", Ephemeral: &flag})
	if err != nil {
		t.Fatalf("file stream error: %v", err)
	}
	_ = resp.Body.Close()
}

func TestFileStreamEphemeralBase(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		if q.Get("ephemeral_base") != "true" {
			t.Fatalf("unexpected ephemeral_base")
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{}`))
	}))
	defer server.Close()

	client, err := NewClient(Options{Name: "acme", Key: testKey, APIBaseURL: server.URL})
	if err != nil {
		t.Fatalf("client error: %v", err)
	}
	repo := &Repo{ID: "repo", DefaultBranch: "main", client: client}

	flag := true
	resp, err := repo.FileStream(nil, GetFileOptions{Path: "docs/readme.md", EphemeralBase: &flag})
	if err != nil {
		t.Fatalf("file stream error: %v", err)
	}
	_ = resp.Body.Close()
}

func TestListCommitsDateParsing(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"commits":[{"sha":"abc123","message":"feat: add endpoint","author_name":"Jane Doe","author_email":"jane@example.com","committer_name":"Jane Doe","committer_email":"jane@example.com","date":"2024-01-15T14:32:18Z"}],"has_more":false}`))
	}))
	defer server.Close()

	client, err := NewClient(Options{Name: "acme", Key: testKey, APIBaseURL: server.URL})
	if err != nil {
		t.Fatalf("client error: %v", err)
	}
	repo := &Repo{ID: "repo", DefaultBranch: "main", client: client}

	result, err := repo.ListCommits(nil, ListCommitsOptions{})
	if err != nil {
		t.Fatalf("list commits error: %v", err)
	}
	if len(result.Commits) != 1 {
		t.Fatalf("expected one commit")
	}
	commit := result.Commits[0]
	if commit.RawDate != "2024-01-15T14:32:18Z" {
		t.Fatalf("unexpected raw date")
	}
	if commit.Date.IsZero() {
		t.Fatalf("expected parsed date")
	}
}

func TestListCommitsUserAgentHeader(t *testing.T) {
	var headerAgent string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		headerAgent = r.Header.Get("Code-Storage-Agent")
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"commits":[],"has_more":false}`))
	}))
	defer server.Close()

	client, err := NewClient(Options{Name: "acme", Key: testKey, APIBaseURL: server.URL})
	if err != nil {
		t.Fatalf("client error: %v", err)
	}
	repo := &Repo{ID: "repo", DefaultBranch: "main", client: client}

	_, err = repo.ListCommits(nil, ListCommitsOptions{})
	if err != nil {
		t.Fatalf("list commits error: %v", err)
	}
	if headerAgent == "" || !strings.Contains(headerAgent, "code-storage-go-sdk/") {
		t.Fatalf("missing Code-Storage-Agent header")
	}
}

func intPtr(value int) *int {
	return &value
}
