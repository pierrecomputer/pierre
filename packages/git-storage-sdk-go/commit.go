package storage

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
)

const maxChunkBytes = 4 * 1024 * 1024

type commitOperation struct {
	Path      string
	ContentID string
	Mode      GitFileMode
	Operation string
	Source    io.Reader
}

func (b *CommitBuilder) normalize() error {
	b.options.TargetBranch = strings.TrimSpace(b.options.TargetBranch)
	b.options.TargetRef = strings.TrimSpace(b.options.TargetRef)
	b.options.CommitMessage = strings.TrimSpace(b.options.CommitMessage)

	if b.options.TargetBranch != "" {
		branch, err := normalizeBranchName(b.options.TargetBranch)
		if err != nil {
			return err
		}
		b.options.TargetBranch = branch
	} else if b.options.TargetRef != "" {
		branch, err := normalizeLegacyTargetRef(b.options.TargetRef)
		if err != nil {
			return err
		}
		b.options.TargetBranch = branch
	} else {
		return errors.New("createCommit targetBranch is required")
	}

	if b.options.CommitMessage == "" {
		return errors.New("createCommit commitMessage is required")
	}

	if strings.TrimSpace(b.options.Author.Name) == "" || strings.TrimSpace(b.options.Author.Email) == "" {
		return errors.New("createCommit author name and email are required")
	}
	b.options.Author.Name = strings.TrimSpace(b.options.Author.Name)
	b.options.Author.Email = strings.TrimSpace(b.options.Author.Email)

	b.options.ExpectedHeadSHA = strings.TrimSpace(b.options.ExpectedHeadSHA)
	b.options.BaseBranch = strings.TrimSpace(b.options.BaseBranch)
	if b.options.BaseBranch != "" && strings.HasPrefix(b.options.BaseBranch, "refs/") {
		return errors.New("createCommit baseBranch must not include refs/ prefix")
	}

	if b.options.EphemeralBase && b.options.BaseBranch == "" {
		return errors.New("createCommit ephemeralBase requires baseBranch")
	}

	if b.options.Committer != nil {
		if strings.TrimSpace(b.options.Committer.Name) == "" || strings.TrimSpace(b.options.Committer.Email) == "" {
			return errors.New("createCommit committer name and email are required when provided")
		}
		b.options.Committer.Name = strings.TrimSpace(b.options.Committer.Name)
		b.options.Committer.Email = strings.TrimSpace(b.options.Committer.Email)
	}

	return nil
}

// AddFile adds a file to the commit.
func (b *CommitBuilder) AddFile(path string, source interface{}, options *CommitFileOptions) (*CommitBuilder, error) {
	if err := b.ensureNotSent(); err != nil {
		return nil, err
	}
	normalizedPath, err := normalizePath(path)
	if err != nil {
		return nil, err
	}

	reader, err := toReader(source)
	if err != nil {
		return nil, err
	}

	mode := GitFileModeRegular
	if options != nil && options.Mode != "" {
		mode = options.Mode
	}

	b.ops = append(b.ops, commitOperation{
		Path:      normalizedPath,
		ContentID: uuid.NewString(),
		Mode:      mode,
		Operation: "upsert",
		Source:    reader,
	})
	return b, nil
}

// AddFileFromString adds a text file.
func (b *CommitBuilder) AddFileFromString(path string, contents string, options *CommitTextFileOptions) (*CommitBuilder, error) {
	encoding := "utf-8"
	if options != nil && options.Encoding != "" {
		encoding = options.Encoding
	}
	encoding = strings.ToLower(strings.TrimSpace(encoding))
	if encoding != "utf8" && encoding != "utf-8" {
		return nil, errors.New("unsupported encoding: " + encoding)
	}
	if options == nil {
		return b.AddFile(path, []byte(contents), nil)
	}
	return b.AddFile(path, []byte(contents), &options.CommitFileOptions)
}

