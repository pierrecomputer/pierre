package storage

import (
	"bytes"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestCommitPackStreamsMetadataAndChunks(t *testing.T) {
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
		_, _ = w.Write([]byte(`{"commit":{"commit_sha":"abc123","tree_sha":"def456","target_branch":"main","pack_bytes":42,"blob_count":1},"result":{"branch":"main","old_sha":"0000000000000000000000000000000000000000","new_sha":"abc123","success":true,"status":"ok"}}`))
	}))
	defer server.Close()

	client, err := NewClient(Options{Name: "acme", Key: testKey, APIBaseURL: server.URL})
	if err != nil {
		t.Fatalf("client error: %v", err)
	}
	repo := &Repo{ID: "repo", DefaultBranch: "main", client: client}

	builder, err := repo.CreateCommit(CommitOptions{
		TargetBranch:  "main",
		CommitMessage: "Update docs",
		Author:        CommitSignature{Name: "Author Name", Email: "author@example.com"},
	})
	if err != nil {
		t.Fatalf("builder error: %v", err)
	}

	builder, err = builder.AddFileFromString("docs/readme.md", "# v2.0.1\n- add streaming SDK\n", nil)
	if err != nil {
		t.Fatalf("add file error: %v", err)
	}
	builder, err = builder.DeletePath("docs/old.txt")
	if err != nil {
		t.Fatalf("delete path error: %v", err)
	}

	result, err := builder.Send(nil)
	if err != nil {
		t.Fatalf("send error: %v", err)
	}

	if requestPath != "/api/v1/repos/commit-pack" {
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
	metadata, ok := metadataEnvelope["metadata"].(map[string]interface{})
	if !ok {
		t.Fatalf("missing metadata")
	}
	if metadata["commit_message"] != "Update docs" {
		t.Fatalf("unexpected commit_message: %#v", metadata["commit_message"])
	}
	if _, ok := metadata["ephemeral"]; ok {
		t.Fatalf("did not expect ephemeral in metadata")
	}
	if _, ok := metadata["ephemeral_base"]; ok {
		t.Fatalf("did not expect ephemeral_base in metadata")
	}

	files, ok := metadata["files"].([]interface{})
	if !ok || len(files) != 2 {
		t.Fatalf("expected two file entries")
	}

	var contentID string
	var sawUpsert bool
	var sawDelete bool
	for _, entry := range files {
		fileEntry, ok := entry.(map[string]interface{})
		if !ok {
			continue
		}
		switch fileEntry["operation"] {
		case "upsert":
			sawUpsert = true
			contentID, _ = fileEntry["content_id"].(string)
			if fileEntry["path"] != "docs/readme.md" {
				t.Fatalf("unexpected upsert path: %#v", fileEntry["path"])
			}
		case "delete":
			sawDelete = true
			if fileEntry["path"] != "docs/old.txt" {
				t.Fatalf("unexpected delete path: %#v", fileEntry["path"])
			}
		}
	}
	if !sawUpsert || !sawDelete {
		t.Fatalf("expected upsert and delete operations")
	}
	if contentID == "" {
		t.Fatalf("missing content_id")
	}

	var chunkEnvelope map[string]interface{}
	if err := json.Unmarshal([]byte(lines[1]), &chunkEnvelope); err != nil {
		t.Fatalf("decode chunk: %v", err)
	}
	chunk, ok := chunkEnvelope["blob_chunk"].(map[string]interface{})
	if !ok {
		t.Fatalf("missing blob_chunk")
	}
	if chunk["content_id"] != contentID {
		t.Fatalf("content_id mismatch")
	}
	if eof, _ := chunk["eof"].(bool); !eof {
		t.Fatalf("expected eof true")
	}
	data := decodeBase64(t, chunk["data"].(string))
	if string(data) != "# v2.0.1\n- add streaming SDK\n" {
		t.Fatalf("unexpected chunk data: %s", string(data))
	}

	if result.CommitSHA != "abc123" || result.TreeSHA != "def456" {
		t.Fatalf("unexpected result: %#v", result)
	}
	if result.RefUpdate.NewSHA != "abc123" {
		t.Fatalf("unexpected ref update")
	}
}

