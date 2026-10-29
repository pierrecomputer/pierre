# Architecture

`@pierre/words` renders markdown in two passes over WebAssembly linear memory.
Block analysis walks the input line by line and appends fixed-size records
describing the document's structure; rendering walks those records once and
writes bytes. There is no syntax tree and no allocator: every region is a bump
pointer into one linear memory.

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
   up to eight bytes use an immediate integer store; nine to sixteen bytes use
   an immediate SIMD store. Longer literals are interned, overlap-merged, and
   emitted by `(string-pool …)`.
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
  [64:967)        pooled output string literals
  [967:983)       paragraph syntax/escaping low-nibble classifier
  [983:984)       carriage-return comparison byte
  [984:992)       quote-escape output literal
  [992:1008)      CR/LF byte classifier
  [1008:1024)     first-match lane packing table
  [1024:1072)     inline syntax/escaping nibble classifiers
  [1072:1088)     HTML escape low-to-high nibble classifier
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

Block phases share the first nonspace byte and its absolute column. A new line
invalidates that byte's address with zero. Advancing to the cached byte
preserves it; advancing past it triggers a scan. Partial-tab cursors derive
indentation from the cached column.

Top-level blank lines and paragraph continuations whose first nonspace byte
cannot start a block bypass the generic three-phase dispatch. After one such
continuation, a run of unindented LF-separated lines whose first byte cannot
interrupt the paragraph is appended without rebuilding the phase state. In HTML
mode, eligible runs coalesce older contiguous unpadded lines into source ranges
and publish their final descriptors once. The last physical line stays separate
for possible table-header conversion. The `joinedLines` flag prevents treating a
surviving multiline range as single-line content after removing a table header
or definitions.

An ordinary unindented byte at an empty document spine can start a paragraph
without those phases. In HTML mode, one SIMD scan then crosses ordinary lines,
retaining its classification tables and candidate mask across periods and line
feeds. An inner loop consumes the mask before advancing the vector base. The
scan stops before a possible block start or after the first line needing inline
processing. Construction reserves the complete header and at most two unpadded
ranges together, again keeping the last physical line separate. The empty
container stack needs no child bookkeeping.

That scan also proves whether the content needs neither inline parsing nor HTML
escaping. Syntax, possible autolinks, CR, and whitespace before an interior LF
invalidate the proof; trailing EOF whitespace is safe because leaf finalization
trims it. Construction stores the proof in the record's `plainInline` flag;
further line additions clear it. Removing a table header preserves the proof for
the remaining literal prefix. Completed leaves with that flag copy their
normalized content after reserving output space and resolving the possibly
movable content pointer. All other leaves use the general inline parser and
renderer. ANSI and nested blocks keep their existing paths.

Contiguous unindented LF-separated fenced-code lines also coalesce into one span
in HTML mode; ANSI retains individual lines so it can reapply their prefixes.
Unindented top-level HTML fences scan whole LF-separated body spans, stopping
before any line containing a fence byte or CR; ordinary scanning handles those
lines and possible closers. Empty document-level LF lines close ordinary leaves
before generic per-line state setup, but code and blank-insensitive HTML blocks
retain the normal path.

Containers appear as an opener record and a closer record around their children,
so the renderer needs no stack to know where a block ends. List looseness is
decided while scanning — a list becomes loose as soon as a block inside one of
its items ends with a blank line and the list then continues — and is
back-patched onto the list's opener record before rendering starts.

Link reference definitions are records too; the renderer skips them, and a hash
table appended after the last record maps a normalized label to its first
definition. A footnote definition is a container whose record doubles as its
label entry, so the same table indexes it, with a one-byte prefix keeping the
two namespaces apart. Definition records use the spare header word at byte 20 as
a next pointer. Block analysis appends them to a source-ordered chain and counts
them as they are created; building the hash table visits only this chain rather
than scanning unrelated block records twice. The chain and counts reset on every
render, and duplicate labels still resolve to the first record. The block walker
skips definitions where they were written; the renderer emits them at the end,
numbered in the order they were first referenced, and drops the ones nothing
referenced.

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

