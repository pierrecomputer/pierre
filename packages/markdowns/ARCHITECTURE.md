# Architecture

`@pierre/markdowns` renders markdown in two passes over WebAssembly linear
memory. Block analysis walks the input line by line and appends fixed-size
records describing the document's structure; rendering walks those records once
and writes bytes. There is no syntax tree and no allocator: every region is a
bump pointer into one linear memory.

```text
UTF-8 input
  -> frontmatter.wat   YAML -> JSON (optional)
  -> block.wat         lines -> flat block records
  -> render.wat        records -> HTML or ANSI
       inline.wat      per block: content buffer -> marks -> resolved marks
```

## Project structure

```
src/ansi.wat         the terminal backend, including display width
src/block.wat        the three-phase line algorithm and the container stack
src/blockscan.wat    line cursors and every block start scanner
src/entities.txt     the HTML5 named character reference table
src/entity.wat       HTML5 named and numeric character references
src/extlink.wat      the GFM extended autolinks
src/html.wat         the HTML backend
src/htmlscan.wat     the HTML tag grammar and the generated word tables
src/inline.wat       inline mark collection, emphasis resolution, and brackets
src/link.wat         link reference definitions, case folding, and the link grammar
src/md.wat           memory, the memory map, and the `render` export
src/memory.wat       named addresses for page 1
src/out.wat          the four output regions and their growth
src/record.wat       block record accessors and the per-block content buffer
src/render.wat       the block and inline walkers, and URL and text escaping
src/scan.wat         input cursors, byte classes, and the SIMD scans
src/types.wat        the block record layout, $Blk, and the flag constants
scripts/build.mjs    the WAT preprocessor and compiler
scripts/gen-spec.mjs refreshes the conformance test fixtures
lib/                 the JavaScript glue and the compiled module
```

## WAT preprocessor (scripts/build.mjs)

`transformWat()` adds a small source layer over WAT. Its forms are invalid
before preprocessing, so editor warnings are expected.

1. **Imports:** `(import "./scan.wat")` inlines each local module once into one
   `$name` namespace. Host imports are hoisted.
2. **Enums:** `(enum $Blk "none" ...)` defines sequential indices;
   `(enum.get $Blk.none)` inserts one. Order is ABI. Keep parentheses out of
   enum comments.
3. **Addresses and constants:** `(const $mem.name 64)` defines a build-time
   value, and every `$mem.name` (optionally with a `+n`/`-n` bias) is
   substituted. Definitions live in `src/memory.wat` and `src/types.wat`; names
   must not contain `-`.
4. **String pool:** `(out.str "…")` writes a literal to the output. Literals of
   eight bytes or fewer become one immediate store; longer ones are interned,
   overlap-merged, and emitted by `(string-pool …)`.
5. **Generated tables:** `(entity-table …)` emits the 2125 HTML5 character
   references, `(unicode-punct-table …)` the P and S code point ranges,
   `(unicode-fold-table …)` full case folding, `(unicode-width-table …)` the
   terminal width ranges, and `(word-table …)` a sorted, length-grouped word
   set.
6. **Bitsets:** `(bitset …)` emits one byte per enum member; `(bitset.get …)`
   becomes a load and mask.
7. **Character constants:** `(i32.const "true")` packs up to four ASCII bytes
   little-endian; `i64.const` packs eight. Use hex escapes for quotes and
   control bytes.

`wat2wasm()` enables bulk memory and SIMD, and `optimizeWasm()` runs Binaryen
`-O3` three times. `checkDataSegments()` asserts that the generated tables still
tile page 1 without overlapping.

## Memory layout

Page 1 is static. Everything that scales with the input lives above it.

```text
[] page 1 (control block and generated tables)
  [0]             render mode (u8): 0 = html, 1 = ansi
  [1]             option flags (u8): bit 0 = frontmatter, bit 1 = skip raw HTML,
                  bit 2 = repair a delivery-ending closed link label
  [2:6)           input length (u32 LE)
  [6:10)          output start (u32 LE)
  [10:14)         output length (u32 LE)
  [14:18)         frontmatter JSON start (u32 LE, 0 when absent)
  [18:22)         frontmatter JSON length (u32 LE)
  [22:26)         ansi wrap width (u32 LE, 0 = none)
  [26:30)         safe append boundary (input byte offset)
  [30]            document contains global link/footnote definitions
  [32:48)         decimal conversion scratch
  [48:64)         hex digits
  [64:1088)       pooled output string literals
  [1088:27712)    HTML5 named character references
  [27712:29248)   Unicode P|S code point ranges
  [29248:32576)   Unicode case folding
  [32576:33344)   HTML block tag names and the GFM tag filter list
  [33344:36672)   Unicode display width ranges
  [36672:36744)   ansi marker fragments and SGR depth counters
  [36744:42744)   block analysis container stack (250 × 24). After analysis,
                  rendering reuses [36744:37768) as the type/tightness stack
                  and [37768:41240) as opener bottoms, the tick memo, and
                  the bracket stack
  [42744:44024)   table column widths and alignments
  [44024:45048)   ansi line prefix and pending marker
  [45048:46584)   ansi list state
  [46584:65536)   cached ansi table-cell widths (4738 × u32)

[] pages 2..N (text buffer)
  [65536:EOF)     input, a NUL sentinel, then at least 32 bytes of slack
  [meta:rec)      frontmatter JSON
  [rec:out)       block records, the reference hash table, the footnote order
  [out:…)         rendered output
  [scratch:tags)  rebuilt block content when needed, then dense inline marks
  [tags:end)      packed emphasis tags growing down from memory's end
```

