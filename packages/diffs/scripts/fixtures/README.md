# iterateOverDiff Benchmark Fixtures

`iterateOverDiffTopChanges.json` is generated from `scripts/benchmarkDiff.patch`
by `packages/diffs/scripts/generateIterateOverDiffFixture.ts`.

Regenerate it with:

```bash
bun ws diffs benchmark:iterate-over-diff:fixture
```

The generator ranks per-file patch chunks by changed lines, parses the largest
chunks through the package patch parser, and stores the resulting
`FileDiffMetadata` objects for repeatable iterator benchmarks.
