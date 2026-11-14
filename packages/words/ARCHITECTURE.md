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

The first 64 KiB holds control fields, generated tables, and fixed work buffers.
See [`md.wat`](./src/md.wat) for the control fields and
[`memory.wat`](./src/memory.wat) for exact addresses. Document data comes after:

```text
input + NUL sentinel + at least 32 bytes of slack
frontmatter JSON
block records + reference table + footnote order
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

An edit, a changed `incomplete` option, a BOM at the boundary, or a link or
footnote definition resets the session. Definitions can change earlier output,
so those documents always render in full.

[`complete.wat`](./src/complete.wat) repairs a display copy of unfinished
syntax. It never changes the source. It runs after block analysis and looks only
at the last block, and the parser runs again only when the copy changed. It
pairs delimiter runs as the parser does, and it writes no closer that might not
pair, because that closer would show as text. React asks for repairs only while
the stream is active.

[`html/render.ts`](./html/render.ts) adds URL checks, element filters, code
plugins, and hooks. [`html/dom.ts`](./html/dom.ts) patches DOM nodes:

- A comment separates completed content from the part that can still change.
  Updates parse only the new HTML and keep matching nodes. A reset or a skipped
  revision reconciles the whole completed prefix.
- A second comment marks the last line of an open code fence, so updates touch
  only the changed lines. This also works inside lists and quotes.
- Code lines sit in groups, 64 lines each in plain and open fences, so the
  browser lays out only the last group.
- A native deep compare (`isEqualNode`) skips each unchanged element of the part
  that can still change.
- Fades wrap new text in spans and remove the spans when the animation ends.

The Highlights plugin uses `codeToHtml` for completed fences. An open fence
keeps one live tokenizer, which the plugin releases when the fence closes or
disappears. The live tokenizer keeps escape sequences as text and does not use a
registered built-in language module. So an open fence in `ansi` or in a language
from `registerLanguages` renders again with `codeToHtml` on each update.

React owns one container for server output, hydration, and later updates. It
does not reconcile individual Markdown nodes.

## Constraints

- Keep the parser and output backends in WAT. TypeScript only connects them to
  the host.
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
  completion repairs, and 1,073,610,752 bytes (2^30 − 128 KiB) of input.
- A table closes after a row takes it past 524,288 auto-filled cells, matching
  cmark-gfm. Later lines parse as normal Markdown. Supplied cells do not count
  toward this limit.
