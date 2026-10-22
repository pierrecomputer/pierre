# Incremental streaming experiment

Run `moon run markdowns:bench-stream` from the repo. The script replays fixed
64-character chunks, alternates measurement order, discards one warmup, and
reports the median of five full-message replays. Times are total work across all
appends, not latency per update. Fixtures are generated in `stream.ts`.

One local run on October 21, 2026, using Node 24.11.0 on macOS arm64:

| Workload                                             | Characters | Updates | Full reparse | Incremental | Ratio |
| ---------------------------------------------------- | ---------: | ------: | -----------: | ----------: | ----: |
| Markdown with headings, paragraphs, links, and lists |     14,820 |     232 |     108.8 ms |      3.5 ms | 31.5× |
| One long open paragraph                              |     16,500 |     258 |      40.6 ms |     40.7 ms | 1.00× |
| Markdown with a reference definition halfway through |     29,656 |     464 |     420.1 ms |    318.8 ms | 1.32× |
| TypeScript highlighting                              |     25,170 |     394 |      44.3 ms |      5.5 ms | 8.03× |

These compare our stateless and incremental APIs. They exclude React rendering,
DOM updates, network delivery, and Streamdown. They are workload-specific local
measurements, not an end-to-end speed guarantee. Short messages can gain less
because session initialization and cache maintenance have a cost.

Completed top-level Markdown blocks can be cached; a long open block must still
be parsed in full and adds session overhead. Once a global link or footnote
definition appears, parsing falls back to the whole document. The reference
workload gains only during its first half. Highlights retains lexer checkpoints
and themed token arrays for preceding lines within each code block.

Correctness checks compare every character prefix of all 1,326 CommonMark/GFM
examples with a stateless parse, with display completion both enabled and
disabled. Additional tests cover random chunk boundaries, edits, late
references, footnotes, Unicode, line endings, independent sessions, Strict Mode
cleanup, and token parity against full highlighting. Run
`moon run markdowns:test`.

## Bun runtime finding

Long replay loops under Bun 1.4.0 intermittently produced different output for
the same input. This reproduced after removing the incremental WAT additions and
using full-document parsing on both sides. Observed differences included
trailing newlines, a setext heading becoming a paragraph, and a code closing tag
appearing as text. The existing short conformance suite did not expose it.

Eight complete replay passes agreed under Node, and eight agreed under Bun with
`BUN_JSC_useOMGJIT=false`; disabling JavaScript's optimizing tiers alone did not
resolve it. This points to Bun's optimizing Wasm tier, rather than prefix-cache
invalidation. The root engine defect is not fixed here. Safari/WebKit runtime
behavior has not been established.

The Moon test task runs exhaustive core replay with Node and disables Bun's
optimizing Wasm tier only for the React tests. The benchmark runs on Node with
normal settings. Library and browser behavior do not change runtime flags.

## Large fixtures

`fixtures.mjs` generates the same 8,524-character browser fixture at 1×, 100×,
and 1,000×. Blank separators preserve independent blocks between copies. The
larger cases are 852,598 and 8,525,998 ASCII characters, containing 10,100 /
101,000 paragraphs and 100 / 1,000 TypeScript fences respectively. No multi-MB
fixture text is checked in or included in the library entrypoints.

```bash
moon run markdowns:bench-large -- 100 16 /tmp/markdowns-large-100.json
moon run markdowns:bench-large -- 1000 16 /tmp/markdowns-large-1000.json
```

The second argument selects 1–32 sparse append checkpoints (default 16). Every
checkpoint is compared with a fresh full parse. Timing excludes explicit GC and
assertions; memory captures owned outputs, session retention, and the Wasm arena
after release. RSS, external memory, JS heap, and Wasm committed memory are
separate counters and must not be added together as live memory.

One Node 24.11.0/macOS arm64 run, October 21, 2026:

| Fixture         | HTML median | Owned elements median | Owned-tree JS heap increase | Structured Wasm arena |
| --------------- | ----------: | --------------------: | --------------------------: | --------------------: |
| 100×, 0.85 MB   |      2.8 ms |               31.7 ms |                     17.4 MB |             10.25 MiB |
| 1,000×, 8.53 MB |     27.8 ms |              349.7 ms |                    169.1 MB |                98 MiB |

All 16 sampled prefixes matched in each case. The separate sparse append replay
totaled 66.9 ms / 753.3 ms, with maximum updates of 6.4 ms / 63.8 ms.
Whole-document numbers are medians of three calls after a one-unit warmup;
sparse replay runs once. These parser-only results exclude React, highlighting,
fade spans, DOM, layout, and paint. They do not establish browser capacity at
these sizes or describe a real-time 64-character token stream.

Routine tests include fixture-shape checks at all sizes and a 100× structured
parse/append/reset regression. The full 1,000× allocation/parity run is explicit
through `bench-large`, keeping ordinary checks bounded.
