# Architecture

Highlights uses WAT lexers to scan UTF-8 bytes in WebAssembly memory and emit
HTML or token records. Lexers classify code with local context and state
machines, without building a syntax tree. A TypeScript host handles encoding,
themes, token objects, and scheduling incremental work.

The same lexer and emitter pipeline serves three uses:

```text
Whole input ───── highlight ─────────┬─ HTML bytes
                                    └─ UTF-16 records → themed tokens
Stream lines ──── highlightStream ───── UTF-16 records → themed tokens
Document edits ── liveRun ───────────── per-line streaming → cached records
```

## Source map

| Source                                                                                                | Responsibility                                                    |
| ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| [`lib/index.ts`](./lib/index.ts), [`lib/highlighter.ts`](./lib/highlighter.ts)                        | Public API, Wasm instances, input/output, and streaming           |
| [`lib/live.ts`](./lib/live.ts)                                                                        | Edit validation, document reads, and deferred work                |
| [`lib/theme.ts`](./lib/theme.ts), [`lib/tokens.ts`](./lib/tokens.ts)                                  | Theme preparation and conversion of records to token objects      |
| [`src/highlights.wat`](./src/highlights.wat), [`src/memory.wat`](./src/memory.wat)                    | Language dispatch, drivers, and memory layout                     |
| [`src/scan.wat`](./src/scan.wat), [`src/common.wat`](./src/common.wat)                                | Bounded scans, shared lexical rules, and multiline continuation   |
| [`src/token.wat`](./src/token.wat), [`src/emit.wat`](./src/emit.wat)                                  | Token IDs, HTML emission, and binary records                      |
| [`src/langs/*.wat`](./src/langs/), [`src/sig.wat`](./src/sig.wat), [`src/embed.wat`](./src/embed.wat) | Language lexers, parameter classification, and embedded languages |
| [`src/live.wat`](./src/live.wat)                                                                      | Document storage, edit splicing, and incremental tokenization     |
| [`scripts/build.ts`](./scripts/build.ts)                                                              | WAT preprocessing, compilation, and generated assets              |
| [`themes/`](./themes/)                                                                                | Zed-compatible themes, CSS-variable theme, and `toCSS`            |

## Runtime and memory

Package export conditions select a synchronous loader: Node reads the Wasm file,
browsers compile embedded bytes, and workerd imports a Wasm module. Each loader
calls `init` and re-exports the public API.

`init(module)` creates the shared instance used by `codeToHtml` and
`codeToTokens`. `createHighlighter(module)` creates an independent instance.
Each active stream or live document owns its own instance and lexer state.
Completed streams can reuse a single pooled instance; live documents are not
pooled.

The first 64 KiB memory page holds controls, static tables, caches, and lexer
scratch. Ordinary input starts at byte 65536, followed by a NUL sentinel and
lookahead space. `$ptr` is the read cursor, `$eof` is the input end, and `$end`
is the current scan boundary, which can be earlier for an embedded lexer.
Embedded NUL bytes are data; end checks use the boundary.

The host writes a language ID, input length, and output mode into the control
block. Wasm writes back the output address and length:

| Mode | Output                        |
| ---- | ----------------------------- |
| 0    | HTML with inline colors       |
| 1    | HTML with CSS-variable colors |
| 2    | HTML for a packed theme set   |
| 3    | UTF-16 line records           |

Output starts after the input at a 16-byte-aligned address. Modes 1 and 2 place
the variable prefix or theme set before the output. `$ensureCap` grows memory
before writes, and the host rebinds typed array views after growth. SIMD scans
may load into reserved lookahead space but must discard out-of-range matches.
See [`src/memory.wat`](./src/memory.wat) for exact addresses and region sizes.

`codeToHtml` normally returns a borrowed `Uint8Array` into Wasm memory. Copy it
before another call on the same instance: later writes can overwrite it and
memory growth can detach it.

## Lexers and emission

The `language-table` in [`src/highlights.wat`](./src/highlights.wat) owns each
language's canonical name, aliases, and dispatch function. The build derives
Wasm IDs and the JavaScript lookup from this list. Declaration order defines
IDs, so append new languages to preserve existing IDs. Host lookups ignore case
and reject unknown names.

Several languages share implementations. CSS dialects use `css.wat`. The
ECMAScript family combines `js.wat` scanning, `ts.wat` classification, `jsx.wat`
markup modes, and the `tsx.wat` driver. Feature flags select JS, TS, JSX, and
TSRX behavior. `sig.wat` tracks parameter lists for participating lexers.

