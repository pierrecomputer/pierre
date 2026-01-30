package storage

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
)

type diffCommitExecutor struct {
	options CommitFromDiffOptions
	client  *Client
}

func (d *diffCommitExecutor) normalize() (CommitFromDiffOptions, error) {
	options := d.options
	options.TargetBranch = strings.TrimSpace(options.TargetBranch)
	options.CommitMessage = strings.TrimSpace(options.CommitMessage)
	options.ExpectedHeadSHA = strings.TrimSpace(options.ExpectedHeadSHA)
	options.BaseBranch = strings.TrimSpace(options.BaseBranch)

	if options.Diff == nil {
		return options, errors.New("createCommitFromDiff diff is required")
	}

	branch, err := normalizeDiffBranchName(options.TargetBranch)
	if err != nil {
		return options, err
	}
	options.TargetBranch = branch

	if options.CommitMessage == "" {
		return options, errors.New("createCommitFromDiff commitMessage is required")
	}

	if strings.TrimSpace(options.Author.Name) == "" || strings.TrimSpace(options.Author.Email) == "" {
		return options, errors.New("createCommitFromDiff author name and email are required")
	}
	options.Author.Name = strings.TrimSpace(options.Author.Name)
	options.Author.Email = strings.TrimSpace(options.Author.Email)

	if options.BaseBranch != "" && strings.HasPrefix(options.BaseBranch, "refs/") {
		return options, errors.New("createCommitFromDiff baseBranch must not include refs/ prefix")
	}
	if options.EphemeralBase && options.BaseBranch == "" {
		return options, errors.New("createCommitFromDiff ephemeralBase requires baseBranch")
	}

	if options.Committer != nil {
		if strings.TrimSpace(options.Committer.Name) == "" || strings.TrimSpace(options.Committer.Email) == "" {
			return options, errors.New("createCommitFromDiff committer name and email are required when provided")
		}
		options.Committer.Name = strings.TrimSpace(options.Committer.Name)
		options.Committer.Email = strings.TrimSpace(options.Committer.Email)
	}

	return options, nil
}

func (d *diffCommitExecutor) send(ctx context.Context, repoID string) (CommitResult, error) {
	options, err := d.normalize()
	if err != nil {
		return CommitResult{}, err
	}

	ttl := resolveCommitTTL(options.InvocationOptions, defaultTokenTTL)
	jwtToken, err := d.client.generateJWT(repoID, RemoteURLOptions{Permissions: []Permission{PermissionGitWrite}, TTL: ttl})
	if err != nil {
		return CommitResult{}, err
	}

	diffReader, err := toReader(options.Diff)
	if err != nil {
		return CommitResult{}, err
	}

	metadata := buildDiffCommitMetadata(options)

	pipeReader, pipeWriter := io.Pipe()
	encoder := json.NewEncoder(pipeWriter)
	encoder.SetEscapeHTML(false)

	go func() {
		defer pipeWriter.Close()
		if err := encoder.Encode(metadataEnvelope{Metadata: metadata}); err != nil {
			_ = pipeWriter.CloseWithError(err)
			return
		}
		if err := writeDiffChunks(encoder, diffReader); err != nil {
			_ = pipeWriter.CloseWithError(err)
			return
		}
	}()

	url := d.client.api.basePath() + "/repos/diff-commit"
	resp, err := doStreamingRequest(ctx, d.client.api.httpClient, http.MethodPost, url, jwtToken, pipeReader)
	if err != nil {
		return CommitResult{}, err
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		fallback := "createCommitFromDiff request failed (" + itoa(resp.StatusCode) + " " + resp.Status + ")"
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

func buildDiffCommitMetadata(options CommitFromDiffOptions) *commitMetadataPayload {
	metadata := &commitMetadataPayload{
		TargetBranch:  options.TargetBranch,
		CommitMessage: options.CommitMessage,
		Author: authorInfo{
			Name:  options.Author.Name,
			Email: options.Author.Email,
		},
	}

	if options.ExpectedHeadSHA != "" {
		metadata.ExpectedHeadSHA = options.ExpectedHeadSHA
	}
	if options.BaseBranch != "" {
		metadata.BaseBranch = options.BaseBranch
	}
	if options.Ephemeral {
		metadata.Ephemeral = true
	}
	if options.EphemeralBase {
		metadata.EphemeralBase = true
	}
	if options.Committer != nil {
		metadata.Committer = &authorInfo{
			Name:  options.Committer.Name,
			Email: options.Committer.Email,
		}
	}

	return metadata
}

func writeDiffChunks(encoder *json.Encoder, reader io.Reader) error {
	buf := make([]byte, maxChunkBytes)
	var pending []byte
	for {
		n, err := reader.Read(buf)
		if n > 0 {
			if pending != nil {
				payload := diffChunkEnvelope{
					DiffChunk: diffChunkPayload{
						Data: base64.StdEncoding.EncodeToString(pending),
						EOF:  false,
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
				payload := diffChunkEnvelope{
					DiffChunk: diffChunkPayload{
						Data: "",
						EOF:  true,
					},
				}
				return encoder.Encode(payload)
			}
			payload := diffChunkEnvelope{
				DiffChunk: diffChunkPayload{
					Data: base64.StdEncoding.EncodeToString(pending),
					EOF:  true,
				},
			}
			return encoder.Encode(payload)
		}
		if err != nil {
			return err
		}
	}
}

func normalizeDiffBranchName(value string) (string, error) {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return "", errors.New("createCommitFromDiff targetBranch is required")
	}
	if strings.HasPrefix(trimmed, "refs/heads/") {
		branch := strings.TrimSpace(strings.TrimPrefix(trimmed, "refs/heads/"))
		if branch == "" {
			return "", errors.New("createCommitFromDiff targetBranch must include a branch name")
		}
		return branch, nil
	}
	if strings.HasPrefix(trimmed, "refs/") {
		return "", errors.New("createCommitFromDiff targetBranch must not include refs/ prefix")
	}
	return trimmed, nil
}
