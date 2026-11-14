# Architecture

`@pierre/words` parses Markdown and writes HTML or ANSI in WAT. TypeScript loads
the Wasm module and adds HTML options, DOM updates, and React.

The core makes two passes over one linear memory. Block analysis writes flat
records. The renderer reads those records and writes output bytes. There is no
syntax tree and no general-purpose allocator.

```text
UTF-8 input
  -> frontmatter.wat   optional YAML -> JSON
  -> block.wat         lines -> block records
  -> render.wat        records -> HTML or ANSI
       inline.wat      block content -> inline marks
```

## Source map

| Files                                        | Purpose                                        |
| -------------------------------------------- | ---------------------------------------------- |
| `src/md.wat`, `memory.wat`, `out.wat`        | Entry point, memory layout, and buffer growth  |
| `src/block.wat`, `blockscan.wat`             | Block analysis and container state             |
| `src/types.wat`, `record.wat`                | Record layout and block content                |
| `src/inline.wat`, `link.wat`, `extlink.wat`  | Inline syntax, references, and autolinks       |
| `src/scan.wat`, `entity.wat`, `htmlscan.wat` | SIMD scans, entities, and HTML grammar         |
| `src/render.wat`, `html.wat`, `ansi.wat`     | Record traversal and output backends           |
| `src/format.wat`                             | Final markup for the HTML renderer             |
| `src/frontmatter.wat`, `complete.wat`        | YAML frontmatter and unfinished syntax         |
| `scripts/build.ts`                           | WAT preprocessor and compiler                  |
| `lib/`                                       | Wasm loaders, byte APIs, and HTML sessions     |
| `html/`                                      | HTML options, hooks, and DOM updates           |
| `react/`                                     | React component, styles, and Highlights plugin |

## Build

[`scripts/build.ts`](./scripts/build.ts) expands these WAT extensions:

- Local imports combine the modules into one namespace.
- `enum`, `const`, and `bitset` define shared layouts and flags. Enum order is
  part of the ABI.
- `out.str` writes a literal. Short literals become immediate stores, and longer
  ones go in a string pool.
- Table forms generate the HTML entity, Unicode, and tag name data. The Unicode
  range tables are stored packed, and the module expands them when it is
  instantiated.
- A string operand of `i32.const` or `i64.const` packs its bytes into an
  integer.

The passes that `@pierre/highlights` also needs live in
[`@pierre/wat-tools`](../wat-tools/index.ts). Its final pass rewrites two forms
that JavaScriptCore miscompiles, so Bun and Safari can use their optimizing
tier.

The build compiles with WABT and runs three Binaryen passes. It fails if static
data segments overlap. `tsdown` then writes the JavaScript and declarations to
`dist/`.

## Memory

The fixed prefix holds control fields, generated tables, and work buffers. See
[`md.wat`](./src/md.wat) for the control fields and
[`memory.wat`](./src/memory.wat) for exact addresses. Input starts at byte
65,536; JavaScript grows memory before writing it after this fixed prefix. Named
entities expand from front-coded names into an immutable index at instantiation.
The last 4 KiB of the prefix hold the id prefix of formatted HTML. Document data
comes after:

```text
input + NUL sentinel + at least 32 bytes of slack
frontmatter JSON
block records + reference table + footnote order
bounded ANSI table measurements, when needed
output                         grows upward
scratch content + inline marks grows upward
packed emphasis tags           grow downward from the memory end
```

Only scratch data has to share space with a growing region. When output needs
more room, the renderer grows memory and moves scratch data to the new end.

**Warning:** Growth can invalidate pointers, so scratch references are offsets.
Resolve an offset after any call that can grow memory, and keep `$scratchUsed`
large enough to cover all data that must survive a move.

The byte APIs return views of Wasm memory. Decode or copy a result before the
next render. The host refreshes its views after memory grows.

## Block analysis

Each line goes through three steps:

1. Match open containers, such as lists and block quotes.
2. Find new block starts.
3. Add the remaining content to the deepest open block.

Unindented root headings and fences can write their records directly. Ordinary
paragraph lines are collected together, including lines after inline syntax; the
inline parser still handles the full span. A first-byte bitset stops this scan
before possible block starts, where the general block rules take over.

A record holds a type, flags, its total size, type-specific data, and source
line ranges. The renderer uses the size to find the next record. Containers have
an opener record and a closer record around their children.

The line ranges of a leaf must stay contiguous, so no other record can start
while a leaf is open. Removing trailing lines reduces `nLines` but not the
record size. The line ranges of code and HTML blocks also encode the virtual
spaces of partial tabs, so the input never changes.

This pass also decides list tightness and records link and footnote definitions.
A hash table maps normalized labels to their first definition. Footnotes render
at the end, in reference order, and unused footnotes render nothing.

For HTML, runs of plain text or code lines share one source range. The last line
of a paragraph stays separate, because it can become a table header.
`joinedLines` marks ranges with several lines, and `plainInline` marks content
that needs no inline analysis or HTML escapes.

## Inline analysis and output

The inline parser takes one contiguous range per leaf. It reads the input
directly when it can. Other leaves join their lines in scratch space.

A scan creates 32-byte inline marks. Code spans, links, images, and entities
resolve during the scan. Emphasis resolves afterward with the CommonMark
delimiter algorithm and its rule of three.

