---
name: highlights-native-lexers
description:
  Use when writing, optimizing, or syncing a hand-written native Rust lexer for
  @pierre/highlights (packages/highlights/rust/highlights/src/native), including
  porting a language from its WAT, porting WAT changes into an existing native
  lexer, or measuring native lexers against the translated ones.
---

# Highlights Native Lexers

The Rust build of `@pierre/highlights` has two lexers per language:

- **Translated** (`highlights/src/generated/`, gitignored): the WAT turned into
  Rust mechanically by `rust/xtask`. Regenerate with `moonx highlights:rust-gen`
  after any WAT change. Never edit it by hand.
- **Native** (`highlights/src/native/`): hand-written Rust that gives exactly
  the same token records, faster. One module per `src/langs/<module>.wat`, each
  behind its own cargo feature `native-<module>`. The JavaScript and TypeScript
  lexer is `native/fast.rs` (with `ecma.rs`, `ecma_scan.rs`), under
  `native-core`.

The WAT is the source of truth. A native lexer is a port of it, and a check
script decides whether the port is right. This skill is the procedure; follow it
step by step and do not improvise around it.

All paths below are relative to `packages/highlights/rust/` unless they start
with `src/` (relative to `packages/highlights/`).

## Hard Rules

1. **Identical output.** Native records must equal the translated lexer's, byte
   for byte, on every input. Never change a token color, merge, or boundary for
   speed. There is no "close enough".
2. **The WAT decides.** When native and translated disagree, the native port is
   wrong. Never edit the WAT, the translator, or generated code to make a port
   pass. If the WAT itself looks wrong, stop and report it.
3. **Never weaken a check.** Do not skip files, lower fuzz counts below the
   defaults for the final run, special-case inputs, or edit the check scripts,
   the bench, or the parity corpus to get a pass.
4. **Stay in your module.** Edit only `highlights/src/native/<module>.rs` (or a
   `native/<module>/` directory) and its `<module>.lock`. Shared files
   (`native/mod.rs`, `recs.rs`, `tables.rs`, `scan.rs`, `fast.rs`, `ecma*.rs`,
   `Cargo.toml`, `bench/`, `scripts/`) are off limits; if a module needs a
   shared change, stop and report what and why.
5. **Your own target directory.** Always pass `--target-dir`
   (`scripts/native-check.sh` defaults to `target/native-<module>`). Format with
   `rustfmt --edition 2024 <your files>`, never `cargo fmt` on the workspace.
   While several modules are in progress, the person coordinating runs the
   repo-wide `moon run root:format root:lint` at the end; a porting agent does
   not.
6. **No git state changes.** No commits, `git add`, stash, branch, or reset.
   Keep scratch files (copies of binaries, notes, profiles) in
   `target/native-<module>/scratch/`, not a shared scratch directory.
7. **Hard errors over silent damage.** A module reads its input only through
   `native::input::Input` and writes records only through `native::recs::Recs`:
   no raw pointers, `from_raw_parts`, `set_len`, or hand-rolled record writers
   in a module. Reads are checked (`byte`, `word`, `vec`) unless a measured hot
   path needs `byte_unchecked`/`word_unchecked`/`vec_unchecked`, each with a
   `// SAFETY:` comment (positions stay inside the input plus slack). Those
   assert their bounds in checked builds, and
   `scripts/native-check.sh <module> --checked` must pass.
8. **Portable code.** Native lexers build and give identical output on every
   target in `rust-toolchain.toml` (macOS, Linux, Windows; ARM and x86-64;
   wasm). Vector code uses only `crate::simd::V` (see Portable SIMD below): no
   `core::arch`, no `#[cfg(target_arch)]` in a module.
9. **Comments** state what the code does in plain words, timelessly. Each
   function's doc comment names the WAT function(s) it mirrors in backticks,
   e.g. ``/// The number after `0x` (`$goNumber`).``. That naming is the map the
   sync procedure relies on.

## The Pieces

