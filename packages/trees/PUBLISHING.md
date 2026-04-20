# Publishing `@pierre/trees`

This guide covers the release flow for `@pierre/trees` and its published runtime
prerequisite, `@pierre/path-store`. Follow it end-to-end on every release — the
steps are short on purpose and every checkbox catches something that has bitten
us before.

## Release order

Publish in this order:

1. `@pierre/path-store`
2. `@pierre/trees`

`@pierre/trees` depends on `@pierre/path-store` at runtime. In the repo,
`packages/trees/package.json` keeps that dependency as `workspace:*`. Bun
rewrites it to the concrete published version in the packed artifact. Do **not**
replace that workspace dependency by hand in the repo.

## 0. Bump versions and open a release branch

Cut a branch first — never publish from `main` directly.

```bash
git checkout -b release/trees-<version>
```

Then bump the package versions you intend to publish. Edit by hand; do **not**
run `bun add` inside a package directory (see `AGENTS.md` for why):

- `packages/path-store/package.json` — bump if `path-store` changed
- `packages/trees/package.json` — always bump for a `trees` release

Both packages currently follow a `1.0.0-beta.<n>` track. Bump the `<n>` for
beta-only changes. If you need to promote out of beta, drop the suffix (`1.0.0`)
and coordinate the dist-tag move (see step 6).

Update `bun.lock` and the per-package `CHANGELOG.md` (create one if it does not
exist), then commit:

```bash
bun install
git add packages/path-store/package.json packages/trees/package.json bun.lock \
        packages/path-store/CHANGELOG.md packages/trees/CHANGELOG.md
git commit -m "release: trees <version>, path-store <version>"
```

Open a PR for review and merge before publishing. Releases must come from merged
commits on `main`.

## 1. Confirm npm authentication

`bun publish` uses your npm credentials. Verify before you start so a failed
auth check does not strand you between the two publishes:

```bash
bun pm whoami            # should print an npm username with publish access to @pierre
```

If this errors, run `npm login` (or `bun pm login`) and retry. The `@pierre`
scope must be writable by your account.

## 2. Verify `@pierre/path-store`

From the monorepo root:

```bash
bun ws path-store tsc
bun ws path-store test
bun ws path-store test:demo
```

From `packages/path-store`:

```bash
bun run build
bun publish --dry-run --tag beta
bun pm pack --filename pierre-path-store-test.tgz --quiet
```

Inspect the packed artifact before the real publish:

```bash
tar -tzf pierre-path-store-test.tgz | sort
tar -xOzf pierre-path-store-test.tgz package/package.json | jq .
```

The package should ship exactly:

- `dist/` (built JS + `.d.ts` + sourcemaps)
- `LICENSE.md`
- `NOTICE.md`
- `README.md`
- `package.json`

The packed `package.json` should have `"version": "<the new version>"` and no
`workspace:*` references.

## 3. Publish `@pierre/path-store`

From `packages/path-store`:

```bash
bun publish --tag beta
```

Always publish to the `beta` tag first. Promote to `latest` only after the trees
smoke tests below have passed (step 6).

Verify npm can see the version:

```bash
npm view @pierre/path-store@<version> version
npm view @pierre/path-store dist-tags --json
```

## 4. Verify `@pierre/trees`

From the monorepo root:

```bash
bun ws trees tsc
bun ws trees test
bun ws trees test:e2e
```

From `packages/trees`:

```bash
ATTW=true bun run build
bun publish --dry-run --tag beta
bun pm pack --filename pierre-trees-test.tgz --quiet
```

Release bar:

- ATTW must not report any `No resolution` findings.
- The remaining ATTW warnings should only be the intentional ESM-only
  `CJS resolves to ESM` warnings for these subpaths:
  - `.`
  - `./react`
  - `./ssr`
  - `./web-components`

Inspect the packed artifact:

```bash
tar -tzf pierre-trees-test.tgz | sort
tar -xOzf pierre-trees-test.tgz package/package.json | jq .
```

Confirm the packed `package.json`:

- `"version"` matches the bump from step 0
- `dependencies["@pierre/path-store"]` is the **concrete published version**,
  not `workspace:*`