// DeletePath removes a file or directory.
func (b *CommitBuilder) DeletePath(path string) (*CommitBuilder, error) {
	if err := b.ensureNotSent(); err != nil {
		return nil, err
	}
	normalizedPath, err := normalizePath(path)
	if err != nil {
		return nil, err
	}
	b.ops = append(b.ops, commitOperation{
		Path:      normalizedPath,
		ContentID: uuid.NewString(),
		Operation: "delete",
	})
	return b, nil
}

// Send finalizes the commit.
func (b *CommitBuilder) Send(ctx context.Context) (CommitResult, error) {
	if err := b.ensureNotSent(); err != nil {
		return CommitResult{}, err
	}
	b.sent = true

	if strings.TrimSpace(b.repoID) == "" {
		return CommitResult{}, errors.New("createCommit repository id is required")
	}
	if b.client == nil {
		return CommitResult{}, errors.New("createCommit client is required")
	}

	ttl := resolveCommitTTL(b.options.InvocationOptions, defaultTokenTTL)
	jwtToken, err := b.client.generateJWT(b.repoID, RemoteURLOptions{Permissions: []Permission{PermissionGitWrite}, TTL: ttl})
	if err != nil {
		return CommitResult{}, err
	}

	metadata := buildCommitMetadata(b.options, b.ops)

	pipeReader, pipeWriter := io.Pipe()
	encoder := json.NewEncoder(pipeWriter)
	encoder.SetEscapeHTML(false)

	go func() {
		defer pipeWriter.Close()
		if err := encoder.Encode(metadataEnvelope{Metadata: metadata}); err != nil {
			_ = pipeWriter.CloseWithError(err)
			return
		}

		for _, op := range b.ops {
			if op.Operation != "upsert" {
				continue
			}
			if err := writeBlobChunks(encoder, op.ContentID, op.Source); err != nil {
				_ = pipeWriter.CloseWithError(err)
				return
			}
		}
	}()

	url := b.client.api.basePath() + "/repos/commit-pack"
	resp, err := doStreamingRequest(ctx, b.client.api.httpClient, http.MethodPost, url, jwtToken, pipeReader)
	if err != nil {
		return CommitResult{}, err
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		fallback := "createCommit request failed (" + itoa(resp.StatusCode) + " " + resp.Status + ")"
		statusMessage, statusLabel, refUpdate, err := parseCommitPackError(resp, fallback)
		if err != nil {
			return CommitResult{}, err
		}
		return CommitResult{}, newRefUpdateError(statusMessage, statusLabel, refUpdate)
	}

	var ack commitPackAck
	if err := decodeJSON(resp, &ack); err != nil {
		return CommitResult{}, err
	}

	return buildCommitResult(ack)
}

func (b *CommitBuilder) ensureNotSent() error {
	if b.sent {
		return errors.New("createCommit builder cannot be reused after send")
	}
	return nil
}

func buildCommitMetadata(options CommitOptions, ops []commitOperation) *commitMetadataPayload {
	files := make([]fileEntryPayload, 0, len(ops))
	for _, op := range ops {
		entry := fileEntryPayload{
			Path:      op.Path,
			ContentID: op.ContentID,
			Operation: op.Operation,
		}
		if op.Operation == "upsert" && op.Mode != "" {
			entry.Mode = string(op.Mode)
		}
		files = append(files, entry)
	}

	metadata := &commitMetadataPayload{
		TargetBranch:  options.TargetBranch,
		CommitMessage: options.CommitMessage,
		Author: authorInfo{
			Name:  options.Author.Name,
			Email: options.Author.Email,
		},
		Files: files,
	}

	if options.ExpectedHeadSHA != "" {
		metadata.ExpectedHeadSHA = options.ExpectedHeadSHA
	}
	if options.BaseBranch != "" {
		metadata.BaseBranch = options.BaseBranch
	}
	if options.Committer != nil {
		metadata.Committer = &authorInfo{
			Name:  options.Committer.Name,
			Email: options.Committer.Email,
		}
	}
	if options.Ephemeral {
		metadata.Ephemeral = true
	}
	if options.EphemeralBase {
		metadata.EphemeralBase = true
	}

	return metadata
}

