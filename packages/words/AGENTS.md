# Agent guide

Agent guide for **@pierre/words**, a markdown renderer written in WebAssembly
Text (WAT).

## Ground rules

- **Keep the parser in `src/*.wat`.** JavaScript is only host glue (`lib/`),
  build code (`scripts/`), tests, and benchmarks. Never move parsing or
  rendering into JS.
- **Protect performance.** Two passes, no tree, no allocation. Keep scans
  single-pass, use the 16-byte SIMD helpers in `src/scan.wat` for anything that
  searches, and run `moonx words:bench --ignore-ci-checks` after substantial
  changes.
- **Keep conformance at 100%.** `moonx words:test-spec` must stay at 1326/1326
  GFM.
- **Add no runtime dependencies.** `wabt` and `binaryen` are required dev
  dependencies; the benchmark skips missing rivals.
- Use pnpm for dependencies and Moon for tasks. Preserve the imported Node.js
  test runner (`node:test`, top-level await) while migrating this package.
- Host glue, scripts, tests, and benchmarks use TypeScript. The build emits
  JavaScript and declarations with tsdown.

## Architecture

Read [ARCHITECTURE.md](./ARCHITECTURE.md) before changing `src/`.

## Commands

Build-dependent benchmarks are opt-in so CI does not run timing suites or
download browsers automatically. In CI-marked shells, use
`moonx words:bench-quick --ignore-ci-checks` (or the corresponding benchmark
target). Run `words:bench-setup` once before browser comparisons. See
[`benchmark/README.md`](./benchmark/README.md) for the pinned comparison tools,
quick/full runs, and published chart evidence.

| Command                 | Purpose                                                                |
| ----------------------- | ---------------------------------------------------------------------- |
| `pnpm install`          | Install dev dependencies                                               |
| `moonx words:build`     | Emit `dist/md.wat`, `dist/md.wasm`, and the inlined Wasm JS in `dist/` |
| `moonx words:test`      | Unit tests, fuzzing, and the grow suite                                |
| `moonx words:test-spec` | The CommonMark and GFM conformance suites                              |
| `moonx words:bench`     | Benchmark against md4x and markdown-it                                 |
| `moonx words:gen-spec`  | Re-download the specification fixtures                                 |

## Traps this codebase has already hit

- **`i32.and` is bitwise.** `(i32.and a b)` as a logical AND is only correct
  when both operands are 0 or 1. Wrap a mask or a count in
  `(i32.ne x (i32.const 0))` first — this bug class cost two silent misparses.
- **Scratch pointers go stale.** Anything inside the scratch region moves when
  the output grows. Address it by offset, recompute `$slotAt`/`$scratchBase`
  after any call that can allocate, and keep `$scratchUsed` covering everything
  that must survive the move.
- **Record contiguity.** A leaf's lines are appended at `$rec`, so nothing else
  may be appended while a leaf is open. Dropping trailing lines lowers `nLines`
  but never `size`.
- **Emphasis lengths.** The "rule of three" uses the delimiter run's _original_
  length (`$markLen`, which is `end - beg`); how many characters a pair consumes
  uses the _remaining_ length in `$M.rem`. They are separate quantities for a
  reason.
- **A consumed line is not a blank line.** A thematic break, a table delimiter
  row or a fence leaves `$pos` at the line end, so the `$findFirstNonspace` that
  follows reports a blank line. `$blankBookkeeping` masks that with `$skipLine`;
  without it the enclosing list turns loose.
- **Frontmatter output is JSON, not YAML.** Never copy a scalar or a collection
  through verbatim: `.5`, `007` and `[a, b,]` are all legal YAML and all break
  `JSON.parse`, which the host calls on the metadata. `$yIsNumber` gates bare
  numbers and `$yFlow` rebuilds collections rather than copying them.

## Testing conventions

`test/api_test.ts` are `node:test` suites; add new cases to whichever fits.
balanced tags, and determinism. A failure prints the offending input; reduce it
by hand before fixing.

- `test/fuzz_test.ts` renders seeded random input and asserts no trap, valid
  UTF-8,
- `test/grow_test.ts` renders each stress document twice, once on a fresh
  instance that has to grow the memory and once on one already large enough, and
  requires the bytes to match. It is the detector for the stale-scratch-pointer
  class above; keep a case in it for any path that writes far more than it
  reads.
- `test/html_test.ts`, `test/ansi_test.ts`, `test/frontmatter_test.ts`, and
- `test/spec_test.ts` is the conformance gate. It reads `test/spec/*-spec.json`.
- To sweep for stale pointers exhaustively, build a variant whose `$ensureOut`
  and `$ensureRec` do `(memory.grow (i32.const 1))` and `$rebase` on _every_
  call, then diff it against the normal build over the spec fixtures. Every
  offset-addressed read survives; every pointer-addressed one does not.
- A render result is a view of Wasm memory and is invalidated by the next call.
  Decode or copy it before rendering anything else.
