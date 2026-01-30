package storage

// createRepoRequest is the JSON body for CreateRepo.
type createRepoRequest struct {
	BaseRepo      *baseRepoPayload `json:"base_repo,omitempty"`
	DefaultBranch string           `json:"default_branch,omitempty"`
}

type baseRepoPayload struct {
	Provider      string       `json:"provider"`
	Owner         string       `json:"owner"`
	Name          string       `json:"name"`
	Operation     string       `json:"operation,omitempty"`
	Auth          *authPayload `json:"auth,omitempty"`
	Ref           string       `json:"ref,omitempty"`
	SHA           string       `json:"sha,omitempty"`
	DefaultBranch string       `json:"default_branch,omitempty"`
}

type authPayload struct {
	Token string `json:"token"`
}

// noteWriteRequest is the JSON body for note write operations.
type noteWriteRequest struct {
	SHA            string      `json:"sha"`
	Action         string      `json:"action,omitempty"`
	Note           string      `json:"note,omitempty"`
	ExpectedRefSHA string      `json:"expected_ref_sha,omitempty"`
	Author         *authorInfo `json:"author,omitempty"`
}

type authorInfo struct {
	Name  string `json:"name"`
	Email string `json:"email"`
}

// grepRequest is the JSON body for Grep.
type grepRequest struct {
	Query       grepQueryPayload       `json:"query"`
	Rev         string                 `json:"rev,omitempty"`
	Paths       []string               `json:"paths,omitempty"`
	FileFilters *grepFileFilterPayload `json:"file_filters,omitempty"`
	Context     *grepContextPayload    `json:"context,omitempty"`
	Limits      *grepLimitsPayload     `json:"limits,omitempty"`
	Pagination  *grepPaginationPayload `json:"pagination,omitempty"`
}

type grepQueryPayload struct {
	Pattern       string `json:"pattern"`
	CaseSensitive *bool  `json:"case_sensitive,omitempty"`
}

type grepFileFilterPayload struct {
	IncludeGlobs     []string `json:"include_globs,omitempty"`
	ExcludeGlobs     []string `json:"exclude_globs,omitempty"`
	ExtensionFilters []string `json:"extension_filters,omitempty"`
}

type grepContextPayload struct {
	Before *int `json:"before,omitempty"`
	After  *int `json:"after,omitempty"`
}

type grepLimitsPayload struct {
	MaxLines          *int `json:"max_lines,omitempty"`
	MaxMatchesPerFile *int `json:"max_matches_per_file,omitempty"`
}

type grepPaginationPayload struct {
	Cursor string `json:"cursor,omitempty"`
	Limit  *int   `json:"limit,omitempty"`
}

// pullUpstreamRequest is the JSON body for PullUpstream.
type pullUpstreamRequest struct {
	Ref string `json:"ref,omitempty"`
}

// createBranchRequest is the JSON body for CreateBranch.
type createBranchRequest struct {
	BaseBranch        string `json:"base_branch"`
	TargetBranch      string `json:"target_branch"`
	BaseIsEphemeral   bool   `json:"base_is_ephemeral,omitempty"`
	TargetIsEphemeral bool   `json:"target_is_ephemeral,omitempty"`
}

// commitMetadataPayload is the JSON body for commit metadata.
type commitMetadataPayload struct {
	TargetBranch    string             `json:"target_branch"`
	CommitMessage   string             `json:"commit_message"`
	Author          authorInfo         `json:"author"`
	Committer       *authorInfo        `json:"committer,omitempty"`
	ExpectedHeadSHA string             `json:"expected_head_sha,omitempty"`
	BaseBranch      string             `json:"base_branch,omitempty"`
	Ephemeral       bool               `json:"ephemeral,omitempty"`
	EphemeralBase   bool               `json:"ephemeral_base,omitempty"`
	Files           []fileEntryPayload `json:"files,omitempty"`
}

type fileEntryPayload struct {
	Path      string `json:"path"`
	ContentID string `json:"content_id"`
	Operation string `json:"operation"`
	Mode      string `json:"mode,omitempty"`
}

type metadataEnvelope struct {
	Metadata interface{} `json:"metadata"`
}

// restoreCommitMetadata is the JSON body for RestoreCommit.
type restoreCommitMetadata struct {
	TargetBranch    string      `json:"target_branch"`
	TargetCommitSHA string      `json:"target_commit_sha"`
	CommitMessage   string      `json:"commit_message,omitempty"`
	ExpectedHeadSHA string      `json:"expected_head_sha,omitempty"`
	Author          authorInfo  `json:"author"`
	Committer       *authorInfo `json:"committer,omitempty"`
}

// blobChunkEnvelope wraps a blob chunk for ndjson streaming.
type blobChunkEnvelope struct {
	BlobChunk blobChunkPayload `json:"blob_chunk"`
}

type blobChunkPayload struct {
	ContentID string `json:"content_id"`
	Data      string `json:"data"`
	EOF       bool   `json:"eof"`
}

// diffChunkEnvelope wraps a diff chunk for ndjson streaming.
type diffChunkEnvelope struct {
	DiffChunk diffChunkPayload `json:"diff_chunk"`
}

type diffChunkPayload struct {
	Data string `json:"data"`
	EOF  bool   `json:"eof"`
}