- `typesVersions` is present
- `peerDependencies.react` is `"^18.3.1 || ^19.0.0"` (and same for `react-dom`)

Confirm the file list includes `NOTICE.md` and `dist/`.

## 5. Run live consumer smoke tests

Create two fresh consumer apps that install `@pierre/trees` from npm. Do this in
a scratch directory **outside** the monorepo so workspace resolution does not
mask packaging bugs.

- React `18.3.1`
- React `19`

In each consumer:

1. install `@pierre/trees@<version>` from npm
2. confirm `@pierre/path-store` resolves transitively from npm
3. run typecheck against the consumer's own `tsconfig`
4. run a production build
5. render a simple tree in a real browser
6. exercise imports from each subpath:
   - `@pierre/trees`
   - `@pierre/trees/react`
   - `@pierre/trees/ssr`
   - `@pierre/trees/web-components`

**Bun note.** Immediately after publishing, Bun may block a fresh install
because of its `minimum-release-age` protection. For same-day smoke tests,
install with:

```bash
bun install --minimum-release-age 0
```

If smoke tests fail after `path-store` is already on npm, **do not unpublish**.
Bump `path-store` again with the fix (e.g. `1.0.0-beta.<n+1>`), publish a new
beta, and continue. See "Recovering from a partial release" below.

## 6. Publish `@pierre/trees`

From `packages/trees`:

```bash
bun publish --tag beta
```

Then move `latest` to the same version:

```bash
npm dist-tag add @pierre/trees@<version> latest
```

Verify npm metadata:

```bash
npm view @pierre/trees@<version> version
npm view @pierre/trees dist-tags --json
```

For the current release process, both `beta` and `latest` should point to the
same published `trees` version. `path-store` deliberately stays on `beta` only
until we cut a non-beta major.

## 7. Tag the release in git

After both packages are on npm, tag the merge commit so we can map any future
bug report back to source:

```bash
git checkout main
git pull
git tag -a "@pierre/path-store@<version>" -m "@pierre/path-store <version>"
git tag -a "@pierre/trees@<version>"      -m "@pierre/trees <version>"
git push origin "@pierre/path-store@<version>" "@pierre/trees@<version>"
```

If only one of the two packages was bumped, only push that tag.

## 8. Cleanup

If you started Playwright fixtures, preview servers, or any other long-running
worktree processes during verification, clean them up from the monorepo root:

```bash
bun run wt clean
```

## Recovering from a partial release

The most common failure mode is "`path-store` published but `trees` failed." The
recovery path:

1. **Do not `npm unpublish`.** Once a version is on npm, it is effectively
   permanent. Unpublishing within the 72-hour window can still strand any
   consumer who installed during that window.
2. Fix the underlying issue on a follow-up commit.
3. Bump only the package that needs a re-publish. If `trees` failed verification
   but `path-store` is fine on npm, bump `trees` to the next beta and publish
   only `trees`. Skip steps 2–3 of this guide on the re-run.
4. If `path-store` itself was bad, bump it (`1.0.0-beta.<n+1>`), publish, then
   bump `trees` to point its smoke tests at the new `path-store` and publish
   that too.

## Quick checklist

- [ ] release branch cut, versions bumped, `bun install` run
- [ ] `CHANGELOG.md` updated for each bumped package
- [ ] release PR merged into `main`
- [ ] `bun pm whoami` confirms publish access to `@pierre`
- [ ] `path-store`: tsc + test + test:demo green
- [ ] `path-store`: built, dry-run + pack inspected (correct files, concrete
      version)
- [ ] `path-store` published to `beta`
- [ ] `trees`: tsc + test + test:e2e green
- [ ] `trees`: ATTW clean (only the four expected ESM warnings)
- [ ] `trees`: pack inspected (NOTICE.md, typesVersions, concrete `path-store`
      dep, React 18+19 peer range)
- [ ] React 18.3.1 consumer smoke test passed (all four subpaths)
- [ ] React 19 consumer smoke test passed (all four subpaths)
- [ ] `trees` published to `beta`
- [ ] `trees` `latest` dist-tag promoted to the new version
- [ ] git tags pushed for every published package
- [ ] `bun run wt clean` from monorepo root
