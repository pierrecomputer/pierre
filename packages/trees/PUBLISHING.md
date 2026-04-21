# Publishing `@pierre/trees`

Releases are driven by `packages/trees/scripts/publish.ts`. The script builds
trees, packs a source tarball, rewrites the package metadata, repacks a final
tarball, verifies that tarball, and uploads it to npm.

Path-store is **not** published. Its code is inlined into `@pierre/trees`'
`dist/` at build time via tsdown's `noExternal` configuration, so consumers only
ever install `@pierre/trees`.

## 0. Bump the version

Cut a release branch and bump the version by hand:

```bash
git checkout -b release/trees-<version>
```

- `packages/trees/package.json` — bump `version`.
- `packages/trees/CHANGELOG.md` — add an entry (create if missing).

Trees is on a `1.0.0-beta.<n>` track. Bump `<n>` for beta-only changes.

Run `bun install` to update `bun.lock`, commit, open a PR, merge. Releases must
come from merged commits on `main`.

## 1. Confirm auth

```bash
bun pm whoami            # must print an npm username with @pierre publish access
```

## 2. Rehearse with `--dry-run`

From `packages/trees`:

```bash
bun run publish-package -- --dry-run
```

The script will:

1. Verify the working tree is clean (override with `--dirty` only if you know
   what you're doing).
2. `bun run build` (runs the V3 `assert-no-path-store` gate automatically).
3. `bun pm pack` to a tempdir, untar, strip `@pierre/path-store` from the
   unpacked `package.json`, and remove release-only lifecycle scripts.
4. Repack that rewritten package into a final tarball.
5. Verify the final tarball has no `@pierre/path-store` references and no
   `*.tsbuildinfo` files.
6. Run `bun publish --dry-run` against the final tarball, print the
   `package.json` diff and final tarball listing, then stop without uploading.

Inspect the diff. It should delete the `@pierre/path-store` dependency and the
release-only scripts that are meaningless inside the packed artifact.

## 3. Consumer smoke tests

Create fresh consumer apps **outside** the monorepo so workspace resolution does
not mask packaging bugs. Do this against a beta publish (step 4 with
`--tag=beta`) or by installing the final tarball printed by `--dry-run`.

- React `18.3.1`
- React `19`

In each:

1. Install `@pierre/trees@<version>` from npm.
2. Confirm `ls node_modules/@pierre` shows **only** `trees` (no `path-store`).
3. Typecheck the consumer against its own `tsconfig`.
4. Run a production build.
5. Render a simple tree in a real browser.
6. Exercise each subpath: `@pierre/trees`, `@pierre/trees/react`,
   `@pierre/trees/ssr`, `@pierre/trees/web-components`.

**Bun note.** Bun's `minimum-release-age` protection can block fresh installs
right after a publish. Use:

```bash
bun install --minimum-release-age 0
```

## 4. Publish to `beta`

```bash
bun run publish-package -- --tag=beta
```

Verify on npm:

```bash
npm view @pierre/trees@<version> version
npm view @pierre/trees dist-tags --json
```

## 5. Promote to `latest`

After smoke tests pass on the beta tarball:

```bash
bun run publish-package -- --tag=latest --promote-latest --tag-release
```

`--promote-latest` moves the `latest` dist-tag to this version. `--tag-release`
creates and pushes a git tag (`@pierre/trees@<version>`).

You can also split these into separate invocations:

```bash
bun run publish-package -- --tag=latest     # publish under latest
npm dist-tag add @pierre/trees@<version> latest
git tag -a "@pierre/trees@<version>" -m "@pierre/trees <version>"
git push origin "@pierre/trees@<version>"
```

## 6. Cleanup

If you spun up dev servers, Playwright fixtures, or Chrome debug instances
during verification, release the ports:

```bash
bun run wt clean
```

## Recovering from a failed publish

Publish is atomic per tarball — the script either uploads the final artifact or
it doesn't. If `bun publish` fails inside the script, nothing was uploaded: fix
the issue, commit, and re-run.

If the publish succeeded but smoke tests fail afterwards, **do not
`npm unpublish`**. Bump to the next `1.0.0-beta.<n+1>`, publish again, and leave
the broken version stranded on npm with its bad `beta` tag.

## Quick checklist

- [ ] release branch cut, `version` bumped, `CHANGELOG.md` updated
- [ ] release PR merged into `main`
- [ ] `bun pm whoami` confirms publish access to `@pierre`
- [ ] `bun run publish-package -- --dry-run` reviewed (`@pierre/path-store` and
      release-only scripts should disappear from `package.json`)
- [ ] React 18.3.1 consumer smoke test passed (all four subpaths, no
      `@pierre/path-store` in `node_modules`)
- [ ] React 19 consumer smoke test passed (all four subpaths, no
      `@pierre/path-store` in `node_modules`)
- [ ] `bun run publish-package -- --tag=beta` succeeded
- [ ] `--tag=latest --promote-latest` run after smoke verification
- [ ] git tag pushed (`@pierre/trees@<version>`)
- [ ] `bun run wt clean` from the monorepo root
