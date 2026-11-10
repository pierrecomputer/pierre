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

Trees starts its stable release line at `1.0.0`. Use normal semver bumps for
subsequent stable releases. Reserve prerelease versions and `--tag=beta` for
beta releases.

Run `pnpm install` to update `pnpm-lock.yaml`, commit, open a PR, merge.
Releases must come from merged commits on `main`.

Run `moon run root:format root:lint trees:typecheck trees:test` before merging.

## 1. Confirm auth

```bash
pnpm whoami            # must print an npm username with @pierre publish access
```

If npm requires publish-time 2FA, run the publish command from a real terminal
and enter a fresh code when pnpm asks. The script attaches the upload and
dist-tag steps to `/dev/tty`, because moon's task stdio is captured and pnpm
otherwise cannot prompt. You may still pass `--otp=<code>` for a freshly
generated classic OTP; the script forwards it to both `pnpm publish` and
`pnpm dist-tag add`, and redacts it from its own logs.

## 2. Rehearse with `--dry-run`

From `packages/trees`:

```bash
CI= moonx trees:publish --ignore-ci-checks -- --dry-run --tag=latest
```

Pass `--tag=latest` explicitly for stable releases; the script defaults to
`beta`. While preparing an uncommitted release, add `--dirty` to this dry-run
command only. Repeat the rehearsal from clean `main` before publishing.

The script will:

1. Verify the working tree is clean (override with `--dirty` only if you know
   what you're doing).
2. `moonx trees:build` (runs the V3 `assert-no-path-store` gate automatically).
3. `pnpm pack --pack-destination` to a tempdir, untar, strip
   `@pierre/path-store` from the unpacked `package.json`, and remove
   release-only lifecycle scripts.
4. Repack that rewritten package into a final tarball.
5. Verify the final tarball has no `@pierre/path-store` references and no
   `*.tsbuildinfo` files.
6. Run `pnpm publish --dry-run` against the final tarball, print the
   `package.json` diff and final tarball listing, then stop without uploading.

Inspect the diff. It should delete the `@pierre/path-store` dependency and the
release-only scripts that are meaningless inside the packed artifact.

## 3. Consumer smoke tests

Create fresh consumer apps **outside** the monorepo so workspace resolution does
not mask packaging bugs. Install the final tarball printed by `--dry-run`.

- React `18.3.1`
- React `19`

In each:

1. Install the final `pierre-trees-<version>.tgz` with `pnpm add`.
2. Confirm `@pierre/path-store` is absent from the installed dependencies.
3. Typecheck the consumer against its own `tsconfig`.
4. Run a production build.
5. Render a simple tree in a real browser.
6. Exercise each subpath: `@pierre/trees`, `@pierre/trees/react`,
   `@pierre/trees/ssr`, `@pierre/trees/web-components`.

**Release-age note.** pnpm enforces the workspace `minimumReleaseAge` from
`pnpm-workspace.yaml`. Exact pre-existing packages needed during migration may
be added to `minimumReleaseAgeExclude`; do not lower the workspace policy for a
release.

## 4. Publish the stable release

After the release PR is merged and the consumer checks pass, run from clean
`main`:

```bash
CI= moonx trees:publish --ignore-ci-checks -- --tag=latest --tag-release --release-branch=main
```

This uploads the version once under `latest`, then creates and pushes the
annotated git tag `@pierre/trees@<version>`. Do not use `--dirty` for uploads.

Verify on npm:

```bash
pnpm view @pierre/trees@<version> version
pnpm view @pierre/trees dist-tags --json
```

## 5. Prereleases and existing uploads

For a prerelease version, use `--tag=beta` instead of `--tag=latest`. A stable
release needs a stable version in `package.json`; moving a beta version to
`latest` does not change its version.

If you already uploaded the intended stable version under `beta`, promote it
without running the publish script again. The script always uploads a tarball,
even with `--promote-latest`, and npm does not allow publishing the same version
twice.

After verifying that published version and checking out its merged release
commit on `main`:

```bash
pnpm dist-tag add @pierre/trees@<version> latest
git tag -a "@pierre/trees@<version>" -m "@pierre/trees <version>"
git push origin "@pierre/trees@<version>"
```

## 6. Cleanup

If you spun up dev servers, Playwright fixtures, or Chrome debug instances
during verification, release the ports:

```bash
moonx root:wt -- clean
```

## Recovering from a failed publish

If the script fails, check `pnpm view @pierre/trees@<version> version` and
`pnpm view @pierre/trees dist-tags --json` before retrying. An upload may have
succeeded before a later dist-tag or git-tag step failed. Complete only the
missing steps for an existing version.

If an uploaded release has a defect, **do not `pnpm unpublish`**. Fix the defect
and publish a new version: a patch release after a stable release, or the next
prerelease number while on a beta track.

## Quick checklist

- [ ] release branch cut, `version` bumped, `CHANGELOG.md` updated
- [ ] release PR merged into `main`
- [ ] `pnpm whoami` confirms publish access to `@pierre`
- [ ] `CI= moonx trees:publish --ignore-ci-checks -- --dry-run --tag=latest`
      reviewed (`@pierre/path-store` and release-only scripts should disappear
      from `package.json`)
- [ ] React 18.3.1 consumer smoke test passed (all four subpaths, no
      `@pierre/path-store` in `node_modules`)
- [ ] React 19 consumer smoke test passed (all four subpaths, no
      `@pierre/path-store` in `node_modules`)
- [ ] stable version published with `--tag=latest --release-branch=main`
- [ ] npm version and `latest` dist-tag verified
- [ ] git tag pushed (`@pierre/trees@<version>`)
- [ ] `moonx root:wt -- clean` from the monorepo root