Four regions grow, in the order they stop growing: the frontmatter JSON, then
the block records, then the output. The per-block scratch is the only one that
has to coexist with a growing neighbour, so it sits at the very top of memory
and moves up whenever the output would reach it. Its content/mark prefix grows
upward and its packed-tag suffix grows downward. Growth is geometric, so the
moves are amortized O(1); both halves use offsets that survive the at-most-two
`memory.copy` operations needed to rebase them.

## Block records

Block analysis is the reference parser's three-phase line algorithm: match the
open containers, look for new block starts, then attach the rest of the line to
the deepest open block. Instead of building a tree it appends records:

```text
[0]  type (u8, $Blk)      [1]  flags (u8, $F)
[4]  size (u32, the whole record)
[8]  data (u32)           [12] aux (u32)
[16] nLines (u32), then type-specific bytes padded to eight
[..] nLines * { beg u32, end u32 }
```

`size` makes the stream walkable without knowing any type's layout, and keeping
the variable-length part _before_ the lines means dropping trailing lines never
moves anything. A line's `end` carries, in its top two bits, the number of
virtual spaces a partially consumed tab left in front of it, which is what makes
tab stops work without ever rewriting the input.

Top-level blank lines and paragraph continuations whose first nonspace byte
cannot start a block bypass the generic three-phase dispatch. After one such
continuation, a run of unindented LF-separated lines whose first byte cannot
interrupt the paragraph is appended without rebuilding the phase state; every
line still keeps its own record. In HTML mode, contiguous unindented
LF-separated fenced-code lines also coalesce into one span; ANSI retains
individual lines so it can reapply their prefixes.

Containers appear as an opener record and a closer record around their children,
so the renderer needs no stack to know where a block ends. List looseness is
decided while scanning — a list becomes loose as soon as a block inside one of
its items ends with a blank line and the list then continues — and is
back-patched onto the list's opener record before rendering starts.

Link reference definitions are records too; the renderer skips them, and a hash
table appended after the last record maps a normalized label to its first
definition. A footnote definition is a container whose record doubles as its
label entry, so the same table indexes it, with a one-byte prefix keeping the
two namespaces apart. The block walker skips definitions where they were
written; the renderer emits them at the end, numbered in the order they were
first referenced, and drops the ones nothing referenced.

## Inline analysis

The inline parser sees each leaf as one contiguous content range. Unpadded
recorded lines that already form one LF-separated input span alias that
immutable input directly; all other leaves are rebuilt in scratch with virtual
padding and normalized line feeds. Marks remain scratch-offset-addressed in
either case. A left-to-right scan records every construct as a _mark_:

- Constructs that bind tightest are resolved as they are found: code spans,
  autolinks, raw HTML, entities, backslash escapes, line breaks, and the `]`
  lookahead that turns a bracket into a link or an image.
- Emphasis delimiter runs are only recorded, with their flanking flags and the
  count of delimiters still unconsumed. The original run length is `end - beg`,
  so a run of any length is represented exactly.

Emphasis is then resolved over the delimiter marks with the spec's
`process_emphasis` algorithm, including the `openers_bottom` bookkeeping that
keeps it linear and the "rule of three" that decides whether a run may pair. A
match trims characters off the inner ends of the two runs and pushes a tag onto
the opener's and closer's lists. The closer-consumed width is derived from those
tag kinds, so it is not stored separately. Each bracket snapshots the current
delimiter tail, so link-local emphasis starts at its first possible closer
instead of rescanning delimiter runs before the bracket. Rendering emits an
opener's tags in reverse creation order and a closer's in creation order, which
is what produces `<em><strong>…</strong></em>` nesting.