The inline scanner loads its classification tables once per leaf, retaining
those vectors across scanning iterations. It tests raw per-byte class bits for
any candidate before comparing them to zero and building a cached lane mask. The
same SIMD scan tracks whether unmarked text needs HTML escaping. Leaves with no
such bytes copy their literal gaps directly; recognized constructs keep their
own escaping rules. Ordinary HTML soft breaks outside brackets remain in those
gaps when neither adjacent byte needs whitespace trimming. Bracketed content
retains break marks because image alt text replaces newlines with spaces; ANSI
retains them for line prefixes and wrapping. After a literal quote, NUL, or `>`
requires escaping, a syntax-only scanner skips further such bytes. It returns
both its final vector's base and candidate mask so inline analysis can resume
without classifying that vector again. Candidate dispatch first separates ASCII
bytes below 64 from bytes 64 and above, avoiding unrelated handler checks while
retaining the same parsing routines for both groups. Periods and newlines reach
their handlers first in the low-ASCII group, before the checks for other
constructs.

Most scans that retain candidate masks select their lowest set lane with
`31 - clz(mask & -mask)`. Callers guard zero masks or select a separate result
for them. First-match-only scanners pack their per-byte match flags into four
bits per byte, ordered for direct `clz` selection. Both avoid external helper
calls on runtimes that do not inline Wasm `ctz`.

Line-end scanning classifies CR and LF with one byte-indexed SIMD lookup. Its
high-nibble flags need only one shift when packing a matching lane. It checks
the first vector alone, then shares presence tests across pairs of vectors. It
calculates a matching lane only after a hit; the input's 32-byte slack keeps the
final paired load inside memory. Bulk code-block scans also calculate a lane
only after a hit, retaining their fence and CR comparison vectors through the
16-byte loop. Table-cell scanning folds bit 5 before comparing with `|`, which
also recognizes the backslash byte without a second comparison.

HTML rendering batches safe literal gaps and consecutive emphasis marks across
at most 256 source bytes. One sixfold reservation covers the tags, and the
writer keeps its output cursor local for the run. It resolves scratch addresses
after reserving; other mark kinds and image labels use the general walker.

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
percent-encoding of link destinations. The five text-escaping bytes have
distinct low nibbles: one SIMD lookup gives the required high nibble for each
lane. Both text writers load that table once to avoid rebuilding vector
immediates inside the scan loop. The text escaper also loads its six-byte quote
replacement once, retaining that integer across repeated quotes. It consumes
each vector's candidate mask before scanning again and clips its final mask to
the input range, avoiding a bounds check per candidate. It selects a candidate
with `31 - clz(mask ^ (mask - 1))`, retaining `mask - 1` to clear that bit
without another subtraction. The reserved text writer returns its local cursor;
single-line code-span emission uses it to write both tags and escaped content
before publishing the output position.

Href-safe ASCII runs copy in SIMD spans. Title and autolink text cleanup shares
one pass with HTML escaping; decoded entities receive escaping without recursive
entity or backslash cleanup. Table cell openers reserve and emit their complete
markup together rather than checking capacity for each fragment. Link opening
tags use the URL and title writers' existing 64-byte reservation allowances for
their attribute boundaries, avoiding separate capacity checks for those bytes.

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
- **Bounded.** Input line scans may read up to thirty-one bytes past the end
  into the input's slack; other SIMD scans read up to fifteen bytes past their
  range. Scanners discard matches at or past the range end.
- **Reusable.** One instance renders any number of documents; `render` resets
  every global it depends on.
- **Documented limits.** Container nesting stops at 250 levels, link labels at
  999 characters, ordered list start numbers at nine digits, code fences at 255
  characters, and the input at 1 GiB.

## HTML-first streaming

