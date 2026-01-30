# Git Storage SDK – Agent Notes

This package (`@pierre/storage`) is published publicly and ships to external
customers. Treat the repository as production-critical: follow semver
expectations, avoid breaking changes without coordination, and keep
documentation in sync with code.

## Package Purpose

- TypeScript/ESM + CommonJS SDK for Pierre’s Git storage APIs.
- Generates authenticated Git remote URLs and wraps REST endpoints for repo
  management, diff retrieval, commit packs, and branch restore operations.
- Distributed via npm; consumers rely on the generated `dist` output.

## Build & Test

- Build: `pnpm --filter @pierre/storage build` (tsup with `tsconfig.tsup.json`).
- Tests: `pnpm --filter @pierre/storage exec vitest --run`.
- Full end-to-end smoke test hitting Pierre environments:
  `node packages/git-storage-sdk/tests/full-workflow.js -e production -s pierre -k /home/ian/pierre-prod-key.pem`
  (change the `-e`, `-s`, and key path for your setup). The script provisions a
  repo, commits changes, and exercises diff/list APIs via the SDK.

## Key Files

- `src/index.ts`: Public entry point (Repo/GitStorage classes).
- `src/types.ts`: Shared type definitions; keep in sync with gateway JSON.
- `tests/index.test.ts`: Unit coverage for API surface (uses mocked fetch).
- `tests/full-workflow.js`: Live workflow script exercising real services.
- `tsup.config.ts`: Declares build-time constants (API/STORAGE base URLs).

## Development Notes

- `resolveCommitTtlSeconds` default TTL = 1 hour unless overridden.
- Use `DEFAULT_TOKEN_TTL_SECONDS` for 1-hour defaults (avoid hard-coded
  `1 * 60 * 60`).
- `Repo.restoreCommit` streams metadata to `repos/restore-commit`. Legacy
  `restore-commits` and `reset-commits` endpoints remain deployed but the SDK no
  longer auto-falls back; callers must hit those routes explicitly if needed.
- Commit builder (`createCommit().send()`) and `Repo.restoreCommit` throw
  `RefUpdateError` when the backend rejects a ref update; keep
  status/reason/message/ref mapping intact.
- `Repo.createCommitFromDiff` streams pre-generated patches to
  `repos/diff-commit` (accepts the diff payload directly and returns a
  `Promise<CommitResult>`). It shares the same `RefUpdateError` semantics—reuse
  the commit-pack helpers when adjusting error handling.
- Authentication relies on ES256 private key; see README for sample key.
- When adjusting request/response shapes, reflect changes in both TypeScript
  types and README.
- Avoid importing Node built-ins that break browser usage; the SDK is intended
  for Node + edge runtimes with fetch available.
- Maintain the Result vs Response distinction: raw API payloads remain
  `*Response` while SDK consumers receive camelCase `*Result` objects. Update
  both transformer utilities and docs together.
- Diff responses normalize the Git status via `normalizeDiffState`, exposing
  both `state` and `rawState`; extend that mapping instead of passing raw enums
  through directly.
- Webhook validation returns typed push events (parsed `Date`, camelCase fields)
  or a `WebhookUnknownEvent` fallback—keep this discriminated union intact when
  adding new events.
- Commit and commit-list APIs convert timestamps to `Date` while preserving
  `rawDate`; apply the same pattern to future time fields.
- Commit builder accepts `Blob`, `File`, `ReadableStream`, and iterable sources;
  new sources should be funneled through `toAsyncIterable`/`ensureUint8Array`.
- `CommitFileOptions.mode` is restricted to `GitFileMode` literals; ensure
  additional modes are codified there.
- `CommitTextFileOptions.encoding` supports Node `Buffer` encodings and defaults
  to UTF-8; retain the Buffer-based fallback for non-UTF encodings.

## Release Checklist

- Ensure `pnpm test` and `build` succeed.
- Update version in `package.json` when shipping changes.
- Verify README snippets remain accurate.
- Communicate breaking changes to customer-facing channels.
