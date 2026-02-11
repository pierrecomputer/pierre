# File Tree Testing Strategy

## Default Approach

- Prefer unit/integration tests with `bun test`.
- Use browser E2E tests only for browser-only behavior that cannot be reliably
  validated in jsdom.

## When Playwright Is Appropriate

Use Playwright when the behavior requires a real browser engine, for example:

- computed style assertions
- shadow DOM style encapsulation boundaries
- CSS custom property flow into shadow roots

If a unit test can prove behavior, write a unit test instead.

## E2E Scope Rules

- Keep Playwright coverage intentionally small and high-value.
- Add the minimum number of end-to-end tests needed to protect critical
  behavior.
- Prefer direct assertions over broad page snapshots.

## Snapshot Guidance

- Avoid snapshots that capture large or incidental output.
- If snapshots are used, keep them shallow and tightly scoped to the exact
  contract being tested.

## Commands

From repo root:

```bash
bun ws file-tree test
bun ws file-tree test:e2e
```

`test:e2e` automatically:

1. builds `packages/file-tree/dist`
2. installs Chromium binary if missing
3. runs Playwright tests
