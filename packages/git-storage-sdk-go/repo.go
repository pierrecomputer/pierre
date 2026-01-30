package storage

import (
	"context"
	"errors"
	"net/http"
	"net/url"
	"strconv"
	"strings"
)

var restoreCommitAllowedStatus = map[int]bool{
	400: true,
	401: true,
	403: true,
	404: true,
	408: true,
	409: true,
	412: true,
	422: true,
	429: true,
	499: true,
	500: true,
	502: true,
	503: true,
	504: true,
}

var noteWriteAllowedStatus = map[int]bool{
	400: true,
	401: true,
	403: true,
	404: true,
	408: true,
	409: true,
	412: true,
	422: true,
	429: true,
	499: true,
	500: true,
	502: true,
	503: true,
	504: true,
}

// RemoteURL returns an authenticated remote URL.
func (r *Repo) RemoteURL(ctx context.Context, options RemoteURLOptions) (string, error) {
	jwtToken, err := r.client.generateJWT(r.ID, options)
	if err != nil {
		return "", err
	}

	u := url.URL{
		Scheme: "https",
		Host:   r.client.options.StorageBaseURL,
		Path:   "/" + r.ID + ".git",
	}
	u.User = url.UserPassword("t", jwtToken)
	return u.String(), nil
}

// EphemeralRemoteURL returns the ephemeral remote URL.
func (r *Repo) EphemeralRemoteURL(ctx context.Context, options RemoteURLOptions) (string, error) {
	jwtToken, err := r.client.generateJWT(r.ID, options)
	if err != nil {
		return "", err
	}

	u := url.URL{
		Scheme: "https",
		Host:   r.client.options.StorageBaseURL,
		Path:   "/" + r.ID + "+ephemeral.git",
	}
	u.User = url.UserPassword("t", jwtToken)
	return u.String(), nil
}

// FileStream returns the raw response for streaming file contents.
func (r *Repo) FileStream(ctx context.Context, options GetFileOptions) (*http.Response, error) {
	if strings.TrimSpace(options.Path) == "" {
		return nil, errors.New("getFileStream path is required")
	}

	ttl := resolveInvocationTTL(options.InvocationOptions, defaultTokenTTL)
	jwtToken, err := r.client.generateJWT(r.ID, RemoteURLOptions{Permissions: []Permission{PermissionGitRead}, TTL: ttl})
	if err != nil {
		return nil, err
	}

	params := url.Values{}
	params.Set("path", options.Path)
	if options.Ref != "" {
		params.Set("ref", options.Ref)
	}
	if options.Ephemeral != nil {
		params.Set("ephemeral", strconv.FormatBool(*options.Ephemeral))
	}
	if options.EphemeralBase != nil {
		params.Set("ephemeral_base", strconv.FormatBool(*options.EphemeralBase))
	}

	resp, err := r.client.api.get(ctx, "repos/file", params, jwtToken, nil)
	if err != nil {
		return nil, err
	}

	return resp, nil
}

// ListFiles lists file paths.
func (r *Repo) ListFiles(ctx context.Context, options ListFilesOptions) (ListFilesResult, error) {
	ttl := resolveInvocationTTL(options.InvocationOptions, defaultTokenTTL)
	jwtToken, err := r.client.generateJWT(r.ID, RemoteURLOptions{Permissions: []Permission{PermissionGitRead}, TTL: ttl})
	if err != nil {
		return ListFilesResult{}, err
	}

	params := url.Values{}
	if options.Ref != "" {
		params.Set("ref", options.Ref)
	}
	if options.Ephemeral != nil {
		params.Set("ephemeral", strconv.FormatBool(*options.Ephemeral))
	}
	if len(params) == 0 {
		params = nil
	}

	resp, err := r.client.api.get(ctx, "repos/files", params, jwtToken, nil)
	if err != nil {
		return ListFilesResult{}, err
	}
	defer resp.Body.Close()

	var payload listFilesResponse
	if err := decodeJSON(resp, &payload); err != nil {
		return ListFilesResult{}, err
	}

	return ListFilesResult{Paths: payload.Paths, Ref: payload.Ref}, nil
}