| Piece                                      | What it is                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/langs/<module>.wat`                   | The lexer to port. `src/common.wat`, `src/scan.wat`, `src/sig.wat`, `src/embed.wat` hold shared helpers it may call.                                                                                                                                                                                                                                                                                                                                               |
| `src/languages.wat`                        | Which `$hl<Lang>` function each language name uses.                                                                                                                                                                                                                                                                                                                                                                                                                |
| `bun scripts/native-modules.ts [<module>]` | The modules and the languages each handles (e.g. `css` → `css less sass scss`).                                                                                                                                                                                                                                                                                                                                                                                    |
| `highlights/src/generated/wat_tables.rs`   | Every `keyword-table` (`GO_WORDS`, …) as `&[Keyword]` with `word`, 1-based `group`, and `value` (`-1` if none), and every named memory address (`MEM_*`).                                                                                                                                                                                                                                                                                                          |
| `highlights/src/generated/token_ids.rs`    | `$Token` ids (`crate::token_ids as tok`): `tok::KEYWORD_CONTROL`, …                                                                                                                                                                                                                                                                                                                                                                                                |
| `highlights/src/generated/lex_ids.rs`      | `$Lex` kinds of the ECMAScript scanner (`crate::lex_ids`).                                                                                                                                                                                                                                                                                                                                                                                                         |
| `native/tables.rs`                         | `KeywordTable::<N>::new(GO_WORDS)` (compile-time perfect hash with a first-byte/length prefilter; `.group()` and `.value()` answer like `keyword-table.get`/`.value`; `N` a power of two ≥ words²/4) and `byteset(b"…")` for `byteset.get`. A module may build its own table from the same generated data when that measures faster.                                                                                                                               |
| `native/recs.rs`                           | `Recs`, the record writer (a moving pointer, three words; `Copy`, keep it in a local): `load`, `tok(hl, end)` (non-empty token), `tok_branching` (same result, merge decided by a branch; cheaper where merges are rare), `push` (a token known to differ from the last one: no merge test), `emit(hl, lhs, rhs)` (`$emitTok`, skips empty), `gap(lhs, rhs)` (`$emitGap`), `extend(end)` (moves the last record's end; traps with no record), `is_empty`, `store`. |
| `native/input.rs`                          | `Input`, the input plus slack: `unsafe Input::new(inst, base, len)` (the one slice construction; lexer memory never moves on Unix and Windows, so it stays valid across translated calls), checked `byte`/`word`/`vec`, and `_unchecked` twins that assert in checked builds.                                                                                                                                                                                      |
| `native/scan.rs`                           | SIMD scans: `line_end`, `string_special`, `block_comment_end`, `utf8_span_end`, `find3`, and `first_lane` (the first set lane of a NEON compare) for module-local vector scans.                                                                                                                                                                                                                                                                                    |
| `native/mod.rs`                            | The registry. A module provides `pub(crate) fn lexer(name: &str) -> Option<Lexer>`; `Lexer` is `fn(&mut Instance, base, len)`.                                                                                                                                                                                                                                                                                                                                     |
| `scripts/native-check.sh <module>`         | The pass/fail check (below).                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `scripts/parity-corpus.ts`                 | Builds `target/parity/<lang>/`: real files from this machine plus the test sample. Run once if missing.                                                                                                                                                                                                                                                                                                                                                            |
| `scripts/native-report.sh`                 | PGO-built comparison of every native module against the translated lexers, written to `target/native-report.md`.                                                                                                                                                                                                                                                                                                                                                   |
| `scripts/native-ab.sh <A> <B> <input>`     | Interleaved runs of two bench binaries on one input, with medians: how to decide a change whose cycles move but whose instructions don't (or the reverse).                                                                                                                                                                                                                                                                                                         |
| `scripts/native-pgo.sh <module>`           | A PGO bench with only that module, trained on its corpora: the shipped build's numbers in a few minutes. Build one before and one after a change and compare them with `native-ab.sh`.                                                                                                                                                                                                                                                                             |

### How a native lexer runs

`Highlighter::tokenize_native` does what the translated entry does (`$sigReset`,
`$hlBegin`, input header, `inst.ext.recs` cleared with room for `len + 2`
records) and then calls your `Lexer` instead of the translated `$hl<Lang>`. Your
lexer:

- reads the input through `Input`, which doesn't borrow `inst`, so it can still
  call translated functions:

  ```rust
  // SAFETY: used only during this call; the input bytes don't change.
  let src = unsafe { Input::new(inst, base, len) };
  ```

  Lexer memory lives in an address-space reservation that never moves, and an
  access past its committed end faults (`rt/region.rs`). On wasm targets memory
  is a `Vec` that moves when it grows, so there an `Input` must not be used
  after a translated call that grows memory.

  Positions are input offsets, and `src[len]` is NUL. The bytes after that NUL
  are leftovers from earlier inputs: never let a result depend on them.
  Over-reading them is fine when the result is masked or compared only up to
  `len`. The NUL is a sentinel: a one-byte lookahead needs no bounds check when
  NUL can't match what it looks for;

- starts the way the WAT's `$hl<Lang>` starts, usually
  `$lexEmitLeadingContinuation`:
  `recs.gap(0, scan::utf8_span_end(src, 0, len))`;
- writes records through `Recs` with input offsets as ends: before each token
  `recs.gap(done, lhs)` for the whitespace since the last token, then
  `recs.tok(hl, rhs)`, exactly where the WAT calls `$emitGap` and `$emitTok`;
- may call translated functions for parts it delegates: `inst.f_<watName>(…)`
  (wrapper names follow the WAT, e.g. `$emitEscaped` → `f_emitEscaped`), with
  absolute addresses (`base + offset`) and with every global the callee reads
  set first (`inst.g_<name>`, e.g. `inst.g_ptr`, `inst.g_end`). Call
  `recs.store(inst)` before and `Recs::load(inst)` after, since translated
  emitters append to the same vector. Not every WAT function has a method: the
  build inlines some. Check with
  `grep -n 'fn f_<watName>(' highlights/src/generated/mod.rs` before planning to
  delegate one; a function without a method must be ported.

Native lexers run on the whole input only, with `$streaming` = 0 and every lexer
state argument 0 (the state a document starts in). Streaming and live-editing
code (`$streaming` branches, `$…StreamResume`, stream checkpoints, fence
registers) and resumed-state paths (such as CSS inside a JS template) never run:
don't port them. `src[len]` is always NUL.

WAT code uses memory addresses, where 0 often means "none". Native code uses
input offsets, where 0 is a real position: use `Option` or `usize::MAX` for
"none".

Delegating is how embedded languages work (HTML's `<style>`/`<script>`, Markdown
fences, template literals): call the same translated function the WAT calls at
that point. Delegate rare, complex paths too if porting them gains nothing.
Never delegate the hot path.

## Portable SIMD

`highlights/src/simd.rs` is the one vector type for every lexer: `V`, 16 bytes,
on NEON (aarch64), SSE (x86-64-v2, set in `.cargo/config.toml`), wasm `simd128`,
or plain arrays elsewhere. Every operation gives the same result on every
backend; its tests compare each backend with the arrays
(`cargo test -p highlights --lib simd`, plus `--target x86_64-apple-darwin`
under Rosetta and `--target wasm32-wasip1` under Node). A mask is a vector whose
lanes are all zeros or all ones, as comparisons return.

| Need                      | `V`                                                                                                     | NEON it compiles to                                          |
| ------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| load / store 16 bytes     | `V::load(p)`, `v.store(p)`, `V::from_array(&a)`                                                         | `vld1q_u8`, `vst1q_u8`                                       |
| constant                  | `V::splat(b)`, `V::zero()`                                                                              | `vdupq_n_u8`                                                 |
| compare                   | `eq`, `ne`, `le`, `ge`, `lt`, `gt` (unsigned), `gt_signed`, `high` (top bit set), `test` (`a & b != 0`) | `vceqq_u8`, `vcleq_u8`, `vcgtq_s8`, `vcltzq_s8`, `vtstq_u8`  |
| bits                      | `and`, `or`, `xor`, `andnot` (`a & !b`), `not`                                                          | `vandq_u8`, `vorrq_u8`, `veorq_u8`, `vbicq_u8`, `vmvnq_u8`   |
| arithmetic                | `add`, `sub` (wrapping), `shr::<N>()`                                                                   | `vaddq_u8`, `vsubq_u8`, `vshrq_n_u8`                         |
| 16-entry table            | `table.lookup(idx)`: `table[i]`, 0 for `i >= 16`                                                        | `vqtbl1q_u8`                                                 |
| any lane set              | `any()`                                                                                                 | `vmaxvq_u8`                                                  |
| first set lane of a mask  | `first()` (16 when none)                                                                                | `vshrn_n_u16` nibble mask                                    |
| a mask as an integer word | `lanes()` → `Lanes`: `any`, `first`, `before_first`, `and`, `or`, `not`                                 | `vshrn_n_u16` nibble mask (4 bits per lane; 1 bit elsewhere) |
| one bit per lane          | `bits()` (top bits, 16 bits)                                                                            | shift-accumulate                                             |
| one bit per byte of 64    | `V::bits64(a, b, c, d)` (masks)                                                                         | `vpaddq_u8` chain                                            |

To leave a scan loop, branch on `m.lanes().any()` and only then take `first()`:
comparing `first()` with 16 makes the compiler compute the index on every step.
Position tests ("is any `/` before the first delimiter") are `Lanes` operations
(`slash.lanes().and(delim.lanes().before_first())`).

Nibble classification is
`lo.lookup(v.and(V::splat(15))).and(hi.lookup(v.shr::<4>()))`. If a module needs
an operation `V` lacks, stop and report it rather than reaching for
`core::arch`.

## Porting a Module

Do these phases in order. Each ends with a concrete result; don't start the next
one until it holds.

### Phase 1 – Baseline and scope

1. `bun scripts/native-modules.ts <module>` → its languages.
2. If `target/parity/` is missing: `bun scripts/parity-corpus.ts`.
   `target/parity/sources.json` says how many real files each language has; a
   language with `0 files` is checked on its test sample and fuzzing only, and
   the report must say so.
3. Read `src/langs/<module>.wat` completely, and every function it calls in the
   shared WAT files. List each WAT function the module needs, and decide for
   each: port, or delegate (with a reason).

**Result:** the function list with port/delegate decisions.

### Phase 2 – Faithful port

1. Create `highlights/src/native/<module>.rs` (`-` becomes `_` in the file
   name). First line: `//! WAT sources: src/langs/<module>.wat …` listing every
   WAT file with a function you ported, shared files included, however small the
   function (a change there can change your output). Leave out files you only
   call into, and leave out `src/emit.wat` for `$emitTok`, `$emitGap`, and
   `$lexEmitLeadingContinuation`, which `Recs` implements. Then a module comment
   saying what the lexer does.
