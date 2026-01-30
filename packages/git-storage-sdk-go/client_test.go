package storage

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestNewClientValidation(t *testing.T) {
	_, err := NewClient(Options{})
	if err == nil || !strings.Contains(err.Error(), "requires a name and key") {
		t.Fatalf("expected validation error, got %v", err)
	}
	_, err = NewClient(Options{Name: "", Key: "test"})
	if err == nil {
		t.Fatalf("expected error for empty name")
	}
	_, err = NewClient(Options{Name: "test", Key: ""})
	if err == nil {
		t.Fatalf("expected error for empty key")
	}
}

func TestDefaultBaseURLs(t *testing.T) {
	api := DefaultAPIBaseURL("acme")
	if api != "https://api.acme.code.storage" {
		t.Fatalf("unexpected api url: %s", api)
	}
	storage := DefaultStorageBaseURL("acme")
	if storage != "acme.code.storage" {
		t.Fatalf("unexpected storage url: %s", storage)
	}
}

func TestCreateRepoDefaultBranch(t *testing.T) {
	var receivedBody map[string]interface{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/repos" {
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
		decoder := json.NewDecoder(r.Body)
		_ = decoder.Decode(&receivedBody)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"repo_id":"repo","url":"https://repo.git"}`))
	}))
	defer server.Close()

	client, err := NewClient(Options{Name: "acme", Key: testKey, APIBaseURL: server.URL})
	if err != nil {
		t.Fatalf("client error: %v", err)
	}

	_, err = client.CreateRepo(nil, CreateRepoOptions{})
	if err != nil {
		t.Fatalf("create repo error: %v", err)
	}

	if receivedBody["default_branch"] != "main" {
		t.Fatalf("expected default_branch main, got %#v", receivedBody["default_branch"])
	}
}

func TestCreateRepoForkBaseRepo(t *testing.T) {
	var receivedBody map[string]interface{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		decoder := json.NewDecoder(r.Body)
		_ = decoder.Decode(&receivedBody)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"repo_id":"repo","url":"https://repo.git"}`))
	}))
	defer server.Close()

	client, err := NewClient(Options{Name: "acme", Key: testKey, APIBaseURL: server.URL})
	if err != nil {
		t.Fatalf("client error: %v", err)
	}

	_, err = client.CreateRepo(nil, CreateRepoOptions{
		BaseRepo: ForkBaseRepo{ID: "template", Ref: "main"},
	})
	if err != nil {
		t.Fatalf("create repo error: %v", err)
	}

	baseRepo, ok := receivedBody["base_repo"].(map[string]interface{})
	if !ok {
		t.Fatalf("expected base_repo payload")
	}
	if baseRepo["provider"] != "code" {
		t.Fatalf("expected provider code")
	}
	if baseRepo["name"] != "template" {
		t.Fatalf("expected name template")
	}
	auth, ok := baseRepo["auth"].(map[string]interface{})
	if !ok || auth["token"] == "" {
		t.Fatalf("expected auth token")
	}
}

func TestCreateRepoGitHubBaseRepoDefaultBranch(t *testing.T) {
	var receivedBody map[string]interface{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		decoder := json.NewDecoder(r.Body)
		_ = decoder.Decode(&receivedBody)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"repo_id":"repo","url":"https://repo.git"}`))
	}))
	defer server.Close()

	client, err := NewClient(Options{Name: "acme", Key: testKey, APIBaseURL: server.URL})
	if err != nil {
		t.Fatalf("client error: %v", err)
	}

	_, err = client.CreateRepo(nil, CreateRepoOptions{
		BaseRepo: GitHubBaseRepo{
			Owner:         "octocat",
			Name:          "hello-world",
			DefaultBranch: "main",
		},
	})
	if err != nil {
		t.Fatalf("create repo error: %v", err)
	}

	baseRepo, ok := receivedBody["base_repo"].(map[string]interface{})
	if !ok {
		t.Fatalf("expected base_repo payload")
	}
	if baseRepo["provider"] != "github" {
		t.Fatalf("expected provider github")
	}
	if baseRepo["default_branch"] != "main" {
		t.Fatalf("expected default_branch main")
	}
	if receivedBody["default_branch"] != "main" {
		t.Fatalf("expected default_branch main in request")
	}
}

func TestCreateRepoGitHubBaseRepoCustomDefaultBranch(t *testing.T) {
	var receivedBody map[string]interface{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		decoder := json.NewDecoder(r.Body)
		_ = decoder.Decode(&receivedBody)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"repo_id":"repo","url":"https://repo.git"}`))
	}))
	defer server.Close()

	client, err := NewClient(Options{Name: "acme", Key: testKey, APIBaseURL: server.URL})
	if err != nil {
		t.Fatalf("client error: %v", err)
	}

	_, err = client.CreateRepo(nil, CreateRepoOptions{
		BaseRepo: GitHubBaseRepo{
			Owner: "octocat",
			Name:  "hello-world",
		},
		DefaultBranch: "develop",
	})
	if err != nil {
		t.Fatalf("create repo error: %v", err)
	}

	if receivedBody["default_branch"] != "develop" {
		t.Fatalf("expected default_branch develop in request")
	}
}

