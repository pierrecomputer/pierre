# Architecture

`@pierre/words` parses Markdown and writes HTML or ANSI in WebAssembly Text
(WAT). TypeScript connects the Wasm renderer to HTML strings, native DOM nodes,
and React.

The core uses two passes over one linear memory. Block analysis writes flat
records. The renderer reads those records and writes output bytes. There is no
syntax tree or general-purpose allocator.

```text
UTF-8 input
  -> frontmatter.wat   optional YAML -> JSON
  -> block.wat         lines -> block records
  -> render.wat        records -> HTML or ANSI
       inline.wat     block content -> inline marks -> resolved marks
```

## Source map

| Files                                        | Purpose                                         |
| -------------------------------------------- | ----------------------------------------------- |
| `src/md.wat`, `memory.wat`, `out.wat`        | Entry point, memory layout, and buffer growth.  |
| `src/block.wat`, `blockscan.wat`             | Block analysis and container state.             |
| `src/types.wat`, `record.wat`                | Record layout and block content.                |
| `src/inline.wat`, `link.wat`, `extlink.wat`  | Inline syntax, references, and autolinks.       |
| `src/scan.wat`, `entity.wat`, `htmlscan.wat` | SIMD scans, entities, and HTML grammar.         |
| `src/render.wat`, `html.wat`, `ansi.wat`     | Shared record traversal and output backends.    |
| `src/frontmatter.wat`, `complete.wat`        | YAML metadata and unfinished syntax completion. |
| `scripts/build.ts`                           | WAT preprocessor and compiler.                  |
| `lib/`                                       | Wasm loaders, byte APIs, and HTML sessions.     |
| `html/`                                      | HTML policies, hooks, and native DOM updates.   |
| `react/`                                     | React adapter, styles, and Highlights plugin.   |

## Build

[`scripts/build.ts`](./scripts/build.ts) expands a small set of WAT extensions:

- Local imports combine modules into one namespace.
- Enums, constants, and bitsets define shared layouts and flags.
- `out.str` writes short literals directly and stores longer literals in a pool.
- Table generators supply HTML entities, Unicode data, and HTML tag names.
- Character constants pack ASCII bytes into integers.

Enum order is part of the ABI. Constant definitions live in
[`memory.wat`](./src/memory.wat) and [`types.wat`](./src/types.wat).

The build uses WABT with bulk memory and SIMD, then three Binaryen optimization
passes. It also checks static data segments for overlap. The output includes
Wasm, JavaScript loaders, and TypeScript declarations in `dist/`.

## Memory

The first 64 KiB holds control fields, generated tables, and fixed-size work
buffers. The remaining memory holds document data:

```text
input + NUL sentinel + at least 32 bytes of slack
frontmatter JSON
block records + reference table + footnote order
output                         grows upward
scratch content + inline marks grows upward
packed emphasis tags           grow downward from the memory end
```

Frontmatter finishes before block analysis, and block analysis finishes before
output. Scratch data must coexist with output growth. When output needs more
space, the renderer grows memory and moves scratch data to the new end.

Scratch references use offsets because growth can invalidate pointers. Resolve
an offset after any call that can grow memory. Keep `$scratchUsed` large enough
to include all data that must survive a move.

The byte APIs return views into shared Wasm memory. Copy or decode a result
before the next render call. The host refreshes its memory views after growth.

See [`md.wat`](./src/md.wat) for the control fields and
[`memory.wat`](./src/memory.wat) for exact addresses.

## Block analysis

Each line has three steps:

1. Match open containers, such as lists and block quotes.
2. Find new block starts.
3. Attach the remaining content to the deepest open block.

Each record contains a type, flags, total size, type-specific data, and source
line ranges. The renderer uses the size to find the next record. Containers have
opener and closer records around their children.

A leaf's line ranges must stay contiguous. No other record can start while that
leaf is open. Removal of trailing lines reduces `nLines`, but never the record
size. Line ranges also encode virtual spaces from partial tabs, so the input
stays unchanged.

