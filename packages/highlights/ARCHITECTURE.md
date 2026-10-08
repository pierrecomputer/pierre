# Architecture

Highlights uses WAT lexers to scan UTF-8 bytes in WebAssembly memory. The lexers
classify code from nearby tokens and saved state. They emit HTML or token
records without a syntax tree. The TypeScript host converts text, applies
themes, creates token objects, and schedules work after edits.

The same lexers and emitter process complete input, input streams, and edits:

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
| [`src/highlights.wat`](./src/highlights.wat), [`src/memory.wat`](./src/memory.wat)                    | Drivers and memory layout                                         |
| [`src/languages.wat`](./src/languages.wat)                                                            | Language table, name lookup, and dispatch by language ID          |
| [`src/scan.wat`](./src/scan.wat), [`src/common.wat`](./src/common.wat)                                | Bounded scans, shared lexical rules, and multiline continuation   |
| [`src/token.wat`](./src/token.wat), [`src/emit.wat`](./src/emit.wat)                                  | Token IDs, HTML emission, and binary records                      |
| [`src/langs/*.wat`](./src/langs/), [`src/sig.wat`](./src/sig.wat), [`src/embed.wat`](./src/embed.wat) | Language lexers, parameter classification, and embedded languages |
| [`src/live.wat`](./src/live.wat)                                                                      | Document storage, edit splicing, and incremental tokenization     |
| [`scripts/build.ts`](./scripts/build.ts)                                                              | WAT preprocessing, compilation, and generated assets              |
| [`themes/`](./themes/)                                                                                | Zed-compatible themes, CSS-variable theme, and `toCSS`            |

## Runtime and memory

Package export conditions select a synchronous loader for each runtime. Node
reads the Wasm file. Browsers compile embedded bytes. workerd imports a Wasm
module. Each loader calls `init` and exports the public API.

`init(module)` creates the shared instance used by `codeToHtml` and
`codeToTokens`. `createHighlighter(module)` creates an independent instance.
Each active stream or live document owns its instance and lexer state. A
completed stream can return its instance to a pool with one slot. A new stream
can reuse that instance. Live documents do not share a pool.

The first 64 KiB memory page holds controls, static tables, caches, and
temporary lexer data. Input starts at byte 65536. A NUL byte and space for
lookahead follow the input.

`$ptr` is the read cursor. `$eof` is the end of the input. `$end` is the current
scan boundary, which can be earlier for an embedded lexer. NUL bytes inside the
input are data. The lexer uses the boundary to find the end.

The host writes a language ID, input length, and output mode into the control
block. Wasm writes back the output address and length:

| Mode | Output                        |
| ---- | ----------------------------- |
| 0    | HTML with inline colors       |
| 1    | HTML with CSS-variable colors |
| 2    | HTML for a packed theme set   |
| 3    | UTF-16 line records           |

Output starts after the input at a 16-byte-aligned address. Modes 1 and 2 place
the variable prefix or theme set before the output. `$ensureCap` increases
memory capacity before writes. The host creates new typed array views after
memory growth. SIMD scans can read reserved lookahead space, but they must
discard matches outside the scan range.

[`src/memory.wat`](./src/memory.wat) defines the addresses and region sizes.

`codeToHtml` normally returns a `Uint8Array` view of Wasm memory. Later calls
can overwrite that memory. Memory growth can detach the view.

Copy the bytes before another call on the same instance.

## Lexers and emission

The `language-table` in [`src/languages.wat`](./src/languages.wat) defines each
language's canonical name, aliases, and lexer function. The build generates Wasm
IDs, JavaScript lookups, and language names for Markdown fences from this table.
The host ignores case in language names and rejects unknown names.

Keep `plain` first so it and its aliases (`plaintext`, `text`, `txt`) have ID 0.
Sort the other canonical names alphabetically. Use the generated JavaScript and
Wasm files together. A change to the table order changes IDs in both files.

Several languages share implementations. CSS dialects use `css.wat`. Free-form
and fixed-form Fortran share `fortran.wat` through a dialect flag that each
entry point sets.

The ECMAScript family uses `js.wat` to scan code and `ts.wat` to classify
tokens. `jsx.wat` handles markup, and `tsx.wat` is the driver. Feature flags
select JS, TS, JSX, and TSRX behavior. `sig.wat` tracks parameter lists for
lexers that use parameter context.

A lexer reads `[$ptr, $end)` and leaves `$ptr` at the boundary. Each lexer must
obey these rules:

- Preserve input bytes and emit ranges in order.
- Advance on each iteration, even with malformed input.
- Stop an unfinished construct at `$end`.
- Keep UTF-8 code points together.
- Keep lookahead inside the scan range.
- Initialize state for a new run.
- Save the state that the lexer needs to resume.

The emitter exposes two operations:

- `$emitTok(hl, lhs, rhs)` emits a token range. It escapes `&`, `<`, and `>` for
  HTML. Empty or reversed ranges produce no output.