The default component path renders Markdown directly to HTML in Wasm. Host glue
decodes the output into strings; it never invokes the element-tape scanner or
constructs owned Markdown nodes. `createHtmlSession()` retains a completed HTML
prefix and the source offset at its safe append boundary. The boundary lives in
control bytes 26–29 and the global-definition flag in byte 30. New completed
regions are rendered once more for their cached HTML; subsequent calls render
only the suffix. Edits, completion-option changes, suffix BOMs, and definitions
conservatively reset this cache.

Each session result carries a monotonically increasing `revision`, newly
completed `addition`, mutable `pending` HTML, and a `reset` flag. Repeated input
returns the same result. The formatter consumes additions directly instead of
comparing or slicing growing completed prefixes. Complete `stable` output
remains available, and the combined `html` string is assembled only when read;
each result retains its own strings if later updates change the session. Hook or
highlighter failures discard partial formatter caches so retrying the same
source rebuilds complete output rather than reusing a partial addition.

`html/render.ts` applies URL policies, element filters, code HTML, and trusted
HTML hooks using strings. The HTML/ANSI core APIs keep their original behavior;
the streaming HTML session omits raw source HTML. `complete.wat` repairs a
display copy of unfinished syntax and emits a sentinel for pending links. HTML
formatting removes that destination while keeping the anchor.

`html/dom.ts` owns an opaque native DOM region. A comment checkpoint separates
completed nodes from the mutable suffix. Browser templates parse only the new
completed region and live suffix; the patcher preserves matching native nodes
and advances the checkpoint without moving the content nodes. Definitions and
edits can require patching the entire output. No virtual tree, Markdown-node
objects, block signatures, or per-token React components are retained.
Consecutive formatter revisions supply additions directly to the templates.
Initial markup, resets, and skipped revisions reconcile the full completed
prefix so pre-rendering or discarded framework renders cannot lose content.

When the mutable suffix is one top-level incomplete code fence, the formatter
can pass changed-line HTML directly to the DOM renderer. One comment cursor
marks the beginning of the final content line inside the existing code element.
It is placed in the incoming template before fades can wrap line separators.
Subsequent updates parse and patch only the HTML after that cursor, then advance
it to the new final line. Earlier code nodes and the wrapper stay in place;
line-number text appends separately. This path uses no per-line wrapper elements
or node index. Nested fences, HTML hooks, element filters, custom language
renderers, completion, and incompatible cursor state use the ordinary complete
HTML path. The Markdown parser still renders the mutable source suffix.

Fades wrap newly delivered native text. A root-level timer tracks only live
spans, then unwraps them into ordinary text. Pausing, reduced motion, and zero
duration stop fades without replaying old chunks on resume.

The React adapter renders one container with stable initial HTML for SSR and
hydration, then reuses that formatter's caches in the committed DOM renderer.
Temporary highlighter sessions are released even when a render is abandoned.
React does not reconcile Markdown descendants. HTML hooks replace the earlier
arbitrary React-component override API.

Completed code fences use the highlighter's direct HTML output. One live
highlighter handles the mutable fence, reads borrowed Wasm records, and caches
line HTML strings. Its optional `highlightLines()` method returns the earliest
changed line, total line count, and balanced inline HTML for the remaining
lines, with LF separators outside elements. An HTML character offset identifies
the final content line so the DOM renderer can place its cursor without scanning
the serialized markup. Updates conservatively include the previous final content
line; repeated code returns an empty change.

The highlighter retains a completed HTML prefix and extends it only as lines
settle. Each update also exposes lazy `fullHtml` assembled from captured prefix
and suffix strings, so reading an older result after later edits or disposal
still returns that result's output. The existing `highlight()` string API uses
this complete output. Wasm's synthetic final LF is replaced through a live edit
when an unfinished code line grows, avoiding a tokenizer reset on every chunk.
The live session is released when the fence closes or disappears.

There is no structured-output compatibility layer or Wasm element-event tape.
The library exposes HTML strings, borrowed HTML bytes, and native DOM updates.