func TestCommitPackIncludesBaseBranch(t *testing.T) {
	var lines []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		lines = readNDJSONLines(t, r.Body)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"commit":{"commit_sha":"deadbeef","tree_sha":"cafebabe","target_branch":"feature/one","pack_bytes":1,"blob_count":0},"result":{"branch":"feature/one","old_sha":"0000000000000000000000000000000000000000","new_sha":"deadbeef","success":true,"status":"ok"}}`))
	}))
	defer server.Close()

	client, err := NewClient(Options{Name: "acme", Key: testKey, APIBaseURL: server.URL})
	if err != nil {
		t.Fatalf("client error: %v", err)
	}
	repo := &Repo{ID: "repo", DefaultBranch: "main", client: client}

	builder, err := repo.CreateCommit(CommitOptions{
		TargetBranch:    "feature/one",
		BaseBranch:      "main",
		ExpectedHeadSHA: "abc123",
		CommitMessage:   "branch off main",
		Author:          CommitSignature{Name: "Author Name", Email: "author@example.com"},
	})
	if err != nil {
		t.Fatalf("builder error: %v", err)
	}
	builder, err = builder.AddFileFromString("docs/base.txt", "hello", nil)
	if err != nil {
		t.Fatalf("add file error: %v", err)
	}
	if _, err := builder.Send(nil); err != nil {
		t.Fatalf("send error: %v", err)
	}

	if len(lines) == 0 {
		t.Fatalf("expected metadata line")
	}
	var metadataEnvelope map[string]interface{}
	if err := json.Unmarshal([]byte(lines[0]), &metadataEnvelope); err != nil {
		t.Fatalf("decode metadata: %v", err)
	}
	metadata := metadataEnvelope["metadata"].(map[string]interface{})
	if metadata["target_branch"] != "feature/one" {
		t.Fatalf("unexpected target_branch")
	}
	if metadata["expected_head_sha"] != "abc123" {
		t.Fatalf("unexpected expected_head_sha")
	}
	if metadata["base_branch"] != "main" {
		t.Fatalf("unexpected base_branch")
	}
}

func TestCommitPackIncludesBaseBranchWithoutExpectedHead(t *testing.T) {
	var lines []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		lines = readNDJSONLines(t, r.Body)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"commit":{"commit_sha":"abc123","tree_sha":"def456","target_branch":"feature/one","pack_bytes":1,"blob_count":1},"result":{"branch":"feature/one","old_sha":"0000000000000000000000000000000000000000","new_sha":"abc123","success":true,"status":"ok"}}`))
	}))
	defer server.Close()

	client, err := NewClient(Options{Name: "acme", Key: testKey, APIBaseURL: server.URL})
	if err != nil {
		t.Fatalf("client error: %v", err)
	}
	repo := &Repo{ID: "repo", DefaultBranch: "main", client: client}

	builder, err := repo.CreateCommit(CommitOptions{
		TargetBranch:  "feature/one",
		BaseBranch:    "main",
		CommitMessage: "branch off",
		Author:        CommitSignature{Name: "Author Name", Email: "author@example.com"},
	})
	if err != nil {
		t.Fatalf("builder error: %v", err)
	}
	builder, err = builder.AddFileFromString("docs/base.txt", "hello", nil)
	if err != nil {
		t.Fatalf("add file error: %v", err)
	}
	if _, err := builder.Send(nil); err != nil {
		t.Fatalf("send error: %v", err)
	}

	var metadataEnvelope map[string]interface{}
	if err := json.Unmarshal([]byte(lines[0]), &metadataEnvelope); err != nil {
		t.Fatalf("decode metadata: %v", err)
	}
	metadata := metadataEnvelope["metadata"].(map[string]interface{})
	if metadata["base_branch"] != "main" {
		t.Fatalf("unexpected base_branch")
	}
	if _, ok := metadata["expected_head_sha"]; ok {
		t.Fatalf("did not expect expected_head_sha")
	}
}

