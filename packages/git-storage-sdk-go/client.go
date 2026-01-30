package storage

import (
	"context"
	"crypto/ecdsa"
	"crypto/x509"
	"encoding/pem"
	"errors"
	"net/url"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
)

const (
	defaultAPIBaseURL     = "https://api.{{org}}.code.storage"
	defaultStorageBaseURL = "{{org}}.code.storage"
	defaultTokenTTL       = time.Hour
	defaultJWTTTL         = 365 * 24 * time.Hour
)

// NewClient creates a Git storage client.
func NewClient(options Options) (*Client, error) {
	if strings.TrimSpace(options.Name) == "" || strings.TrimSpace(options.Key) == "" {
		return nil, errors.New("git storage requires a name and key")
	}

	apiBaseURL := options.APIBaseURL
	if apiBaseURL == "" {
		apiBaseURL = DefaultAPIBaseURL(options.Name)
	}
	storageBaseURL := options.StorageBaseURL
	if storageBaseURL == "" {
		storageBaseURL = DefaultStorageBaseURL(options.Name)
	}
	version := options.APIVersion
	if version == 0 {
		version = DefaultAPIVersion
	}

	privateKey, err := parseECPrivateKey([]byte(options.Key))
	if err != nil {
		return nil, err
	}

	client := &Client{
		options: Options{
			Name:           options.Name,
			Key:            options.Key,
			APIBaseURL:     apiBaseURL,
			StorageBaseURL: storageBaseURL,
			APIVersion:     version,
			DefaultTTL:     options.DefaultTTL,
			HTTPClient:     options.HTTPClient,
		},
		privateKey: privateKey,
	}
	client.api = newAPIFetcher(apiBaseURL, version, options.HTTPClient)
	return client, nil
}

// NewGitStorage is an alias for NewClient.
func NewGitStorage(options Options) (*Client, error) {
	return NewClient(options)
}

// NewCodeStorage is an alias for NewClient.
func NewCodeStorage(options Options) (*Client, error) {
	return NewClient(options)
}

// DefaultAPIBaseURL builds the default API base URL for an org.
func DefaultAPIBaseURL(name string) string {
	return strings.ReplaceAll(defaultAPIBaseURL, "{{org}}", name)
}

// DefaultStorageBaseURL builds the default storage base URL for an org.
func DefaultStorageBaseURL(name string) string {
	return strings.ReplaceAll(defaultStorageBaseURL, "{{org}}", name)
}

// Config returns the resolved client options.
func (c *Client) Config() Options {
	return c.options
}

// CreateRepo creates a new repository.
func (c *Client) CreateRepo(ctx context.Context, options CreateRepoOptions) (*Repo, error) {
	repoID := options.ID
	if repoID == "" {
		repoID = uuid.NewString()
	}

	ttl := resolveInvocationTTL(options.InvocationOptions, defaultTokenTTL)
	jwtToken, err := c.generateJWT(repoID, RemoteURLOptions{Permissions: []Permission{PermissionRepoWrite}, TTL: ttl})
	if err != nil {
		return nil, err
	}

	var baseRepo *baseRepoPayload
	isFork := false
	resolvedDefaultBranch := ""

	if options.BaseRepo != nil {
		switch base := options.BaseRepo.(type) {
		case ForkBaseRepo:
			isFork = true
			baseRepoToken, err := c.generateJWT(base.ID, RemoteURLOptions{Permissions: []Permission{PermissionGitRead}, TTL: ttl})
			if err != nil {
				return nil, err
			}
			baseRepo = &baseRepoPayload{
				Provider:  "code",
				Owner:     c.options.Name,
				Name:      base.ID,
				Operation: "fork",
				Auth:      &authPayload{Token: baseRepoToken},
			}
			if strings.TrimSpace(base.Ref) != "" {
				baseRepo.Ref = base.Ref
			}
			if strings.TrimSpace(base.SHA) != "" {
				baseRepo.SHA = base.SHA
			}
			if strings.TrimSpace(options.DefaultBranch) != "" {
				resolvedDefaultBranch = options.DefaultBranch
			}
		case GitHubBaseRepo:
			provider := base.Provider
			if provider == "" {
				provider = RepoProviderGitHub
			}
			baseRepo = &baseRepoPayload{
				Provider: string(provider),
				Owner:    base.Owner,
				Name:     base.Name,
			}
			if strings.TrimSpace(base.DefaultBranch) != "" {
				baseRepo.DefaultBranch = base.DefaultBranch
				resolvedDefaultBranch = base.DefaultBranch
			}
		default:
			return nil, errors.New("unsupported base repo type")
		}
	}

	if resolvedDefaultBranch == "" {
		if strings.TrimSpace(options.DefaultBranch) != "" {
			resolvedDefaultBranch = options.DefaultBranch
		} else if !isFork {
			resolvedDefaultBranch = "main"
		}
	}

	var body interface{}
	if baseRepo != nil || resolvedDefaultBranch != "" {
		body = &createRepoRequest{
			BaseRepo:      baseRepo,
			DefaultBranch: resolvedDefaultBranch,
		}
	}

	resp, err := c.api.post(ctx, "repos", nil, body, jwtToken, &requestOptions{allowedStatus: map[int]bool{409: true}})
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode == 409 {
		return nil, errors.New("repository already exists")
	}

	if resolvedDefaultBranch == "" {
		resolvedDefaultBranch = "main"
	}
	return &Repo{ID: repoID, DefaultBranch: resolvedDefaultBranch, client: c}, nil
}