func TestCreateRepoForkBaseRepoTokenScopes(t *testing.T) {
	var receivedBody map[string]interface{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		decoder := json.NewDecoder(r.Body)
		_ = decoder.Decode(&receivedBody)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"repo_id":"repo","url":"https://repo.git"}`))
	}))
	defer server.Close()

	client, err := NewClient(Options{Name: "acme", Key: testKey, APIBaseURL: server.URL})
	if err != nil {
		t.Fatalf("client error: %v", err)
	}

	_, err = client.CreateRepo(nil, CreateRepoOptions{
		BaseRepo: ForkBaseRepo{ID: "template", Ref: "develop"},
	})
	if err != nil {
		t.Fatalf("create repo error: %v", err)
	}

	baseRepo, ok := receivedBody["base_repo"].(map[string]interface{})
	if !ok {
		t.Fatalf("expected base_repo payload")
	}
	auth, ok := baseRepo["auth"].(map[string]interface{})
	if !ok {
		t.Fatalf("expected auth payload")
	}
	token, _ := auth["token"].(string)
	claims := parseJWTFromToken(t, token)
	if claims["repo"] != "template" {
		t.Fatalf("expected repo claim template")
	}
	scopes, ok := claims["scopes"].([]interface{})
	if !ok || len(scopes) != 1 || scopes[0] != "git:read" {
		t.Fatalf("expected git:read scope")
	}
}

func TestCreateRepoConflict(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusConflict)
	}))
	defer server.Close()

	client, err := NewClient(Options{Name: "acme", Key: testKey, APIBaseURL: server.URL})
	if err != nil {
		t.Fatalf("client error: %v", err)
	}

	_, err = client.CreateRepo(nil, CreateRepoOptions{ID: "existing-repo"})
	if err == nil || !strings.Contains(err.Error(), "repository already exists") {
		t.Fatalf("expected repository already exists error, got %v", err)
	}
}

func TestListReposCursorLimit(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		if q.Get("cursor") != "cursor-1" || q.Get("limit") != "25" {
			t.Fatalf("unexpected query: %s", r.URL.RawQuery)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"repos":[],"has_more":false}`))
	}))
	defer server.Close()

	client, err := NewClient(Options{Name: "acme", Key: testKey, APIBaseURL: server.URL})
	if err != nil {
		t.Fatalf("client error: %v", err)
	}

	_, err = client.ListRepos(nil, ListReposOptions{Cursor: "cursor-1", Limit: 25})
	if err != nil {
		t.Fatalf("list repos error: %v", err)
	}
}

func TestListReposScopes(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		token := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
		claims := parseJWTFromToken(t, token)
		if claims["repo"] != "org" {
			t.Fatalf("expected repo org")
		}
		scopes, ok := claims["scopes"].([]interface{})
		if !ok || len(scopes) != 1 || scopes[0] != "org:read" {
			t.Fatalf("expected org:read scope")
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"repos":[],"has_more":false}`))
	}))
	defer server.Close()

	client, err := NewClient(Options{Name: "acme", Key: testKey, APIBaseURL: server.URL})
	if err != nil {
		t.Fatalf("client error: %v", err)
	}

	_, err = client.ListRepos(nil, ListReposOptions{})
	if err != nil {
		t.Fatalf("list repos error: %v", err)
	}
}

func TestFindOneReturnsRepo(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/repo" {
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"default_branch":"develop"}`))
	}))
	defer server.Close()

	client, err := NewClient(Options{Name: "acme", Key: testKey, APIBaseURL: server.URL, StorageBaseURL: "acme.code.storage"})
	if err != nil {
		t.Fatalf("client error: %v", err)
	}

	repo, err := client.FindOne(nil, FindOneOptions{ID: "repo-1"})
	if err != nil {
		t.Fatalf("find one error: %v", err)
	}
	if repo == nil || repo.DefaultBranch != "develop" {
		t.Fatalf("unexpected repo result")
	}
}