func TestCommitPackIncludesEphemeralFlags(t *testing.T) {
	var lines []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		lines = readNDJSONLines(t, r.Body)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"commit":{"commit_sha":"eph123","tree_sha":"eph456","target_branch":"feature/demo","pack_bytes":1,"blob_count":1},"result":{"branch":"feature/demo","old_sha":"0000000000000000000000000000000000000000","new_sha":"eph123","success":true,"status":"ok"}}`))
	}))
	defer server.Close()

	client, err := NewClient(Options{Name: "acme", Key: testKey, APIBaseURL: server.URL})
	if err != nil {
		t.Fatalf("client error: %v", err)
	}
	repo := &Repo{ID: "repo", DefaultBranch: "main", client: client}

	builder, err := repo.CreateCommit(CommitOptions{
		TargetBranch:  "feature/demo",
		BaseBranch:    "feature/base",
		Ephemeral:     true,
		EphemeralBase: true,
		CommitMessage: "ephemeral commit",
		Author:        CommitSignature{Name: "Author Name", Email: "author@example.com"},
	})
	if err != nil {
		t.Fatalf("builder error: %v", err)
	}
	builder, err = builder.AddFileFromString("docs/ephemeral.txt", "hello", nil)
	if err != nil {
		t.Fatalf("add file error: %v", err)
	}
	if _, err := builder.Send(nil); err != nil {
		t.Fatalf("send error: %v", err)
	}

	var metadataEnvelope map[string]interface{}
	if err := json.Unmarshal([]byte(lines[0]), &metadataEnvelope); err != nil {
		t.Fatalf("decode metadata: %v", err)
	}
	metadata := metadataEnvelope["metadata"].(map[string]interface{})
	if metadata["ephemeral"] != true || metadata["ephemeral_base"] != true {
		t.Fatalf("expected ephemeral flags")
	}
}

func TestCommitPackAcceptsReaderSources(t *testing.T) {
	var lines []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		lines = readNDJSONLines(t, r.Body)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"commit":{"commit_sha":"feedbeef","tree_sha":"c0ffee42","target_branch":"main","pack_bytes":128,"blob_count":2},"result":{"branch":"main","old_sha":"0000000000000000000000000000000000000000","new_sha":"feedbeef","success":true,"status":"ok"}}`))
	}))
	defer server.Close()

	client, err := NewClient(Options{Name: "acme", Key: testKey, APIBaseURL: server.URL})
	if err != nil {
		t.Fatalf("client error: %v", err)
	}
	repo := &Repo{ID: "repo", DefaultBranch: "main", client: client}

	builder, err := repo.CreateCommit(CommitOptions{
		TargetBranch:  "main",
		CommitMessage: "Add mixed sources",
		Author:        CommitSignature{Name: "Author Name", Email: "author@example.com"},
	})
	if err != nil {
		t.Fatalf("builder error: %v", err)
	}
	builder, err = builder.AddFile("assets/blob.bin", []byte("blob-payload"), nil)
	if err != nil {
		t.Fatalf("add file error: %v", err)
	}
	builder, err = builder.AddFile("assets/stream.bin", strings.NewReader("streamed-payload"), nil)
	if err != nil {
		t.Fatalf("add file error: %v", err)
	}
	if _, err := builder.Send(nil); err != nil {
		t.Fatalf("send error: %v", err)
	}

	var metadataEnvelope map[string]interface{}
	if err := json.Unmarshal([]byte(lines[0]), &metadataEnvelope); err != nil {
		t.Fatalf("decode metadata: %v", err)
	}
	metadata := metadataEnvelope["metadata"].(map[string]interface{})
	files := metadata["files"].([]interface{})
	if len(files) != 2 {
		t.Fatalf("expected two file entries")
	}

	contentIDs := make(map[string]string, 2)
	for _, entry := range files {
		fileEntry := entry.(map[string]interface{})
		path := fileEntry["path"].(string)
		contentIDs[path] = fileEntry["content_id"].(string)
	}

	chunkFrames := lines[1:]
	if len(chunkFrames) != 2 {
		t.Fatalf("expected two chunk frames")
	}
	decoded := map[string]string{}
	for _, frame := range chunkFrames {
		var envelope map[string]interface{}
		if err := json.Unmarshal([]byte(frame), &envelope); err != nil {
			t.Fatalf("decode chunk: %v", err)
		}
		chunk := envelope["blob_chunk"].(map[string]interface{})
		contentID := chunk["content_id"].(string)
		data := decodeBase64(t, chunk["data"].(string))
		decoded[contentID] = string(data)
	}

	if decoded[contentIDs["assets/blob.bin"]] != "blob-payload" {
		t.Fatalf("unexpected blob payload")
	}
	if decoded[contentIDs["assets/stream.bin"]] != "streamed-payload" {
		t.Fatalf("unexpected stream payload")
	}
}