func writeBlobChunks(encoder *json.Encoder, contentID string, reader io.Reader) error {
	buf := make([]byte, maxChunkBytes)
	var pending []byte
	for {
		n, err := reader.Read(buf)
		if n > 0 {
			if pending != nil {
				payload := blobChunkEnvelope{
					BlobChunk: blobChunkPayload{
						ContentID: contentID,
						Data:      base64.StdEncoding.EncodeToString(pending),
						EOF:       false,
					},
				}
				if err := encoder.Encode(payload); err != nil {
					return err
				}
			}
			pending = append(pending[:0], buf[:n]...)
		}
		if err == io.EOF {
			if pending == nil {
				payload := blobChunkEnvelope{
					BlobChunk: blobChunkPayload{
						ContentID: contentID,
						Data:      "",
						EOF:       true,
					},
				}
				return encoder.Encode(payload)
			}
			payload := blobChunkEnvelope{
				BlobChunk: blobChunkPayload{
					ContentID: contentID,
					Data:      base64.StdEncoding.EncodeToString(pending),
					EOF:       true,
				},
			}
			return encoder.Encode(payload)
		}
		if err != nil {
			return err
		}
	}
}

func normalizePath(path string) (string, error) {
	path = strings.TrimSpace(path)
	if path == "" {
		return "", errors.New("file path must be a non-empty string")
	}
	return strings.TrimPrefix(path, "/"), nil
}

func normalizeBranchName(value string) (string, error) {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return "", errors.New("createCommit targetBranch is required")
	}
	if strings.HasPrefix(trimmed, "refs/heads/") {
		branch := strings.TrimSpace(strings.TrimPrefix(trimmed, "refs/heads/"))
		if branch == "" {
			return "", errors.New("createCommit targetBranch is required")
		}
		return branch, nil
	}
	if strings.HasPrefix(trimmed, "refs/") {
		return "", errors.New("createCommit targetBranch must not include refs/ prefix")
	}
	return trimmed, nil
}

func normalizeLegacyTargetRef(ref string) (string, error) {
	trimmed := strings.TrimSpace(ref)
	if trimmed == "" {
		return "", errors.New("createCommit targetRef is required")
	}
	if !strings.HasPrefix(trimmed, "refs/heads/") {
		return "", errors.New("createCommit targetRef must start with refs/heads/")
	}
	branch := strings.TrimSpace(strings.TrimPrefix(trimmed, "refs/heads/"))
	if branch == "" {
		return "", errors.New("createCommit targetRef must include a branch name")
	}
	return branch, nil
}

func resolveCommitTTL(options InvocationOptions, defaultValue time.Duration) time.Duration {
	if options.TTL > 0 {
		return options.TTL
	}
	return defaultValue
}

func doStreamingRequest(ctx context.Context, client *http.Client, method string, url string, jwtToken string, body io.Reader) (*http.Response, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	if client == nil {
		client = http.DefaultClient
	}

	req, err := http.NewRequestWithContext(ctx, method, url, body)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+jwtToken)
	req.Header.Set("Content-Type", "application/x-ndjson")
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Code-Storage-Agent", userAgent())

	return client.Do(req)
}

func toReader(source interface{}) (io.Reader, error) {
	switch value := source.(type) {
	case nil:
		return nil, errors.New("unsupported content source; expected binary data")
	case []byte:
		return bytes.NewReader(value), nil
	case string:
		return strings.NewReader(value), nil
	case io.Reader:
		return value, nil
	default:
		return nil, errors.New("unsupported content source; expected binary data")
	}
}