2. Provide `pub(crate) fn lexer(name: &str) -> Option<Lexer>` returning a
   function per language (variants such as `less`/`scss` usually pass a mode
   flag to one implementation).
3. Port rule for rule, **in the WAT's order**: the same branch order, the same
   lookahead, the same conditions, the same `$emitTok`/`$emitGap` points. Keep
   the WAT's structure recognizable; one Rust function per WAT function is the
   right start. Use generated data, never retyped data: keyword tables from
   `wat_tables`, token ids from `token_ids`, byte sets by copying the bytes of
   the `byteset.get` string into `tables::byteset` (WAT escapes are hex bytes:
   `\09` is `\x09`, `\22` is `"`).
4. Mirror WAT integer semantics exactly: `i32` wrapping, unsigned compares
   (`i32.lt_u`), and `i32.and`/`i32.or` as bitwise operations even where the WAT
   seems to mean a logical one. `(i32.and $depth (c == ']'))` is a bitwise AND
   of a count and 0/1; port it bitwise, even if that looks like a bug (report
   suspected WAT bugs, don't fix them).

**Result:** the module compiles under its feature:
`cargo build --release -p bench --features native-<module> --target-dir target/native-<module>`.

### Phase 3 – Parity

1. Run `scripts/native-check.sh <module> --update-lock --no-perf` (the lock
   doesn't exist yet; `--update-lock` creates it only when everything else
   passes).
2. For every mismatch, the check prints the record index, byte offset, both
   record lists, and context. Find the WAT rule that produces the expected
   record and fix the port to match it. Never fix a symptom (special-casing the
   input); fix the rule. Fuzz failures are saved in
   `target/native-fuzz/<languages>/fail-*.txt`; reproduce with
   `<target>/release/bench --native-parity <file renamed to .<lang>>`.
3. Repeat until PASS.
4. Once it passes, do the injected-bug check from Phase 5 right away: it proves
   the check is really running your lexer.

**Result:** PASS on the full check (default fuzz count).

### Phase 4 – Optimize

Run `scripts/native-check.sh <module>` (with perf) after every change and keep a
table: step, instructions per record and cycles per record for the `bench` and
`corpus` inputs, native and translated, kept or rejected. The check must PASS
after every structural change. Instructions are the steady metric; cycles move
with machine load. Without PGO, register allocation swings results about ±5% on
small edits, so judge a change by both inputs.

- The `bench` input is the test sample repeated, so the branch predictor learns
  it; `corpus` (real files) is the realistic measure of cycles.
- When instructions and cycles disagree (fewer instructions, more cycles, or the
  reverse), decide with `scripts/native-ab.sh` on the corpus input: keep the
  previous bench binary, rebuild, and compare 5 interleaved rounds.
- To see where time goes: `--profile-core native <input> <secs>` on small
  synthetic inputs, one construct each (e.g. 20,000 copies of `x `), or a CPU
  profile:
  `xctrace record --template 'CPU Profiler' --output <trace> --launch -- <bench> --profile-core native <input> 10`,
  then
  `xctrace export --input <trace> --xpath '/trace-toc/run[@number="1"]/data/table[@schema="cpu-profile"]'`
  (samples carry source lines; repeated backtraces appear as `ref=` to earlier
  ones; frame addresses are the instruction address plus one). Map addresses to
  lines with `atos -i` or to instructions with `objdump --disassemble`.

What has worked (JS/TS: 262 → 100 instructions per token):

- **One pass:** scan and color each token in the same step, no token buffer. A
  token whose color depends on the next token waits in local variables until
  that token is scanned.
- **Tables over chains:** one 256-entry byte-class table for dispatch, and one
  flags table per token kind instead of many separate set lookups.
- **Hot state in locals, rare state in a struct:** the dispatch loop's few live
  values stay in registers; rarely used state lives in a struct passed by
  reference to out-of-line helpers. Don't let a struct's address escape into
  helpers the hot loop calls.
- **Cold paths out of line:** `#[cold] #[inline(never)]` on rare helpers
  (Unicode, unusual whitespace, rare syntax), and `core::hint::cold_path()` on
  rare branches.
- **Fast paths** for the most common tokens (identifiers, single spaces, newline
  plus indentation, common punctuation), falling back to the full rules only
  when a context rule could apply.
- **Cheap scans:** 8-byte SWAR runs for identifiers and whitespace, `scan.rs`
  for line ends, strings, and block comments.
- **Cheap keyword checks:** a first-byte and length prefilter, then one hash and
  one compare (`KeywordTable` does both). Test only names that can be keywords
  (e.g. constants only for `[A-Z_]` starts).
- **Records through a moving pointer** (`Recs`, or a module-local writer like
  `Recs`, which keeps the writer in registers), always with the capacity trap.
  Don't pass `&mut Recs` to an out-of-line helper on the hot path: its address
  escapes and the record state leaves registers. Pass it by value and return it,
  or keep the writer in locals.
- **The NUL sentinel** as its own byte class, replacing a per-token end check,
  and dropping bounds checks it makes redundant.
- **Handling common followers inline** right after a name (`(`, `.`, `)`, `,`),
  and a table-driven number loop (Python: 245 → 90 instructions per token).
- **Nibble-table classification:** classify 16 bytes with two table lookups (low
  and high nibble) and an AND, instead of many compares (CSS: −5%).
- **Freeing registers:** read a lookahead byte only in the rules that need it,
  not once per token (CSS: −9%).
- **Inlining mid-size helpers called from the hot loop:** each out-of-line call
  made LLVM spill around it and rebuild hoisted constants (CSS: −3 to −5% each).
  Inline them unless they're rare.
- **A compile-time dialect parameter** (`const LESS: bool`) when one module
  serves several languages (CSS: 236 → 64 instructions per token overall).

- **Free bounds checks:** hoist one checked slice per function
  (`let s = &src.bytes()[..end];`) and read `s[p]` behind the loop's existing
  `p < end` guard; the compiler proves those reads and drops the check, with no
  `unsafe`. Checked `Input` reads elsewhere cost a compare each (CSS: +17%
  instructions with every read checked), so hot reads that can't use a guarded
  slice use the `_unchecked` twins. Hot means: per-byte loops stopped by the NUL
  at the input end, the per-token reads at the top of the main loop, vector
  loads in scan loops. Judge them with PGO builds (`scripts/native-pgo.sh`), on
  cycles as well as instructions: checked reads there cost LaTeX 22% more
  instructions under PGO while non-PGO comparisons showed no change, and one
  checked read per token cost Matlab 10% in cycles with an unchanged instruction
  count.
- **Small structs, three words at most:** `Input` (two) and `Recs` (three) stay
  in registers across calls; a fourth word gets spilled and reloaded around
  every call, and a struct passed by pointer loses the slice's no-aliasing
  guarantee. Pass `Recs` by value, or
  `let mut r = recs; helper(&mut r); recs = r;`, never `&mut recs` into an
  out-of-line hot helper.

What has not worked (measured, don't repeat without a new reason):

- forcing everything inline; passing state by value to cold helpers;
- moving the hot pending-token resolution out of line (call cost);
- packing several small state values into one register;
- 16-byte vector whitespace scans for short runs (longer dependency chain);
- replacing the most common class's branch with a dense table;
- a byte-class jump table for dispatch: Python gained, CSS lost 13% in corpus
  cycles with fewer instructions. Measure it both ways with `native-ab.sh`;
- 8-byte or scalar-then-vector space scans where runs are short (CSS);
- inline assembly, other LLVM register allocators, `target-cpu` flags.

**Stop rule:** stop optimizing when three consecutive serious attempts each fail
to gain. The primary inputs are the `corpus` inputs of languages with real files
(`sources.json`); test-sample-only languages count only when the module has
nothing else. An attempt gains when a primary input drops at least 1% in
instructions, or its cycles drop in a `native-ab.sh` comparison, without another
primary input getting worse by as much. Never stop because you estimate there is
little left.

### Phase 5 – Finish

1. **Injected-bug check:** change one token color in a common path, run the
   check, confirm it FAILs on parity, restore, confirm it PASSes.
2. Final `scripts/native-check.sh <module> --update-lock`: full fuzz, perf, lock
   written.
3. Checked build: `scripts/native-check.sh <module> --checked` must PASS (every
   unchecked read asserts its bounds there). Other targets:
   `scripts/native-check.sh <module> --target x86_64-apple-darwin` (parity and
   fuzz on x86-64 under Rosetta) must PASS, and
   `cargo check --release -p highlights --features native-<module> --target wasm32-unknown-unknown --target-dir target/native-<module>`
   must build.
4. `rustfmt --edition 2024 highlights/src/native/<module>.rs` and
   `cargo clippy --release -p highlights --features native-<module> --target-dir target/native-<module>`
   with no warnings in your files.
5. **Keep or drop:** the module is kept when its native instructions and cycles
   per record are both below the translated lexer's on both perf inputs.
   Otherwise report it as not beating the translated lexer, with the numbers; it
   stays, feature-gated, for a decision.

**Report** (in this order): module and languages; real-file counts from
`sources.json`; final check output; the step table; what is delegated and why;
anything you stopped on (shared-file needs, suspected WAT bugs).

## Syncing After a WAT Change

When `scripts/native-check.sh <module>` fails with
`WAT changed since the last sync: <files>; see git diff <commit> -- <files>`:

1. Run the printed `git diff` (from `packages/highlights/`). It shows every WAT
   change since the lock was last written.
2. For each changed WAT function, find the Rust function whose doc comment names
   it (`grep -n '\$<name>' highlights/src/native/<module>.rs`) and port the
   change there, in the same position in the rule order. New WAT functions get
   new Rust functions named in their doc comments.
3. `moonx highlights:rust-gen` (regenerates the translated lexer and generated
   tables), then `scripts/native-check.sh <module>` until PASS.
4. If instructions per record rose more than 2% on either input, say so in the
   report with the numbers.
5. `scripts/native-check.sh <module> --update-lock`.

The same hard rules apply: identical output, the WAT decides, stay in the
module.

## Measuring Everything

`scripts/native-report.sh` builds every present module with PGO (trained on
`target/train`, never the benchmark inputs) and writes
`target/native-report.md`: per language and input, translated and native
instructions and cycles per record. Run it on a quiet machine; check
`sysctl vm.loadavg` first.