The shared renderer walks block records and inline marks, and each backend
supplies its own output rules:

- HTML matches the reference output, with escapes and URL encoding.
- ANSI tracks line prefixes, nested styles, wrap width, and table column widths.

SIMD helpers scan 16 bytes at a time. Fast paths copy safe text directly and
reserve output space for batches of text and tags.

## Streaming

[`createHtmlSession()`](./lib/core.ts) keeps completed HTML and reparses only
the end of the source. A newline-terminated blank line at document depth is a
safe boundary. Lists, quotes, tables, and code can change until the parser
closes them. Wasm reports the boundary as UTF-16 lengths, so the session can
slice its strings without a second render.

After full parsing validates a single-line paragraph or an unindented top-level
code fence, the session can extend its literal content directly. A paragraph may
contain completed inline formatting before its final literal word. Syntax
characters, possible closing fences, control characters, and structural changes
return to the parser. Changed-text and changed-line metadata let the DOM
renderer append content without scanning or materializing the whole pending
HTML. This metadata and the format option use private symbols shared by the core
and renderer bundles; public result types and enumerable string keys stay
unchanged. Each result still provides independent full HTML through lazy
getters.

An edit, a changed `incomplete` option, a BOM at the boundary, or a link or
footnote definition resets the session. Definitions can change earlier output,
so those documents always render in full.

[`complete.wat`](./src/complete.wat) repairs a display copy of unfinished
syntax. It never changes the source. It runs after block analysis and looks only
at the last block, and the parser runs again only when the copy changed. It
pairs delimiter runs as the parser does, and it writes no closer that might not
pair, because that closer would show as text. React asks for repairs only while
the stream is active.

## Formatted HTML

The HTML renderer needs more than CommonMark HTML: each tag names itself in
`data-markdown`, links pass the URL rules, generated ids take a prefix, and a
code block has a header, line numbers, and line groups. A second pass over the
output in JavaScript cost more than the parse. So a session can ask Wasm for
this markup with a private option, and [`format.wat`](./src/format.wat) and the
tag writers of `html.wat` write it in the same pass. The option is a set of flag
bits (control byte 26) and the escaped id prefix. Public sessions and
`renderToHtml` still write plain HTML.

[`html/render.ts`](./html/render.ts) only runs what needs the host:

- A URL hook (`urlTransform`). Wasm then leaves URLs unchecked, and the host
  checks the result of the hook.
- Element filters, code plugins, and custom code renderers. Wasm then writes
  each code block in slots: the language, the markup before `<code>`, the
  `<code>` tag, and the escaped code, each after a NUL. The output holds no
  other NUL, so a single-character search finds every block.
- Element hooks, which run last on the finished HTML.

The fence that is still open is always in slots, without its gutter, so the host
can update single lines and add line numbers as they arrive.

[`html/dom.ts`](./html/dom.ts) patches DOM nodes:

- Node references separate completed content from the part that can still
  change. Comments retain boundaries only where fade cleanup can merge text. A
  reset or a skipped revision reconciles the whole completed prefix.
- Plain text appends update existing text nodes. Other canonical HTML updates
  reconcile nodes directly, with native bulk parsing for new subtrees. Hooks and
  filters use the general DOM reconciliation path. Literal paragraph appends
  also work with a configured code highlighter or fades; animated appends use
  the same fade spans and cleanup as general reconciliation.
- Open fences update only changed lines. This also works inside lists and
  quotes, where the parser still validates the containing structure.
- Code lines sit in groups, 64 lines each in plain and open fences, so the
  browser lays out only the last group.
- A native deep compare (`isEqualNode`) skips each unchanged element of the part
  that can still change.
- Newly completed paragraphs, headings, and code-line groups can fade as whole
  elements. Changing text uses temporary spans, removed when the fade ends.

The Highlights plugin uses `codeToHtml` for completed fences. An open fence
keeps one live tokenizer until its fence leaves the pending output. Completed
output moves forward without a lookup cache for previously rendered code.

React owns one container for server output, hydration, and later updates. It
does not reconcile individual Markdown nodes.

## Constraints

- Keep Markdown syntax and output backends in WAT, and the markup of the HTML
  renderer too. Host sessions may extend parser-validated literal content;
  syntax changes return to the parser.
- Every scanner must advance and stay in its range. Malformed input must not
  trap or loop forever.
- Line scans can read up to 31 bytes past the input, and other SIMD scans up to
  15 bytes past their range. Discard any match outside the range.
- Each render must reset its document state, because one instance serves many
  documents.
- Binaryen inlines every function with one caller, but V8 inlines small helpers
  only while the caller stays within its size budget. A large phase in a hot
  loop needs two call sites to stay out of line (see `$addBlockLine`).
- Limits: 250 container levels, 999 characters per link or footnote label, nine
  digits per ordered-list start, 512 table columns, 255 backticks per code span,
  256 open brackets per leaf, 64 open delimiter runs in the block that
  completion repairs, 4,096 bytes of escaped id prefix, and 1,073,610,752 bytes
  (2^30 − 128 KiB) of input.
- A table closes after a row takes it past 524,288 auto-filled cells, matching
  cmark-gfm. Later lines parse as normal Markdown. Supplied cells do not count
  toward this limit.