// ListBranches lists branches.
func (r *Repo) ListBranches(ctx context.Context, options ListBranchesOptions) (ListBranchesResult, error) {
	ttl := resolveInvocationTTL(options.InvocationOptions, defaultTokenTTL)
	jwtToken, err := r.client.generateJWT(r.ID, RemoteURLOptions{Permissions: []Permission{PermissionGitRead}, TTL: ttl})
	if err != nil {
		return ListBranchesResult{}, err
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

	resp, err := r.client.api.get(ctx, "repos/branches", params, jwtToken, nil)
	if err != nil {
		return ListBranchesResult{}, err
	}
	defer resp.Body.Close()

	var payload listBranchesResponse
	if err := decodeJSON(resp, &payload); err != nil {
		return ListBranchesResult{}, err
	}

	result := ListBranchesResult{HasMore: payload.HasMore}
	if payload.NextCursor != "" {
		result.NextCursor = payload.NextCursor
	}
	for _, branch := range payload.Branches {
		result.Branches = append(result.Branches, BranchInfo{
			Cursor:    branch.Cursor,
			Name:      branch.Name,
			HeadSHA:   branch.HeadSHA,
			CreatedAt: branch.CreatedAt,
		})
	}
	return result, nil
}

// ListCommits lists commits.
func (r *Repo) ListCommits(ctx context.Context, options ListCommitsOptions) (ListCommitsResult, error) {
	ttl := resolveInvocationTTL(options.InvocationOptions, defaultTokenTTL)
	jwtToken, err := r.client.generateJWT(r.ID, RemoteURLOptions{Permissions: []Permission{PermissionGitRead}, TTL: ttl})
	if err != nil {
		return ListCommitsResult{}, err
	}

	params := url.Values{}
	if options.Branch != "" {
		params.Set("branch", options.Branch)
	}
	if options.Cursor != "" {
		params.Set("cursor", options.Cursor)
	}
	if options.Limit > 0 {
		params.Set("limit", itoa(options.Limit))
	}
	if len(params) == 0 {
		params = nil
	}

	resp, err := r.client.api.get(ctx, "repos/commits", params, jwtToken, nil)
	if err != nil {
		return ListCommitsResult{}, err
	}
	defer resp.Body.Close()

	var payload listCommitsResponse
	if err := decodeJSON(resp, &payload); err != nil {
		return ListCommitsResult{}, err
	}

	result := ListCommitsResult{HasMore: payload.HasMore}
	if payload.NextCursor != "" {
		result.NextCursor = payload.NextCursor
	}
	for _, commit := range payload.Commits {
		result.Commits = append(result.Commits, CommitInfo{
			SHA:            commit.SHA,
			Message:        commit.Message,
			AuthorName:     commit.AuthorName,
			AuthorEmail:    commit.AuthorEmail,
			CommitterName:  commit.CommitterName,
			CommitterEmail: commit.CommitterEmail,
			Date:           parseTime(commit.Date),
			RawDate:        commit.Date,
		})
	}

	return result, nil
}

// GetNote reads a git note.
func (r *Repo) GetNote(ctx context.Context, options GetNoteOptions) (GetNoteResult, error) {
	sha := strings.TrimSpace(options.SHA)
	if sha == "" {
		return GetNoteResult{}, errors.New("getNote sha is required")
	}

	ttl := resolveInvocationTTL(options.InvocationOptions, defaultTokenTTL)
	jwtToken, err := r.client.generateJWT(r.ID, RemoteURLOptions{Permissions: []Permission{PermissionGitRead}, TTL: ttl})
	if err != nil {
		return GetNoteResult{}, err
	}

	params := url.Values{}
	params.Set("sha", sha)

	resp, err := r.client.api.get(ctx, "repos/notes", params, jwtToken, nil)
	if err != nil {
		return GetNoteResult{}, err
	}
	defer resp.Body.Close()

	var payload noteReadResponse
	if err := decodeJSON(resp, &payload); err != nil {
		return GetNoteResult{}, err
	}

	return GetNoteResult{SHA: payload.SHA, Note: payload.Note, RefSHA: payload.RefSHA}, nil
}

// CreateNote adds a git note.
func (r *Repo) CreateNote(ctx context.Context, options CreateNoteOptions) (NoteWriteResult, error) {
	return r.writeNote(ctx, options.InvocationOptions, "add", options.SHA, options.Note, options.ExpectedRefSHA, options.Author)
}

// AppendNote appends to a git note.
func (r *Repo) AppendNote(ctx context.Context, options AppendNoteOptions) (NoteWriteResult, error) {
	return r.writeNote(ctx, options.InvocationOptions, "append", options.SHA, options.Note, options.ExpectedRefSHA, options.Author)
}

// DeleteNote deletes a git note.
func (r *Repo) DeleteNote(ctx context.Context, options DeleteNoteOptions) (NoteWriteResult, error) {
	sha := strings.TrimSpace(options.SHA)
	if sha == "" {
		return NoteWriteResult{}, errors.New("deleteNote sha is required")
	}

	ttl := resolveInvocationTTL(options.InvocationOptions, defaultTokenTTL)
	jwtToken, err := r.client.generateJWT(r.ID, RemoteURLOptions{Permissions: []Permission{PermissionGitWrite}, TTL: ttl})
	if err != nil {
		return NoteWriteResult{}, err
	}

	body := &noteWriteRequest{SHA: sha}
	if strings.TrimSpace(options.ExpectedRefSHA) != "" {
		body.ExpectedRefSHA = options.ExpectedRefSHA
	}
	if options.Author != nil {
		if strings.TrimSpace(options.Author.Name) == "" || strings.TrimSpace(options.Author.Email) == "" {
			return NoteWriteResult{}, errors.New("deleteNote author name and email are required when provided")
		}
		body.Author = &authorInfo{Name: options.Author.Name, Email: options.Author.Email}
	}

	resp, err := r.client.api.delete(ctx, "repos/notes", nil, body, jwtToken, &requestOptions{allowedStatus: noteWriteAllowedStatus})
	if err != nil {
		return NoteWriteResult{}, err
	}
	defer resp.Body.Close()

	result, err := parseNoteWriteResponse(resp, "DELETE")
	if err != nil {
		return NoteWriteResult{}, err
	}
	if !result.Result.Success {
		message := result.Result.Message
		if strings.TrimSpace(message) == "" {
			message = "deleteNote failed with status " + result.Result.Status
		}
		return NoteWriteResult{}, newRefUpdateError(
			message,
			result.Result.Status,
			partialRefUpdate(result.TargetRef, result.BaseCommit, result.NewRefSHA),
		)
	}
	return result, nil
}

func (r *Repo) writeNote(ctx context.Context, invocation InvocationOptions, action string, sha string, note string, expectedRefSHA string, author *NoteAuthor) (NoteWriteResult, error) {
	sha = strings.TrimSpace(sha)
	if sha == "" {
		return NoteWriteResult{}, errors.New("note sha is required")
	}

	note = strings.TrimSpace(note)
	if note == "" {
		return NoteWriteResult{}, errors.New("note content is required")
	}

	ttl := resolveInvocationTTL(invocation, defaultTokenTTL)
	jwtToken, err := r.client.generateJWT(r.ID, RemoteURLOptions{Permissions: []Permission{PermissionGitWrite}, TTL: ttl})
	if err != nil {
		return NoteWriteResult{}, err
	}

	body := &noteWriteRequest{
		SHA:    sha,
		Action: action,
		Note:   note,
	}
	if strings.TrimSpace(expectedRefSHA) != "" {
		body.ExpectedRefSHA = expectedRefSHA
	}
	if author != nil {
		if strings.TrimSpace(author.Name) == "" || strings.TrimSpace(author.Email) == "" {
			return NoteWriteResult{}, errors.New("note author name and email are required when provided")
		}
		body.Author = &authorInfo{Name: author.Name, Email: author.Email}
	}

	resp, err := r.client.api.post(ctx, "repos/notes", nil, body, jwtToken, &requestOptions{allowedStatus: noteWriteAllowedStatus})
	if err != nil {
		return NoteWriteResult{}, err
	}
	defer resp.Body.Close()

	result, err := parseNoteWriteResponse(resp, "POST")
	if err != nil {
		return NoteWriteResult{}, err
	}
	if !result.Result.Success {
		message := result.Result.Message
		if strings.TrimSpace(message) == "" {
			if action == "append" {
				message = "appendNote failed with status " + result.Result.Status
			} else {
				message = "createNote failed with status " + result.Result.Status
			}
		}
		return NoteWriteResult{}, newRefUpdateError(
			message,
			result.Result.Status,
			partialRefUpdate(result.TargetRef, result.BaseCommit, result.NewRefSHA),
		)
	}
	return result, nil
}

// GetBranchDiff returns a diff for a branch.
func (r *Repo) GetBranchDiff(ctx context.Context, options GetBranchDiffOptions) (GetBranchDiffResult, error) {
	if strings.TrimSpace(options.Branch) == "" {
		return GetBranchDiffResult{}, errors.New("getBranchDiff branch is required")
	}

	ttl := resolveInvocationTTL(options.InvocationOptions, defaultTokenTTL)
	jwtToken, err := r.client.generateJWT(r.ID, RemoteURLOptions{Permissions: []Permission{PermissionGitRead}, TTL: ttl})
	if err != nil {
		return GetBranchDiffResult{}, err
	}

	params := url.Values{}
	params.Set("branch", options.Branch)
	if strings.TrimSpace(options.Base) != "" {
		params.Set("base", options.Base)
	}
	if options.Ephemeral != nil {
		params.Set("ephemeral", strconv.FormatBool(*options.Ephemeral))
	}
	if options.EphemeralBase != nil {
		params.Set("ephemeral_base", strconv.FormatBool(*options.EphemeralBase))
	}
	for _, path := range options.Paths {
		if strings.TrimSpace(path) != "" {
			params.Add("path", path)
		}
	}

	resp, err := r.client.api.get(ctx, "repos/branches/diff", params, jwtToken, nil)
	if err != nil {
		return GetBranchDiffResult{}, err
	}
	defer resp.Body.Close()

	var payload branchDiffResponse
	if err := decodeJSON(resp, &payload); err != nil {
		return GetBranchDiffResult{}, err
	}

	return transformBranchDiff(payload), nil
}

// GetCommitDiff returns a diff for a commit.
func (r *Repo) GetCommitDiff(ctx context.Context, options GetCommitDiffOptions) (GetCommitDiffResult, error) {
	if strings.TrimSpace(options.SHA) == "" {
		return GetCommitDiffResult{}, errors.New("getCommitDiff sha is required")
	}

	ttl := resolveInvocationTTL(options.InvocationOptions, defaultTokenTTL)
	jwtToken, err := r.client.generateJWT(r.ID, RemoteURLOptions{Permissions: []Permission{PermissionGitRead}, TTL: ttl})
	if err != nil {
		return GetCommitDiffResult{}, err
	}

	params := url.Values{}
	params.Set("sha", options.SHA)
	if strings.TrimSpace(options.BaseSHA) != "" {
		params.Set("baseSha", options.BaseSHA)
	}
	for _, path := range options.Paths {
		if strings.TrimSpace(path) != "" {
			params.Add("path", path)
		}
	}

	resp, err := r.client.api.get(ctx, "repos/diff", params, jwtToken, nil)
	if err != nil {
		return GetCommitDiffResult{}, err
	}
	defer resp.Body.Close()

	var payload commitDiffResponse
	if err := decodeJSON(resp, &payload); err != nil {
		return GetCommitDiffResult{}, err
	}

	return transformCommitDiff(payload), nil
}

// Grep runs a grep query.
func (r *Repo) Grep(ctx context.Context, options GrepOptions) (GrepResult, error) {
	pattern := strings.TrimSpace(options.Query.Pattern)
	if pattern == "" {
		return GrepResult{}, errors.New("grep query.pattern is required")
	}

	ttl := resolveInvocationTTL(options.InvocationOptions, defaultTokenTTL)
	jwtToken, err := r.client.generateJWT(r.ID, RemoteURLOptions{Permissions: []Permission{PermissionGitRead}, TTL: ttl})
	if err != nil {
		return GrepResult{}, err
	}

	body := &grepRequest{
		Query: grepQueryPayload{
			Pattern:       pattern,
			CaseSensitive: options.Query.CaseSensitive,
		},
	}
	if options.Ref != "" {
		body.Rev = options.Ref
	}
	if len(options.Paths) > 0 {
		body.Paths = options.Paths
	}
	if options.FileFilters != nil {
		filters := &grepFileFilterPayload{}
		hasFilters := false
		if len(options.FileFilters.IncludeGlobs) > 0 {
			filters.IncludeGlobs = options.FileFilters.IncludeGlobs
			hasFilters = true
		}
		if len(options.FileFilters.ExcludeGlobs) > 0 {
			filters.ExcludeGlobs = options.FileFilters.ExcludeGlobs
			hasFilters = true
		}
		if len(options.FileFilters.ExtensionFilters) > 0 {
			filters.ExtensionFilters = options.FileFilters.ExtensionFilters
			hasFilters = true
		}
		if hasFilters {
			body.FileFilters = filters
		}
	}
	if options.Context != nil {
		contextPayload := &grepContextPayload{}
		hasCtx := false
		if options.Context.Before != nil {
			contextPayload.Before = options.Context.Before
			hasCtx = true
		}
		if options.Context.After != nil {
			contextPayload.After = options.Context.After
			hasCtx = true
		}
		if hasCtx {
			body.Context = contextPayload
		}
	}
	if options.Limits != nil {
		limits := &grepLimitsPayload{}
		hasLimits := false
		if options.Limits.MaxLines != nil {
			limits.MaxLines = options.Limits.MaxLines
			hasLimits = true
		}
		if options.Limits.MaxMatchesPerFile != nil {
			limits.MaxMatchesPerFile = options.Limits.MaxMatchesPerFile
			hasLimits = true
		}
		if hasLimits {
			body.Limits = limits
		}
	}
	if options.Pagination != nil {
		pagination := &grepPaginationPayload{}
		hasPagination := false
		if strings.TrimSpace(options.Pagination.Cursor) != "" {
			pagination.Cursor = options.Pagination.Cursor
			hasPagination = true
		}
		if options.Pagination.Limit != nil {
			pagination.Limit = options.Pagination.Limit
			hasPagination = true
		}
		if hasPagination {
			body.Pagination = pagination
		}
	}

	resp, err := r.client.api.post(ctx, "repos/grep", nil, body, jwtToken, nil)
	if err != nil {
		return GrepResult{}, err
	}
	defer resp.Body.Close()

	var payload grepResponse
	if err := decodeJSON(resp, &payload); err != nil {
		return GrepResult{}, err
	}

	result := GrepResult{
		Query:   GrepQuery{Pattern: payload.Query.Pattern, CaseSensitive: &payload.Query.CaseSensitive},
		Repo:    GrepRepo{Ref: payload.Repo.Ref, Commit: payload.Repo.Commit},
		HasMore: payload.HasMore,
	}
	if payload.NextCursor != "" {
		result.NextCursor = payload.NextCursor
	}
	for _, match := range payload.Matches {
		entry := GrepFileMatch{Path: match.Path}
		for _, line := range match.Lines {
			entry.Lines = append(entry.Lines, GrepLine{LineNumber: line.LineNumber, Text: line.Text, Type: line.Type})
		}
		result.Matches = append(result.Matches, entry)
	}

	return result, nil
}

// PullUpstream triggers a pull-upstream operation.
func (r *Repo) PullUpstream(ctx context.Context, options PullUpstreamOptions) error {
	ttl := resolveInvocationTTL(options.InvocationOptions, defaultTokenTTL)
	jwtToken, err := r.client.generateJWT(r.ID, RemoteURLOptions{Permissions: []Permission{PermissionGitWrite}, TTL: ttl})
	if err != nil {
		return err
	}

	body := &pullUpstreamRequest{}
	if strings.TrimSpace(options.Ref) != "" {
		body.Ref = options.Ref
	}

	resp, err := r.client.api.post(ctx, "repos/pull-upstream", nil, body, jwtToken, nil)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != 202 {
		return errors.New("pull upstream failed: " + resp.Status)
	}
	return nil
}

// CreateBranch creates a new branch.
func (r *Repo) CreateBranch(ctx context.Context, options CreateBranchOptions) (CreateBranchResult, error) {
	baseBranch := strings.TrimSpace(options.BaseBranch)
	targetBranch := strings.TrimSpace(options.TargetBranch)
	if baseBranch == "" {
		return CreateBranchResult{}, errors.New("createBranch baseBranch is required")
	}
	if targetBranch == "" {
		return CreateBranchResult{}, errors.New("createBranch targetBranch is required")
	}

	ttl := resolveInvocationTTL(options.InvocationOptions, defaultTokenTTL)
	jwtToken, err := r.client.generateJWT(r.ID, RemoteURLOptions{Permissions: []Permission{PermissionGitWrite}, TTL: ttl})
	if err != nil {
		return CreateBranchResult{}, err
	}

	body := &createBranchRequest{
		BaseBranch:        baseBranch,
		TargetBranch:      targetBranch,
		BaseIsEphemeral:   options.BaseIsEphemeral,
		TargetIsEphemeral: options.TargetIsEphemeral,
	}

	resp, err := r.client.api.post(ctx, "repos/branches/create", nil, body, jwtToken, nil)
	if err != nil {
		return CreateBranchResult{}, err
	}
	defer resp.Body.Close()

	var payload createBranchResponse
	if err := decodeJSON(resp, &payload); err != nil {
		return CreateBranchResult{}, err
	}

	result := CreateBranchResult{
		Message:           payload.Message,
		TargetBranch:      payload.TargetBranch,
		TargetIsEphemeral: payload.TargetIsEphemeral,
		CommitSHA:         payload.CommitSHA,
	}
	return result, nil
}

// RestoreCommit restores a commit into a branch.
func (r *Repo) RestoreCommit(ctx context.Context, options RestoreCommitOptions) (RestoreCommitResult, error) {
	targetBranch := strings.TrimSpace(options.TargetBranch)
	if targetBranch == "" {
		return RestoreCommitResult{}, errors.New("restoreCommit targetBranch is required")
	}
	if strings.HasPrefix(targetBranch, "refs/") {
		return RestoreCommitResult{}, errors.New("restoreCommit targetBranch must not include refs/ prefix")
	}

	targetSHA := strings.TrimSpace(options.TargetCommitSHA)
	if targetSHA == "" {
		return RestoreCommitResult{}, errors.New("restoreCommit targetCommitSha is required")
	}

	if strings.TrimSpace(options.Author.Name) == "" || strings.TrimSpace(options.Author.Email) == "" {
		return RestoreCommitResult{}, errors.New("restoreCommit author name and email are required")
	}

	ttl := resolveCommitTTL(options.InvocationOptions, defaultTokenTTL)
	jwtToken, err := r.client.generateJWT(r.ID, RemoteURLOptions{Permissions: []Permission{PermissionGitWrite}, TTL: ttl})
	if err != nil {
		return RestoreCommitResult{}, err
	}

	metadata := &restoreCommitMetadata{
		TargetBranch:    targetBranch,
		TargetCommitSHA: targetSHA,
		Author: authorInfo{
			Name:  strings.TrimSpace(options.Author.Name),
			Email: strings.TrimSpace(options.Author.Email),
		},
	}

	if strings.TrimSpace(options.CommitMessage) != "" {
		metadata.CommitMessage = options.CommitMessage
	}
	if strings.TrimSpace(options.ExpectedHeadSHA) != "" {
		metadata.ExpectedHeadSHA = options.ExpectedHeadSHA
	}
	if options.Committer != nil {
		if strings.TrimSpace(options.Committer.Name) == "" || strings.TrimSpace(options.Committer.Email) == "" {
			return RestoreCommitResult{}, errors.New("restoreCommit committer name and email are required when provided")
		}
		metadata.Committer = &authorInfo{
			Name:  strings.TrimSpace(options.Committer.Name),
			Email: strings.TrimSpace(options.Committer.Email),
		}
	}

	resp, err := r.client.api.post(ctx, "repos/restore-commit", nil, &metadataEnvelope{Metadata: metadata}, jwtToken, &requestOptions{allowedStatus: restoreCommitAllowedStatus})
	if err != nil {
		return RestoreCommitResult{}, err
	}
	defer resp.Body.Close()

	payloadBytes, err := readAll(resp)
	if err != nil {
		return RestoreCommitResult{}, err
	}

	ack, failure := parseRestoreCommitPayload(payloadBytes)
	if ack != nil {
		return buildRestoreCommitResult(*ack)
	}

	status := ""
	message := ""
	var refUpdate *RefUpdate
	if failure != nil {
		status = failure.Status
		message = failure.Message
		refUpdate = failure.RefUpdate
	}
	if status == "" {
		status = httpStatusToRestoreStatus(resp.StatusCode)
	}
	if message == "" {
		message = "restore commit failed with HTTP " + itoa(resp.StatusCode)
	}

	return RestoreCommitResult{}, newRefUpdateError(message, status, refUpdate)
}

// CreateCommit starts a commit builder.
func (r *Repo) CreateCommit(options CommitOptions) (*CommitBuilder, error) {
	builder := &CommitBuilder{options: options, client: r.client, repoID: r.ID}
	if err := builder.normalize(); err != nil {
		return nil, err
	}
	return builder, nil
}

// CreateCommitFromDiff applies a pre-generated diff.
func (r *Repo) CreateCommitFromDiff(ctx context.Context, options CommitFromDiffOptions) (CommitResult, error) {
	exec := diffCommitExecutor{options: options, client: r.client}
	return exec.send(ctx, r.ID)
}