Marks are contiguous 32-byte records and rendering walks them by ordinal.
Emphasis tags are packed four-byte words in the scratch suffix: the low two bits
hold the kind and the rest is a top-relative next ID. Open lists are singly
linked; close lists are circular so one word in the mark retains both their head
order and tail append point.

## Rendering

`renderBlocks` walks the record stream once, pushing and popping a small stack
so it knows whether a paragraph sits in a tight list item. Every emission goes
through a hook that dispatches on the render mode, so the HTML and terminal
backends share the whole parser and differ only in what they write.

The HTML backend reproduces the reference renderer byte for byte, down to its
`cr()` newline rule, its `&quot;` text escaping, and its uppercase
percent-encoding of link destinations.

The terminal backend keeps a line prefix (block quote bars, list indents) and
re-emits it after every line break, so nested content stays aligned. Inline
styling is a depth counter per style bit, so closing an inner `<em>` inside an
outer one does not end the italics, and the mask is re-applied after each reset
so a prefix never inherits the style around it. Table columns are measured by
rendering each cell, measuring the emitted bytes with a display-width function
that skips escape sequences and knows the East Asian wide and zero-width ranges,
and rewinding the output cursor.

## Invariants

- **Total.** Malformed input never traps and never loops: every scanner
  advances, every bounded construct is clamped to its range, and the fuzz suite
  checks that four thousand random inputs render to valid UTF-8 with balanced
  tags.
- **Bounded.** Wide loads may read up to fifteen bytes past a range into the
  buffer's slack, but a match at or past the end is discarded.
- **Reusable.** One instance renders any number of documents; `render` resets
  every global it depends on.
- **Documented limits.** Container nesting stops at 250 levels, link labels at
  999 characters, ordered list start numbers at nine digits, code fences at 255
  characters, and the input at 1 GiB.

## Structured React output

`renderToElements()` renders with raw HTML disabled, then `elements.wat` walks
only the generated markup and emits a tape of fixed-size element, attribute, and
text records. Host glue decodes these into owned objects before another render
can invalidate Wasm memory. The HTML and ANSI paths do not scan this tape. This
adds a linear pass for structured output; it does not require a browser DOM
parser or a JavaScript Markdown parser.

`complete.wat` repairs a display copy of common unfinished inline constructs. It
uses a bounded delimiter stack, protects code fences, and emits a sentinel for
incomplete links. The React layer never navigates to the sentinel. The HTML
backend marks the specific fenced code record closed by EOF as incomplete in
structured output, so completed code blocks become interactive while the message
is streaming.

The React adapter validates attributes and URLs, builds React elements, and
memoizes each top-level output block by its serialized contents and rendering
configuration. `createMarkdownSession()` also caches owned nodes before the last
safe append boundary: a newline-terminated blank line where no container or leaf
remains open. The parser publishes that byte offset in control bytes 26–29; host
glue converts it to a UTF-16 string offset before Wasm memory can be reused.
EOF-only closures never establish a boundary. Newly completed regions are parsed
once more to obtain their cached nodes; later appends parse only the suffix. No
block pointers survive across calls to the shared Wasm instance.

The link index publishes a global-definition flag in control byte 30. Any
reference or footnote definition disables prefix reuse and reparses the entire
document, including earlier references. Replacement edits and changes to
completion options reset the cache. A BOM at the start of a suffix also forces a
full parse because only the original document's BOM may be skipped. Long open
blocks are still reparsed in full; arbitrary-edit convergence and incremental
reference dependency tracking are future work.

When a delivery ends at a link label's `]`, completion records its original EOF
and sets option bit 2. Inline analysis first resolves real references, then
gives only that trailing unresolved label a pending-link mark. The HTML backend
emits the same sentinel destination used for open labels. This avoids inserting
a synthetic destination into code or reference-definition source. The React
adapter keeps the anchor or custom link mounted and omits `href` until
validation succeeds.

The Highlights adapter creates a separate `LiveTokenizer` for each code block.
Append edits resume lexer state near the final line; unchanged earlier token
arrays are reused. Language changes and replacement edits reset the tokenizer.
The React adapter disposes sessions on unmount or plugin replacement, and a
disposed session may restart lazily (including after Strict Mode effect replay).

## React block metadata

The React adapter stores each owned block's serialized content and incomplete
fence flag in a `WeakMap` keyed by node identity. Completed nodes reused by the
parser avoid both repeated serialization and recursive fence scans. Replaced
nodes remain eligible for garbage collection. A full parse still produces new
nodes, whose signatures are compared by content to preserve unchanged custom
component state. Changes to rendering context or incomplete status still cause
updates. Session nodes must remain immutable for this cache to be valid.

The docs production demo can be profiled with `markdowns:bench-render`; see
[the browser measurements](./benchmark/RENDERING.md).