- `$emitGap(lhs, rhs)` copies whitespace or initial UTF-8 continuation bytes. It
  keeps the previous style. Gaps must not contain `&`, `<`, or `>`.

HTML output is one `<pre class="highlights" style="..."><code>...</code></pre>`
fragment. Its spans do not nest, and its lines have no wrappers. Adjacent ranges
with the same style share a span, even across gaps. Record output merges
adjacent ranges with the same token ID. Gaps extend the previous record or use
`none` at the start.

### Embedded languages

A parent lexer sets `$end` to the end of an embedded body. It calls the child
lexer, then restores the outer boundary. The child lexer must stop at that
boundary, even inside an unfinished construct. For example, a script comment
must not consume the script's closing tag.

`embed.wat` resumes script/style bodies, front matter, and framework
expressions. Markup lexers resume their own unfinished start tags. Markdown and
MDX retain fence delimiter, language, and nesting state. A fence body is a
document of its own: `$docStart` marks its first line, so document-start syntax
such as a `#!` line or front matter applies there too.

## Token records

Mode 3 first emits `(endByte: u32, tokenId: u32)` pairs. Each record starts at
the previous end, or zero for the first record. After the scan, `$recLinesPost`
converts the pairs to `(endUtf16: u32, tokenId: u32)` and splits them at LF/CRLF
boundaries.

The conversion scans the input for line breaks and non-ASCII bytes once. A plain
ASCII record needs one subtraction. ID `0xffffffff` marks a line terminator.
That record ends after the terminator.

`lineRecordsToTokens` splits the source string into one `ThemedToken` array per
line. The arrays exclude line terminators. Offsets for complete input and
streams are UTF-16 indices from the start of the input. Live document offsets
are relative to each line. Comment, string, and regex IDs also provide standard
token types for bracket matching.

`codeToTokens` decodes byte input for token content and copies valid UTF-8
directly to Wasm. It replaces malformed bytes before the scan so record offsets
match the decoded string. String input keeps its original UTF-16 content. Theme
styles apply after the scan, so records do not depend on themes.

`tokenizeMaxLineLength` converts long lines to one token during object
conversion. The lexer still processes those lines. The option does not change
raw records in live documents.

## Themes

`prepareTheme` selects the first member of a `ThemeFamily`. It caches the result
by theme object identity. CSS-variable themes also use the prefix as part of the
cache key.

Replace the theme object to change its prepared values.

Syntax colors use the nearest configured parent scope, such as `function` for
`function.method`. Font settings use the nearest configured scope. A scope with
only font settings can inherit the foreground color.

The foreground keys are `editor.foreground`, `text`, then `foreground`, in that
order. The background keys are `editor.background`, then `background`.

Hex themes use five bytes per token style: RGBA and font settings. An all-zero
record inherits the style without a span. The prepared theme selects the HTML
output mode:

| Theme input                                                    | Rendering path                                                                |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Single hex theme                                               | Mode 0 reads the packed theme table                                           |
| `cssVariables: true`                                           | Mode 1 emits `var(<prefix><token-name>)`, with `--hls-` as the default prefix |
| Multiple hex themes                                            | Mode 2 renders the packed set in one lex                                      |
| Display P3, or a set containing Display P3/CSS-variable themes | Mode 1 emits placeholder tags that the host replaces with prepared styles     |

With `themes`, `defaultColor` selects the inline theme and defaults to `light`.
Other themes become custom properties such as `--hls-dark`. `false` uses custom
properties for every theme. `'light-dark()'` combines the light and dark themes.
Token objects share the `htmlStyle` maps for those styles.

Wasm caches span opening tags. A change to the theme or output mode clears the
cache. The emitter compares styles before it combines adjacent spans. It
compares packed styles for hex themes, token IDs for variable output, and all
theme styles for theme sets. Token calls keep the HTML caches.

[`themes/index.ts`](./themes/index.ts) exports bundled themes, `cssVariables`,
and `toCSS`, which produces CSS custom-property declarations. The build also
emits individual theme modules and a lazy loader.

## Streaming

`StreamTokenizer` is a `TransformStream<Uint8Array, ThemedToken[]>` with
synchronous `pushCode`, `end`, and `dispose` methods. It sends complete lines
through the last LF to Wasm. It keeps the unfinished line in a buffer. `end`
emits the rest of the input, with a final empty line after a trailing
terminator.

The tokenizer owns the buffered bytes, so callers can reuse input arrays. Valid
bytes from complete lines go directly to Wasm. The host replaces malformed UTF-8
sequences. String chunks keep trailing high surrogates so pairs can span calls.

`highlightStream(reset)` starts or resumes lexer state. `$streamChunk`
coordinates multiline constructs, embedded regions, and language-specific
continuation. Record state also persists so initial whitespace keeps the
previous token's style.