func TestCommitPackSplitsLargePayloads(t *testing.T) {
	var lines []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		lines = readNDJSONLines(t, r.Body)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"commit":{"commit_sha":"chunk123","tree_sha":"tree456","target_branch":"main","pack_bytes":4194314,"blob_count":1},"result":{"branch":"main","old_sha":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","new_sha":"chunk123","success":true,"status":"ok"}}`))
	}))
	defer server.Close()

	client, err := NewClient(Options{Name: "acme", Key: testKey, APIBaseURL: server.URL})
	if err != nil {
		t.Fatalf("client error: %v", err)
	}
	repo := &Repo{ID: "repo", DefaultBranch: "main", client: client}

	payload := bytes.Repeat([]byte{'a'}, maxChunkBytes+10)
	builder, err := repo.CreateCommit(CommitOptions{
		TargetBranch:  "main",
		CommitMessage: "Large commit",
		Author:        CommitSignature{Name: "Author Name", Email: "author@example.com"},
	})
	if err != nil {
		t.Fatalf("builder error: %v", err)
	}
	builder, err = builder.AddFile("large.bin", payload, nil)
	if err != nil {
		t.Fatalf("add file error: %v", err)
	}
	if _, err := builder.Send(nil); err != nil {
		t.Fatalf("send error: %v", err)
	}

	if len(lines) != 3 {
		t.Fatalf("expected 3 ndjson lines, got %d", len(lines))
	}

	var firstChunk map[string]interface{}
	var secondChunk map[string]interface{}
	_ = json.Unmarshal([]byte(lines[1]), &firstChunk)
	_ = json.Unmarshal([]byte(lines[2]), &secondChunk)

	chunk1 := firstChunk["blob_chunk"].(map[string]interface{})
	chunk2 := secondChunk["blob_chunk"].(map[string]interface{})

	decoded1 := decodeBase64(t, chunk1["data"].(string))
	decoded2 := decodeBase64(t, chunk2["data"].(string))

	if len(decoded1) != maxChunkBytes {
		t.Fatalf("unexpected first chunk size: %d", len(decoded1))
	}
	if eof, _ := chunk1["eof"].(bool); eof {
		t.Fatalf("unexpected eof true for first chunk")
	}
	if len(decoded2) != 10 {
		t.Fatalf("unexpected second chunk size: %d", len(decoded2))
	}
	if eof, _ := chunk2["eof"].(bool); !eof {
		t.Fatalf("expected eof true for last chunk")
	}
}

func TestCommitPackMissingAuthor(t *testing.T) {
	client, err := NewClient(Options{Name: "acme", Key: testKey})
	if err != nil {
		t.Fatalf("client error: %v", err)
	}
	repo := &Repo{ID: "repo", DefaultBranch: "main", client: client}

	_, err = repo.CreateCommit(CommitOptions{
		TargetBranch:  "main",
		CommitMessage: "Missing author",
	})
	if err == nil || !strings.Contains(err.Error(), "author name and email are required") {
		t.Fatalf("expected missing author error, got %v", err)
	}
}

func TestCommitPackLegacyTargetRef(t *testing.T) {
	var lines []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		lines = readNDJSONLines(t, r.Body)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"commit":{"commit_sha":"legacy123","tree_sha":"legacy456","target_branch":"main","pack_bytes":0,"blob_count":0},"result":{"branch":"main","old_sha":"0000000000000000000000000000000000000000","new_sha":"legacy123","success":true,"status":"ok"}}`))
	}))
	defer server.Close()

	client, err := NewClient(Options{Name: "acme", Key: testKey, APIBaseURL: server.URL})
	if err != nil {
		t.Fatalf("client error: %v", err)
	}
	repo := &Repo{ID: "repo", DefaultBranch: "main", client: client}

	builder, err := repo.CreateCommit(CommitOptions{
		TargetRef:     "refs/heads/main",
		CommitMessage: "Legacy path",
		Author:        CommitSignature{Name: "Legacy Author", Email: "legacy@example.com"},
	})
	if err != nil {
		t.Fatalf("builder error: %v", err)
	}
	if _, err := builder.Send(nil); err != nil {
		t.Fatalf("send error: %v", err)
	}

	var metadataEnvelope map[string]interface{}
	if err := json.Unmarshal([]byte(lines[0]), &metadataEnvelope); err != nil {
		t.Fatalf("decode metadata: %v", err)
	}
	metadata := metadataEnvelope["metadata"].(map[string]interface{})
	if metadata["target_branch"] != "main" {
		t.Fatalf("unexpected target_branch: %#v", metadata["target_branch"])
	}
}

func TestCommitPackAcceptsBinaryBytes(t *testing.T) {
	var lines []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		lines = readNDJSONLines(t, r.Body)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"commit":{"commit_sha":"enc123","tree_sha":"treeenc","target_branch":"main","pack_bytes":12,"blob_count":1},"result":{"branch":"main","old_sha":"0000000000000000000000000000000000000000","new_sha":"enc123","success":true,"status":"ok"}}`))
	}))
	defer server.Close()

	client, err := NewClient(Options{Name: "acme", Key: testKey, APIBaseURL: server.URL})
	if err != nil {
		t.Fatalf("client error: %v", err)
	}
	repo := &Repo{ID: "repo", DefaultBranch: "main", client: client}

	payload := []byte{0xa1, 'H', 'o', 'l', 'a', '!'}
	builder, err := repo.CreateCommit(CommitOptions{
		TargetBranch:  "main",
		CommitMessage: "Add greeting",
		Author:        CommitSignature{Name: "Author Name", Email: "author@example.com"},
	})
	if err != nil {
		t.Fatalf("builder error: %v", err)
	}
	builder, err = builder.AddFile("docs/hola.txt", payload, nil)
	if err != nil {
		t.Fatalf("add file error: %v", err)
	}
	if _, err := builder.Send(nil); err != nil {
		t.Fatalf("send error: %v", err)
	}

	var chunkEnvelope map[string]interface{}
	if err := json.Unmarshal([]byte(lines[1]), &chunkEnvelope); err != nil {
		t.Fatalf("decode chunk: %v", err)
	}
	chunk := chunkEnvelope["blob_chunk"].(map[string]interface{})
	decoded := decodeBase64(t, chunk["data"].(string))
	if !bytes.Equal(decoded, payload) {
		t.Fatalf("unexpected binary payload")
	}
}