func TestFindOneNotFound(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	}))
	defer server.Close()

	client, err := NewClient(Options{Name: "acme", Key: testKey, APIBaseURL: server.URL})
	if err != nil {
		t.Fatalf("client error: %v", err)
	}

	repo, err := client.FindOne(nil, FindOneOptions{ID: "repo-1"})
	if err != nil {
		t.Fatalf("find one error: %v", err)
	}
	if repo != nil {
		t.Fatalf("expected nil repo")
	}
}

func TestDeleteRepoTTL(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		token := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
		claims := parseJWTFromToken(t, token)
		exp := int64(claims["exp"].(float64))
		iat := int64(claims["iat"].(float64))
		if exp-iat != 300 {
			t.Fatalf("expected ttl 300, got %d", exp-iat)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"repo_id":"repo","message":"ok"}`))
	}))
	defer server.Close()

	client, err := NewClient(Options{Name: "acme", Key: testKey, APIBaseURL: server.URL})
	if err != nil {
		t.Fatalf("client error: %v", err)
	}

	_, err = client.DeleteRepo(nil, DeleteRepoOptions{ID: "repo", InvocationOptions: InvocationOptions{TTL: 300 * time.Second}})
	if err != nil {
		t.Fatalf("delete repo error: %v", err)
	}
}

func TestDeleteRepoNotFound(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	}))
	defer server.Close()

	client, err := NewClient(Options{Name: "acme", Key: testKey, APIBaseURL: server.URL})
	if err != nil {
		t.Fatalf("client error: %v", err)
	}

	_, err = client.DeleteRepo(nil, DeleteRepoOptions{ID: "missing"})
	if err == nil || !strings.Contains(err.Error(), "repository not found") {
		t.Fatalf("expected repository not found error, got %v", err)
	}
}

func TestDeleteRepoAlreadyDeleted(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusConflict)
	}))
	defer server.Close()

	client, err := NewClient(Options{Name: "acme", Key: testKey, APIBaseURL: server.URL})
	if err != nil {
		t.Fatalf("client error: %v", err)
	}

	_, err = client.DeleteRepo(nil, DeleteRepoOptions{ID: "deleted"})
	if err == nil || !strings.Contains(err.Error(), "repository already deleted") {
		t.Fatalf("expected repository already deleted error, got %v", err)
	}
}

func TestDeleteRepoScope(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		token := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
		claims := parseJWTFromToken(t, token)
		if claims["repo"] != "repo-delete" {
			t.Fatalf("expected repo claim")
		}
		scopes, ok := claims["scopes"].([]interface{})
		if !ok || len(scopes) != 1 || scopes[0] != "repo:write" {
			t.Fatalf("expected repo:write scope")
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"repo_id":"repo-delete","message":"ok"}`))
	}))
	defer server.Close()

	client, err := NewClient(Options{Name: "acme", Key: testKey, APIBaseURL: server.URL})
	if err != nil {
		t.Fatalf("client error: %v", err)
	}

	_, err = client.DeleteRepo(nil, DeleteRepoOptions{ID: "repo-delete"})
	if err != nil {
		t.Fatalf("delete repo error: %v", err)
	}
}

func TestConfigAliases(t *testing.T) {
	client, err := NewCodeStorage(Options{Name: "acme", Key: testKey})
	if err != nil {
		t.Fatalf("client error: %v", err)
	}
	cfg := client.Config()
	if cfg.Name != "acme" {
		t.Fatalf("unexpected config")
	}
}

func TestAliasConstructors(t *testing.T) {
	if _, err := NewGitStorage(Options{Name: "acme", Key: testKey}); err != nil {
		t.Fatalf("NewGitStorage error: %v", err)
	}
	if _, err := NewCodeStorage(Options{Name: "acme", Key: testKey}); err != nil {
		t.Fatalf("NewCodeStorage error: %v", err)
	}
}

func TestCreateRepoUserAgentHeader(t *testing.T) {
	var headerAgent string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		headerAgent = r.Header.Get("Code-Storage-Agent")
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"repo_id":"repo","url":"https://repo.git"}`))
	}))
	defer server.Close()

	client, err := NewClient(Options{Name: "acme", Key: testKey, APIBaseURL: server.URL})
	if err != nil {
		t.Fatalf("client error: %v", err)
	}

	_, err = client.CreateRepo(nil, CreateRepoOptions{ID: "repo"})
	if err != nil {
		t.Fatalf("create repo error: %v", err)
	}

	if headerAgent == "" || !strings.Contains(headerAgent, "code-storage-go-sdk/") {
		t.Fatalf("missing Code-Storage-Agent header")
	}
}