The ECMAScript family has a driver that can resume between chunks. For other
registered stream lexers, the build adds code to save the necessary locals in
`$mem.streamState`. The next chunk restores those locals. These functions must
use named branches. They cannot return early because that skips the added save
code. A reset clears saved state before the next use of an instance.

## Live documents

`LiveTokenizer` adds editable documents to the stream tokenizer. JavaScript
validates UTF-16 edits, provides read methods, and schedules work. Wasm owns the
text, line table, tokens, lexer states, and dirty ranges.

A heap after the static page stores document data in blocks grouped by size. The
line table uses a gap buffer. Each line descriptor points to text, tokens, and
the lexer state after that line. Temporary space above the heap holds one line
and its emitted records.

For each dirty line, the driver restores the state from the previous line and
runs the stream lexer. It stores the tokens and saves the state after the line.
Lines with identical states share one saved copy.

The driver stops after the dirty range when its state matches the saved state.
Later unchanged lines can then reuse their tokens. State comparison uses a hash
lookup, then compares all saved data. This includes stacks, embedded regions,
and checkpoints.

Line records normally use `(tokenId << 24) | endUtf16`. Larger offsets use
`[endUtf16, tokenId]` pairs. Text uses WTF-8 to preserve lone surrogates.

Read methods preserve LF, CRLF, and lone CR. The lexer receives LF terminators.
Normal UTF-8 uses native encoders and decoders. The WTF-8 decoder allocates its
UTF-16 array from the stored line length.

Each edit batch refers to the document before the edits. The host validates and
sorts the edits, then rejects overlaps. It removes edits that leave each line
and terminator unchanged. It combines edits that share a line. Wasm updates the
line descriptors and adjusts dirty ranges for the new positions.

Without `renderRange`, tokenization completes synchronously. With `renderRange`,
each work slice has a one-millisecond time budget. The budget includes lexer
work, text decode, token conversion, and callbacks. Completed viewport lines
return in `lines`.

Unfinished lines, inside or outside the viewport, arrive through
`onDeferTokenize`. The host schedules this work with `MessageChannel` tasks or a
timer if `MessageChannel` is unavailable.

The live driver can pause the root lexer at a token boundary. It saves the
locals and resumes on the same input. Record and tuple conversion can also pause
inside a line. Callers receive results only after the line is complete.
`tokenizeMaxLineLength` limits output objects, but the lexer still processes the
full line.

The time budget depends on those pause points. Individual lexer operations,
embedded regions, memory allocation, and caller callbacks can exceed the budget.
Document preparation and explicit synchronous reads also remain synchronous.

`pause` keeps pending work. `resume` schedules that work. `flush` completes it
up to an optional end line. Lines that await tokenization keep their previous
tokens. New lines without records return unthemed text.

`reset` replaces the Wasm instance. `dispose` releases the instance and cancels
deferred work.

`getLineTokens` returns themed objects and bracket-ignored ranges.
`getLineRecords` returns a view of shared memory. Edits, reset, disposal, or
deferred tokenization can invalidate the view. Deferred work does not change the
document revision, so the same revision does not guarantee a valid view.

Copy the view before any operation that can invalidate it.

## Build and verification

`moon run highlights:build` runs [`scripts/build.ts`](./scripts/build.ts) before
tsdown compiles the host. The WAT preprocessor combines local imports into one
namespace. It expands enums, language registrations, named addresses, byte sets,
dispatch tables, and keyword tables. Keyword tables share a word pool. They use
a perfect hash to find a candidate, then compare its bytes.

WABT compiles with SIMD and bulk memory enabled. Binaryen optimizes the module,
then the build reapplies JavaScriptCore workarounds for SIMD calling conventions
and compound negations. Outputs include Wasm, the browser byte module, themes,
and the tracked [`lib/languages.ts`](./lib/languages.ts) and
[`lib/token-types.ts`](./lib/token-types.ts) tables. tsdown emits the host and
declarations.

To add a language, update its import and registration. Enable stream checkpoints
if the lexer needs them. Add a language test and a sample in
[`test/_samples.ts`](./test/_samples.ts). Markdown fences use the new names
automatically.

For changes to saved state, update the live capture, reset, and restore code.
Before you add entries to `$Token`, check the fixed capacities for themes and
the emitter.

Token IDs define the theme ABI. The enum lists names alphabetically and places
rare tokens last. This keeps a one-byte constant for each common token.

Tests compile WAT directly and import `lib/`. They do not need a package build.
Language tests cover token classification and scan boundaries. Conformance tests
compare HTML, complete input, and stream output. Wasm tests cover the
preprocessor and optimizer changes. Stream and live tests cover saved state,
edits, and deferred work.

For code changes, run `moon run highlights:test` and
`moon run highlights:typecheck`. Run `moon run root:format root:lint` for all
changes. Documentation changes need only the format and lint checks.