func TestCommitPackHonorsTTL(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		token := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
		claims := parseJWTFromToken(t, token)
		exp := int64(claims["exp"].(float64))
		iat := int64(claims["iat"].(float64))
		if exp-iat != 4321 {
			t.Fatalf("expected ttl 4321, got %d", exp-iat)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"commit":{"commit_sha":"legacy123","tree_sha":"treetree","target_branch":"main","pack_bytes":16,"blob_count":1},"result":{"branch":"main","old_sha":"0000000000000000000000000000000000000000","new_sha":"legacy123","success":true,"status":"ok"}}`))
	}))
	defer server.Close()

	client, err := NewClient(Options{Name: "acme", Key: testKey, APIBaseURL: server.URL})
	if err != nil {
		t.Fatalf("client error: %v", err)
	}
	repo := &Repo{ID: "repo", DefaultBranch: "main", client: client}

	builder, err := repo.CreateCommit(CommitOptions{
		InvocationOptions: InvocationOptions{TTL: 4321 * time.Second},
		TargetBranch:      "main",
		CommitMessage:     "Legacy ttl commit",
		Author:            CommitSignature{Name: "Author Name", Email: "author@example.com"},
	})
	if err != nil {
		t.Fatalf("builder error: %v", err)
	}
	builder, err = builder.AddFileFromString("docs/legacy.txt", "legacy ttl content", nil)
	if err != nil {
		t.Fatalf("add file error: %v", err)
	}
	if _, err := builder.Send(nil); err != nil {
		t.Fatalf("send error: %v", err)
	}
}

func TestCommitPackRejectsBaseBranchWithRefsPrefix(t *testing.T) {
	client, err := NewClient(Options{Name: "acme", Key: testKey})
	if err != nil {
		t.Fatalf("client error: %v", err)
	}
	repo := &Repo{ID: "repo", DefaultBranch: "main", client: client}

	_, err = repo.CreateCommit(CommitOptions{
		TargetBranch:    "feature/two",
		BaseBranch:      "refs/heads/main",
		ExpectedHeadSHA: "abc123",
		CommitMessage:   "branch",
		Author:          CommitSignature{Name: "Author Name", Email: "author@example.com"},
	})
	if err == nil || !strings.Contains(err.Error(), "baseBranch must not include refs/") {
		t.Fatalf("expected baseBranch validation error, got %v", err)
	}
}

func TestCommitPackReturnsRefUpdateErrorOnFailure(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"commit":{"commit_sha":"deadbeef","tree_sha":"feedbabe","target_branch":"main","pack_bytes":0,"blob_count":0},"result":{"branch":"main","old_sha":"1234567890123456789012345678901234567890","new_sha":"deadbeef","success":false,"status":"precondition_failed","message":"base mismatch"}}`))
	}))
	defer server.Close()

	client, err := NewClient(Options{Name: "acme", Key: testKey, APIBaseURL: server.URL})
	if err != nil {
		t.Fatalf("client error: %v", err)
	}
	repo := &Repo{ID: "repo", DefaultBranch: "main", client: client}

	builder, err := repo.CreateCommit(CommitOptions{
		TargetBranch:  "main",
		CommitMessage: "bad commit",
		Author:        CommitSignature{Name: "Author Name", Email: "author@example.com"},
	})
	if err != nil {
		t.Fatalf("builder error: %v", err)
	}
	builder, err = builder.AddFileFromString("docs/readme.md", "oops", nil)
	if err != nil {
		t.Fatalf("add file error: %v", err)
	}
	_, err = builder.Send(nil)
	if err == nil {
		t.Fatalf("expected error")
	}
	var refErr *RefUpdateError
	if !errors.As(err, &refErr) {
		t.Fatalf("expected RefUpdateError, got %T", err)
	}
}