// ListRepos lists repositories for the org.
func (c *Client) ListRepos(ctx context.Context, options ListReposOptions) (ListReposResult, error) {
	ttl := resolveInvocationTTL(options.InvocationOptions, defaultTokenTTL)
	jwtToken, err := c.generateJWT("org", RemoteURLOptions{Permissions: []Permission{PermissionOrgRead}, TTL: ttl})
	if err != nil {
		return ListReposResult{}, err
	}

	params := url.Values{}
	if options.Cursor != "" {
		params.Set("cursor", options.Cursor)
	}
	if options.Limit > 0 {
		params.Set("limit", itoa(options.Limit))
	}
	if len(params) == 0 {
		params = nil
	}

	resp, err := c.api.get(ctx, "repos", params, jwtToken, nil)
	if err != nil {
		return ListReposResult{}, err
	}
	defer resp.Body.Close()

	var payload listReposResponse
	if err := decodeJSON(resp, &payload); err != nil {
		return ListReposResult{}, err
	}

	result := ListReposResult{HasMore: payload.HasMore}
	if payload.NextCursor != "" {
		result.NextCursor = payload.NextCursor
	}
	for _, repo := range payload.Repos {
		entry := RepoInfo{
			RepoID:        repo.RepoID,
			URL:           repo.URL,
			DefaultBranch: repo.DefaultBranch,
			CreatedAt:     repo.CreatedAt,
		}
		if repo.BaseRepo != nil {
			entry.BaseRepo = &RepoBaseInfo{
				Provider: repo.BaseRepo.Provider,
				Owner:    repo.BaseRepo.Owner,
				Name:     repo.BaseRepo.Name,
			}
		}
		result.Repos = append(result.Repos, entry)
	}

	return result, nil
}

// FindOne retrieves a repo by ID.
func (c *Client) FindOne(ctx context.Context, options FindOneOptions) (*Repo, error) {
	if strings.TrimSpace(options.ID) == "" {
		return nil, errors.New("findOne id is required")
	}
	jwtToken, err := c.generateJWT(options.ID, RemoteURLOptions{Permissions: []Permission{PermissionGitRead}, TTL: defaultTokenTTL})
	if err != nil {
		return nil, err
	}

	resp, err := c.api.get(ctx, "repo", nil, jwtToken, &requestOptions{allowedStatus: map[int]bool{404: true}})
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode == 404 {
		return nil, nil
	}

	var payload struct {
		DefaultBranch string `json:"default_branch"`
	}
	if err := decodeJSON(resp, &payload); err != nil {
		return nil, err
	}
	defaultBranch := payload.DefaultBranch
	if defaultBranch == "" {
		defaultBranch = "main"
	}
	return &Repo{ID: options.ID, DefaultBranch: defaultBranch, client: c}, nil
}

// DeleteRepo deletes a repository by ID.
func (c *Client) DeleteRepo(ctx context.Context, options DeleteRepoOptions) (DeleteRepoResult, error) {
	if strings.TrimSpace(options.ID) == "" {
		return DeleteRepoResult{}, errors.New("deleteRepo id is required")
	}
	ttl := resolveInvocationTTL(options.InvocationOptions, defaultTokenTTL)
	jwtToken, err := c.generateJWT(options.ID, RemoteURLOptions{Permissions: []Permission{PermissionRepoWrite}, TTL: ttl})
	if err != nil {
		return DeleteRepoResult{}, err
	}

	resp, err := c.api.delete(ctx, "repos/delete", nil, nil, jwtToken, &requestOptions{allowedStatus: map[int]bool{404: true, 409: true}})
	if err != nil {
		return DeleteRepoResult{}, err
	}
	defer resp.Body.Close()

	if resp.StatusCode == 404 {
		return DeleteRepoResult{}, errors.New("repository not found")
	}
	if resp.StatusCode == 409 {
		return DeleteRepoResult{}, errors.New("repository already deleted")
	}

	var payload struct {
		RepoID  string `json:"repo_id"`
		Message string `json:"message"`
	}
	if err := decodeJSON(resp, &payload); err != nil {
		return DeleteRepoResult{}, err
	}

	return DeleteRepoResult{RepoID: payload.RepoID, Message: payload.Message}, nil
}

func (c *Client) generateJWT(repoID string, options RemoteURLOptions) (string, error) {
	permissions := options.Permissions
	if len(permissions) == 0 {
		permissions = []Permission{PermissionGitWrite, PermissionGitRead}
	}

	ttl := options.TTL
	if ttl <= 0 {
		if c.options.DefaultTTL > 0 {
			ttl = c.options.DefaultTTL
		} else {
			ttl = defaultJWTTTL
		}
	}

	issuedAt := time.Now()
	claims := jwt.MapClaims{
		"iss":    c.options.Name,
		"sub":    "@pierre/storage",
		"repo":   repoID,
		"scopes": permissions,
		"iat":    issuedAt.Unix(),
		"exp":    issuedAt.Add(ttl).Unix(),
	}

	token := jwt.NewWithClaims(jwt.SigningMethodES256, claims)
	return token.SignedString(c.privateKey)
}

func parseECPrivateKey(pemBytes []byte) (*ecdsa.PrivateKey, error) {
	block, _ := pem.Decode(pemBytes)
	if block == nil {
		return nil, errors.New("failed to parse private key PEM")
	}

	if key, err := x509.ParsePKCS8PrivateKey(block.Bytes); err == nil {
		if ecKey, ok := key.(*ecdsa.PrivateKey); ok {
			return ecKey, nil
		}
		return nil, errors.New("private key is not ECDSA")
	}

	if ecKey, err := x509.ParseECPrivateKey(block.Bytes); err == nil {
		return ecKey, nil
	}

	return nil, errors.New("unsupported private key format")
}

func resolveInvocationTTL(options InvocationOptions, defaultTTL time.Duration) time.Duration {
	if options.TTL > 0 {
		return options.TTL
	}
	return defaultTTL
}