A lexer consumes `[$ptr, $end)` and leaves `$ptr` at the boundary. It must:

- Preserve input bytes and emit ranges in order.
- Advance on every iteration, including malformed input, and stop unterminated
  constructs at `$end`.
- Keep UTF-8 code points together and bound lookahead by the scan range.
- Initialize fresh state on a new run and preserve all state needed to resume.

The emitter exposes two operations:

- `$emitTok(hl, lhs, rhs)` emits a token range, escaping `&`, `<`, and `>` for
  HTML. Empty or reversed ranges do nothing.
- `$emitGap(lhs, rhs)` copies whitespace or leading UTF-8 continuation bytes
  while retaining the preceding style. Gaps must not contain HTML specials.

HTML output is one `<pre class="highlights" style="..."><code>...</code></pre>`
fragment with non-nested spans and no line wrappers. Adjacent equal styles share
a span, including intervening gaps. Record output merges adjacent equal token
IDs; gaps extend the preceding record or use `none` at the start.

### Embedded languages

An embedding lexer temporarily narrows `$end` to a body range, calls the child
lexer, then restores the outer boundary. Continuation must respect this range:
an unfinished script comment must not consume the enclosing script closer.

`embed.wat` resumes script/style bodies, front matter, and framework
expressions. Markup lexers resume their own unfinished start tags. Markdown and
MDX retain fence delimiter, language, and nesting state. Fence aliases are
registered separately in `markdown.wat`.

## Token records

Mode 3 first emits `(endByte: u32, tokenId: u32)` pairs. Each record starts at
the preceding end, or zero for the first record. After lexing, `$recLinesPost`
converts these to `(endUtf16: u32, tokenId: u32)` pairs and splits LF/CRLF
boundaries. ID `0xffffffff` marks a line terminator and ends after it.

`lineRecordsToTokens` slices the source string into per-line `ThemedToken`
arrays, excluding terminators. Whole-input and stream offsets are absolute
UTF-16 indices; live offsets are line-relative. Comment, string, and regex IDs
also provide standard token types for uses such as bracket matching.

`codeToTokens` normalizes malformed UTF-8 byte input before lexing and retains
original strings for token content. Styling happens after lexing, so records are
independent of themes. `tokenizeMaxLineLength` collapses long lines during
object conversion; it does not skip lexing or change live raw records.

## Themes

`prepareTheme` resolves a `ThemeFamily` to its first member and caches by theme
object identity, plus prefix for CSS-variable themes. Replace a theme object to
change its prepared values.

Syntax colors fall back through dotted parents, such as `function.method` to
`function`, while keeping the nearest scope's font settings. Font-only scopes
can inherit the foreground. Foreground resolves from `editor.foreground`,
`text`, then `foreground`; background resolves from `editor.background`, then
`background`.

Hex themes pack each token into five bytes: RGBA and font settings. An all-zero
record inherits without a span. HTML selects a rendering path based on the
prepared theme:

| Theme input                                                    | Rendering path                                                                |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Single hex theme                                               | Mode 0 reads the packed theme table                                           |
| `cssVariables: true`                                           | Mode 1 emits `var(<prefix><token-name>)`, with `--hls-` as the default prefix |
| Multiple hex themes                                            | Mode 2 renders the packed set in one lex                                      |
| Display P3, or a set containing Display P3/CSS-variable themes | Mode 1 emits placeholder tags that the host replaces with prepared styles     |

With `themes`, `defaultColor` selects the inline theme and defaults to `light`.
Other themes become custom properties such as `--hls-dark`. `false` makes every
theme a custom property; `'light-dark()'` combines the light/dark pair. Token
objects carry the corresponding shared `htmlStyle` maps.

Wasm caches span openers and invalidates them when the theme or output mode
changes. Merging compares packed styles for hex themes, token IDs for variable
output, and every member's style for theme sets. Token calls preserve HTML
caches.

[`themes/index.ts`](./themes/index.ts) exports bundled themes, `cssVariables`,
and `toCSS` for generating custom-property declarations. The build also emits
individual theme modules and a lazy loader.

## Streaming

`StreamTokenizer` is a `TransformStream<Uint8Array, ThemedToken[]>` with
synchronous `pushCode`, `end`, and `dispose` methods. It sends completed lines
through the last LF to Wasm and buffers the unfinished tail. `end` emits the
remainder, including a final empty line after a trailing terminator.