Block analysis determines list tightness and records link and footnote
definitions. A hash table maps normalized labels to their first definition.
Footnotes appear at the end, in reference order. Unused footnotes produce no
output.

HTML fast paths combine contiguous plain-text or code lines into source ranges.
The last physical paragraph line stays separate for possible table-header
conversion. `joinedLines` identifies ranges with multiple lines. `plainInline`
marks content that needs no inline analysis or HTML escapes.

## Inline analysis and output

The inline parser uses one contiguous range per leaf. It reads suitable input
ranges directly. Other leaves use scratch space for tab expansion and normalized
line breaks.

A scan creates 32-byte inline marks. Code spans, links, images, entities, and
other constructs resolve during the scan. Emphasis resolves afterward with the
CommonMark delimiter algorithm and its rule of three. Original delimiter lengths
and remaining lengths stay separate. Packed emphasis tags preserve tag order.

The shared renderer walks block records and inline marks. HTML and ANSI backends
supply the output rules:

- HTML reproduces the reference output, with escapes and URL encoding.
- ANSI tracks line prefixes, nested styles, wrap width, and table column widths.

SIMD helpers scan 16 bytes at a time. Fast paths copy safe text directly and
reserve output space for batches of text and tags. Scratch pointers must resolve
after these reservations.

## Incremental HTML and DOM updates

`createHtmlSession()` retains completed HTML and reparses the mutable source
suffix. A blank line with a final newline is a safe boundary outside open
containers. Lists, quotes, tables, and code remain mutable until the parser
closes them. A long open paragraph still requires a full parse on each update.

The session returns:

| Field      | Meaning                                           |
| ---------- | ------------------------------------------------- |
| `stable`   | Complete HTML prefix.                             |
| `addition` | Newly completed HTML since the previous revision. |
| `pending`  | Mutable HTML suffix.                              |
| `html`     | Full output, assembled on access.                 |
| `revision` | Output version.                                   |
| `reset`    | The previous prefix is no longer reusable.        |

Repeated input with unchanged options returns the same result. Edits,
completion-option changes, suffix BOMs, and global definitions reset the cache.
Definitions can affect earlier output, so they require a full-document path.

`complete.wat` repairs a display copy of unfinished syntax. The HTML session
omits raw source HTML. `html/render.ts` applies URL validation, element filters,
code plugins, and trusted HTML hooks. It removes the destination of an
unfinished link but keeps its anchor.

`html/dom.ts` owns native DOM nodes. A comment separates completed content from
the mutable suffix. Updates parse new HTML and preserve matching nodes. Resets
and skipped revisions reconcile the full completed prefix.

For a supported open code fence, a second comment marks the final content line.
The renderer updates only the changed lines. Other cases use the normal HTML
path. The Markdown parser still reparses the mutable source suffix.

Completed fences use direct HTML from Highlights. An open fence retains one live
tokenizer and cached line strings. The plugin releases the tokenizer when the
fence closes or disappears. Fades temporarily wrap new text and remove those
wrappers when the effect ends.

React owns one container for server output, hydration, and later updates. It
does not reconcile individual Markdown nodes. The library exposes bytes,
strings, and DOM updates, with no Markdown node API.

## Constraints

- Keep the parser and output backends in WAT. TypeScript supplies host adapters.
- Every scanner must advance and respect its range. Malformed input must not
  trap or loop forever.
- Line scans can read up to 31 bytes beyond input. Other SIMD scans can read up
  to 15 bytes beyond their range. Discard all matches outside the range.
- Each render must reset its document state so one instance can serve many
  documents.
- Limits are 250 container levels, 999 characters per link label, nine digits
  per ordered-list start, 255 characters per code fence, and 1 GiB of input.

See [AGENTS.md](./AGENTS.md) for implementation traps and test guidance. The
[benchmark guide](./benchmark/README.md) covers performance measurements.
