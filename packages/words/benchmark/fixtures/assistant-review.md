I read through the PR (`feat: incremental index rebuild`, 14 files, +612/−188). Overall the direction is right — splitting the rebuild into *plan* and *apply* phases is the correct shape — but there are two correctness issues that should block merge, plus a handful of smaller things. Details below, ordered by severity.

## 🚫 Blocking

### 1. `planRebuild()` drops entries whose path contains a `#`

`src/index/plan.ts:48` splits the manifest line on `#` to strip comments:

```diff
- const [path] = line.split('#');
+ const path = line.startsWith('#') ? '' : line.replace(/\s+#.*$/, '');
```

The original intent is clear, but paths like `docs/c#/overview.md` and `notes/issue#42.md` are both legal and both present in the fixtures (`fixtures/manifest-unicode.txt`, lines 7 and 19). With the current code they're silently truncated to `docs/c` and `notes/issue`, which then fail the existence check and get *removed* from the index on the next apply. The suggested replacement only treats `#` as a comment marker when preceded by whitespace, which matches how the manifest is documented in `MANIFEST.md`[^1].

A regression test that would have caught it:

```typescript
test('paths may contain # when not preceded by whitespace', () => {
  const plan = planRebuild(['docs/c#/overview.md', 'notes/issue#42.md  # tracked']);
  expect(plan.entries.map((e) => e.path)).toEqual([
    'docs/c#/overview.md',
    'notes/issue#42.md',
  ]);
});
```

### 2. `applyPlan()` is not atomic across the `remove` → `add` boundary

`src/index/apply.ts:112–140` removes stale entries, then adds new ones, with an `await fs.writeFile` between the two. If the process dies after the first write, the on-disk index has the removals but not the additions, and `loadIndex()` has no way to tell. Two options, in order of preference:

1. Write the new index to `index.json.tmp` and `rename()` it over the old file (atomic on POSIX and on NTFS for same-volume renames).
2. Keep the two-phase write but add a `generation` field and a `pending` marker, and have `loadIndex()` roll back when it finds a marker without a matching generation.

Option 1 is ~10 lines and removes the whole class of problem; I'd go with that. ~~Option 3, write-ahead logging,~~ is overkill for a file this size.

## ⚠️ Should fix

- **`hashFile()` reads the whole file into memory** (`src/index/hash.ts:21`). Fine for markdown, not fine for the `.pdf` and `.mp4` assets the manifest now allows. Use `createReadStream().pipe(createHash('sha256'))` — same output, bounded memory.
- **Concurrency is unbounded.** `Promise.all(entries.map(hashFile))` will open every file at once; on the 40k-entry test manifest this hits `EMFILE` on macOS with the default `ulimit -n 256`. A small pool (`p-limit`, or the 15-line hand-rolled one already in `src/util/pool.ts`) with concurrency 32 was ~4% slower in my run and never failed.
- The `--dry-run` flag prints the plan but still **touches `index.lock`**. Either skip the lock in dry-run or document that it takes it; the current behavior surprised me when a second terminal's real run was blocked.
- `src/index/plan.ts` imports `node:path` as `path` and also declares a local `path` in `planRebuild` — it works because of shadowing, but it reads as a bug at first glance. Rename the local to `entryPath`.

## 💭 Nits (non-blocking)

- `README.md` still says "rebuilds are full rebuilds"; the second paragraph of *Indexing* needs updating.
- `rebuild --verbose` logs timestamps in local time while everything else in the CLI uses UTC. Use `toISOString()`.
- A couple of the new tests use `setTimeout(…, 50)` to "wait for the watcher". They pass locally and will be flaky on CI; `await once(watcher, 'ready')` is already exposed.
- Minor: `Ünïcödé` paths in the fixture are NFC in `manifest-unicode.txt` but the hash test compares against an NFD literal; on macOS (APFS, NFD-normalizing) that passes by accident. Normalize explicitly with `.normalize('NFC')` on both sides.

## Measurements

I ran the rebuild on the three reference manifests, before and after this PR (M2, warm disk cache, median of 5):

| Manifest        | Entries | Before (full) | After (incremental, 1% changed) | After (full) |
| :-------------- | ------: | ------------: | ------------------------------: | -----------: |
| `small`         |     412 |        0.31 s |                          0.06 s |       0.33 s |
| `docs-site`     |   6,180 |        4.9 s  |                          0.41 s |        5.1 s |
| `all-assets`    |  40,217 |       61.2 s  |                          3.8 s  |      crashed |

The incremental path is the win we wanted (≈12–16× on realistic edits). The `all-assets` full rebuild crashing is the `EMFILE` issue above, not a regression — `main` crashes too — but it's worth fixing in this PR since the pool is cheap.

## Summary

- [ ] Fix the `#`-in-path truncation and add the test (blocking)
- [ ] Make `applyPlan()` atomic via temp-file + rename (blocking)
- [ ] Stream hashes and bound concurrency
- [ ] Dry-run shouldn't take the lock
- [ ] Docs/UTC/flaky-test nits

Happy to pair on the atomic write if useful — it's mostly moving existing code around. Nice work on the plan/apply split; once the two blockers are addressed this is a clear improvement over what's on `main`. See also the earlier discussion in https://github.com/example/indexer/issues/231 for the manifest grammar history.

[^1]: `MANIFEST.md`, "Comments": *"A `#` begins a comment only at the start of a line or after at least one whitespace character."*
