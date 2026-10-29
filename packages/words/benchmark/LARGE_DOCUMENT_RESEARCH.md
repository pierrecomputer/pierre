# 15 MB Markdown-to-HTML performance research

**Prioritize avoiding string conversions at the application boundary, then
reducing per-construct work inside the HTML renderer.** The measurements do not
point to allocation or scratch-buffer copying as the main problem for these
workloads.

This investigation added isolated benchmarks and telemetry. **No proposed
production parser optimizations were implemented.**

## What 15 MB costs

Each input contains exactly **15,000,000 UTF-8 bytes**. These are synthetic
workload contrasts: mixed assistant-style Markdown, ordinary prose, fenced code,
and dense markup.

Apple M3 Max, Node 24.11.0. Median across five fresh processes per case, with
nine measurement batches per process:

| Workload       | UTF-8 bytes → borrowed HTML bytes | UTF-8 bytes → owned HTML string | JS string → owned HTML string |
| -------------- | --------------------------------: | ------------------------------: | ----------------------------: |
| Mixed Markdown |                          17.11 ms |                        30.77 ms |                      42.88 ms |
| Prose-heavy    |                           5.68 ms |                         7.32 ms |                      13.34 ms |
| Code-heavy     |                           5.26 ms |                         7.12 ms |                      13.16 ms |
| Dense markup   |                          86.39 ms |                        90.87 ms |                      96.71 ms |

These exclude file I/O, initialization, compilation, and first memory growth.
They include the codecs required by each contract. No highlighting, formatting
hooks, or DOM work.

**File size alone is a poor predictor.** Dense markup spends substantially more
time processing constructs, despite having the same input byte count.

## The largest overall cost: crossing the string boundary

Encoding and decoding accounted for approximately **60% of the mixed
string-to-string CPU profile**.

A separate experiment exercised actual cached-file **read → render → write**,
verifying identical output files:

| Pipeline                                   | Median total |
| ------------------------------------------ | -----------: |
| Preserve UTF-8 bytes throughout            |     28.35 ms |
| Read, render, and write through JS strings |     94.96 ms |

This was six alternating rounds in one warm process, without `fsync`; it is an
exploratory filesystem result, not a durability benchmark.

The string pipeline crosses the UTF-8/JS-string boundary four times: reading,
submitting to Wasm, receiving HTML, and writing. The byte pipeline already works
through existing APIs.

There is also a Unicode sensitivity worth preserving in future benchmarks.
Replacing three ASCII bytes with **one CJK character**, while keeping the input
exactly the same byte size, produced:

| Isolated operation   | ASCII document | Same document with one CJK character |
| -------------------- | -------------: | -----------------------------------: |
| Encode input         |        6.13 ms |                             12.07 ms |
| Decode rendered HTML |        1.49 ms |                              9.68 ms |

**[INFERENCE]** Runtime string representation is a likely contributor. These
results establish the sensitivity on this Node/V8 version, not its exact
implementation cause or browser behavior.

For the mixed string-to-string contract, even **halving the entire Wasm
rendering time** would yield only about **1.25× overall speedup**, assuming
other costs remain unchanged.

## Where the Wasm time goes

The named CPU profiles and separate instrumented phase measurements agree:

- **Mixed Markdown:** inline analysis and HTML emission dominate core time;
  block analysis follows. Reference indexing is negligible.
- **Prose:** `inlineScan` and `walkInlines` dominate. Ordinary multiline text
  still creates and traverses soft-break marks.
- **Code:** emission and escaping dominate. The `renderBlock` frame includes
  inlined code-rendering work; it does not mean generic block dispatch is the
  bottleneck.
- **Dense markup:** `inlineScan`, `walkInlines`, emphasis resolution, block
  analysis, links, and tables all contribute. Millions of small operations
  matter more than scanning large contiguous spans.

The work counters make the next experiments more specific.

## Ranked optimization ideas

These are hypotheses to test, not predicted speedup claims.

### 1. Preserve UTF-8 through file/socket pipelines

**Highest-confidence overall opportunity; already possible through existing
APIs.**

For actual HTML-file output, avoid constructing a JS HTML string solely to
encode it again for writing. Respect the borrowed-output lifetime: finish
consuming it before another render reuses Wasm memory.

A subsequent architectural experiment could emit **bounded HTML chunks to a byte
sink**, potentially reducing retained output and overlapping rendering with
writes.

That must happen after the necessary semantic decisions. Forward references and
list looseness prevent simply emitting final HTML as soon as a paragraph appears
during block parsing.

If the consumer genuinely requires a JS string, keep that as a separate
benchmark objective. Returning bytes is not a same-contract library speedup.

### 2. Batch HTML emission at the leaf or bounded-chunk level

**The recommended first library-side experiment.**

The dense workload performs:

- **5.82 million output-capacity checks**
- **1.37 million literal-gap emissions**, all shorter than 16 bytes
- **Zero warmed memory growth**

These are capacity checks, not millions of allocations.

**Hypothesis:** keep the output cursor local across more emission work, reserve
bounded capacity less often, and reduce repeated dispatch for tags and tiny text
spans. Specialize HTML emission while retaining shared parsing semantics.

The existing SIMD escaper remains useful for long spans. For tiny spans,
reducing setup, checks, and cursor updates may matter more than improving its
vector loop.

**Validation:** reservation frequency and emission overhead should fall; exact
output and resolved-mark behavior must remain unchanged. Preserve the rule that
pointers into movable scratch are resolved after any reservation that can grow
memory.

### 3. Give plain paragraphs a conservative simpler path

The prose workload creates **85,155 marks, all for soft line breaks**. It then
walks those marks and classifies text again during escaping.

**Hypothesis:** collect eligibility facts during existing block scanning, then
render eligible plain paragraphs without the general mark-building and
mark-walking pipeline.

This is different from adding zero-copy content: the current implementation
already aliases these paragraphs.

The eligibility rules must preserve hard breaks, trailing whitespace, escapes,
autolinks, malformed delimiters, and Unicode. Ambiguous content should retain
the general path. An additional full-document classification pass could erase
the benefit, so investigate carrying facts forward from scans already being
performed.

**Validation:** fewer soft-break marks and repeated classifications, with a
whole-operation improvement on prose. Do not assume the same benefit on mixed
Markdown.

### 4. Reduce durable block records and descriptor work

The dense document retains **879,120 block records occupying 26.4 MB**,
including **109,890 `none` records**. Some records become unused when
provisional paragraphs turn into tables or definitions.

**Hypotheses:**

- Represent common contiguous paragraph content as source runs rather than
  individual line descriptors.
- Delay committing some provisional records until their final block type is
  known.
- Use smaller representations for common leaf shapes where that simplifies
  subsequent traversal.

This could reduce both record construction and later traversal. Smaller storage
alone is not proof of faster execution.

Preserve physical-line information needed for tables, setext headings,
definitions, and container behavior. The live tree added compact closer records
during this investigation; this is **not** proposing that existing change again.

## What to deprioritize

- **Scratch relocation and allocator tuning:** warmed runs moved no scratch
  bytes and performed no memory growth.
- **More general zero-copy leaf work:** all four primary fixtures already
  aliased their inline content; rebuilt inline bytes were zero. CRLF and
  multiline nested content need separate evidence before generalizing.
- **Reference-index redesign for ordinary mixed documents:** approximately 0.04
  ms per document here. The dense fixture intentionally repeats definitions, so
  its reference costs should not drive the general design.
- **A wholesale single-pass rewrite:** global definitions and list-looseness
  decisions impose real ordering constraints.

## Evidence and instrumentation

The investigation used **100 fresh timing workers**, named CPU profiles with
identical production executable sections, separate work-counter builds with
output parity, and exact file-output checks.

The live sources changed during the investigation, so measurements stay pinned
to the captured build. The diagnostic driver, fixtures, profiles, counters, and
reproduction scripts are isolated under gitignored `output/lab/` relative to
this file.

These are exploratory measurements, not confirmed optimization wins. The only
timing warning affected the tiny input-copy kernel; its submillisecond estimate
was not used to justify a recommendation.

### Entry points for another agent

- [Full measurements, ranked experiments, and verification](output/lab/large15-analysis.json)
- [Fixture definitions and provenance](output/lab/large15-inputs/manifest.json)
- [Exact work counters](output/lab/large15-work-counts-final/work-counts.json)
- [File-to-file measurements](output/lab/large15-file-pipeline.json)
- [Mixed-document CPU profile](output/lab/large15-mixed-string-profile/static-string.cpuprofile)
- [Dense-markup CPU profile](output/lab/large15-dense-profile/static-bytes-string.cpuprofile)
- [Frozen benchmark driver](output/lab/large15-driver/benchmark/lab/run.mjs)
- [Counter instrumentation](output/lab/large15-work-metrics.mjs)
- [File-pipeline benchmark](output/lab/large15-file-pipeline.mjs)

The measured capture is `output/lab/large15-baseline/`. Its production `md.wasm`
SHA-256 is:

```text
cafe2a17aabc789b90f9d551390a708e45b8e3ec943685c1fc4cac5f23c0d67d
```

Check the current implementation before proposing or implementing any
hypothesis; do not assume it remains unimplemented. The capture and driver
hashes identify the measured code, not the current branch HEAD.

This Markdown summary is outside the ignored output directory. The linked raw
artifacts are local and gitignored: copy the `output/lab/large15-*` files and
directories when handing the investigation to another worktree or machine.