Buffered bytes are owned by the tokenizer, so callers can reuse input arrays.
Valid completed bytes reach Wasm directly; malformed UTF-8 is normalized. String
chunks preserve trailing high surrogates so pairs can span calls.

`highlightStream(reset)` starts or resumes lexer state. `$streamChunk`
coordinates multiline constructs, embedded regions, and language-specific
continuation. Record state also persists so leading whitespace keeps the
preceding token's style.

The ECMAScript family has an explicit resumable driver. For other registered
stream lexers, the build saves needed locals in `$mem.streamState` and restores
them on the next chunk. These functions must use named branches and cannot
return early, which would bypass the injected save. Reset clears carried state
before an instance is reused.

## Live documents

`LiveTokenizer` adds editable document storage to the streaming pipeline.
JavaScript validates UTF-16 edits, exposes reads, and schedules work. Wasm owns
the text, line table, tokens, lexer states, and dirty ranges.

A size-class heap after the static page stores document data. The line table is
a gap buffer whose descriptors point to text, tokens, and outgoing lexer states.
Scratch above the heap holds one line and its emitted records.

For each dirty line, the driver restores the incoming state, runs the streaming
lexer, stores tokens, and interns the outgoing state. Once it passes the dirty
range and the outgoing state matches the retained state, the unchanged suffix
can reuse its tokens. Equality uses a hash lookup followed by exact comparison
of all carried state, including stacks, embedded regions, and checkpoints.

Line records normally pack into `(tokenId << 24) | endUtf16`; larger offsets use
`[endUtf16, tokenId]` pairs. Text uses WTF-8 to preserve lone surrogates. Reads
retain LF, CRLF, and lone CR; lexers see normalized LF terminators.

Edit batches refer to the pre-edit document. The host validates and sorts them,
rejects overlaps, removes no-ops, and combines edits sharing a line. Wasm
splices line descriptors and remaps any pending dirty ranges through the edits.

Without `renderRange`, tokenization completes synchronously. With it, work
reaches the range's end, including preceding dirty lines needed for state.
Finished in-range tokens are returned; off-range tokens reach `onDeferTokenize`.
Remaining work runs in adaptive slices on the host event loop through
`MessageChannel`, with a timer fallback.

`pause` retains pending work, `resume` schedules it, and `flush` completes it
through an optional end line. Unreached lines keep previous tokens; new lines
without records read as unthemed text. `reset` replaces the Wasm instance, and
`dispose` releases it and cancels deferred work.

`getLineTokens` returns themed objects and bracket-ignored ranges.
`getLineRecords` returns a borrowed view: copy it before edits, reset, disposal,
or deferred tokenization. Deferred slices do not change the document revision,
so revision equality alone does not establish the view's validity.

## Build and verification

`moon run highlights:build` runs [`scripts/build.ts`](./scripts/build.ts) before
tsdown compiles the host. The WAT preprocessor flattens local imports into one
namespace and expands enums, language registrations, named addresses, byte sets,
dispatch tables, and keyword tables. Keyword tables share a word pool and use
perfect hashing followed by exact byte comparison.

WABT compiles with SIMD and bulk memory enabled. Binaryen optimizes the module,
then the build reapplies JavaScriptCore workarounds for SIMD calling conventions
and compound negations. Outputs include Wasm, the browser byte module, themes,
and the tracked [`lib/languages.ts`](./lib/languages.ts) and
[`lib/token-types.ts`](./lib/token-types.ts) tables. tsdown emits the host and
declarations.

When adding a language, update its import, registration, stream checkpoint
participation, and fence aliases where needed. Add a language test and a corpus
entry in [`test/_samples.ts`](./test/_samples.ts). Changes to carried state must
also update live capture/reset/restore logic. Token IDs define the theme ABI;
growing `$Token` requires checking the fixed theme and emitter capacities.

Tests compile WAT directly and import `lib/`, so no package build is needed.
Language tests cover classification and bounds; conformance tests compare HTML,
whole-input, and streamed output. Wasm tests check preprocessing and optimizer
rewrites, while stream/live tests cover continuation, edits, and deferred work.

Run `moon run highlights:test` and `moon run highlights:typecheck` for
implementation changes, plus `moon run root:format root:lint`.
Documentation-only changes need formatting and linting.
