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
| `src/words.wat`, `memory.wat`, `out.wat`     | Entry point, memory layout, and buffer growth  |
| `src/block.wat`, `blockscan.wat`             | Block analysis and container state             |
| `src/types.wat`, `record.wat`                | Record layout and block content                |
| `src/inline.wat`, `link.wat`, `extlink.wat`  | Inline syntax, references, and autolinks       |
| `src/scan.wat`, `entity.wat`, `htmlscan.wat` | SIMD scans, entities, and HTML grammar         |
| `src/render.wat`, `html.wat`, `ansi.wat`     | Record traversal and output backends           |
| `src/format.wat`                             | Final markup for the HTML renderer             |
| `src/frontmatter.wat`, `complete.wat`        | YAML frontmatter and unfinished syntax         |
| `src/math.wat`                               | TeX math to SVG                                |
| `src/math-none.wat`                          | Replaces `math.wat` in `@pierre/words/no-math` |
| `tables/`                                    | Entity names, TeX commands, and glyph metrics  |
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
[`words.wat`](./src/words.wat) for the control fields and
[`memory.wat`](./src/memory.wat) for exact addresses. Pages 2 to 4 hold the math
tables, the output string pool, and the math box nodes. Input starts at byte
262,144; JavaScript grows memory before writing it after this fixed prefix.
Named entities expand from front-coded names into an immutable index at
instantiation. The last 4 KiB of the prefix hold the id prefix of formatted
HTML. Document data comes after:

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

## Math

With the math option, `$` joins the inline syntax bytes and `$$` the fence
markers. A `$$` fence has no info string: text after the opening `$$` is its
first line, and it closes at a later line that ends with an unescaped `$$`. It
opens only when that line comes before a blank line or EOF, and every line up to
it continues the opener's containers (quote markers, item indents). A lone `$$`
with nothing after it stays text. Only failed scans are memoized, so each line
is scanned once. With the option off, `$` starts no block. Streaming completion
skips closed math and repairs nothing after an opener that can still close, but
it reads past the opener as the parser does. With math on, a repaired paragraph
ends in a blank line, so completion text cannot turn a `$$` line into a block. A
math mark or block copies its TeX to a fixed buffer, because output growth can
move scratch content. [`math.wat`](./src/math.wat) then parses and lays out the
formula in one pass, as TeX's appendix G does:

- Atoms collect on a stack until their list ends. Then scripts attach, binary
  operators without operands become ordinary, and inter-atom spaces apply.
- Each box is a 48-byte node with a size, a position in its parent, and a kind:
  glyph, list, rule, path, text, or space. The SVG writer walks the boxes once.
- Glyphs print as Unicode math alphanumerics, each at its own position, so the
  system math font draws them. Delimiters that must grow, radicals, braces, and
  wide accents are SVG paths.
- Glyph metrics and layout constants come from the MATH table of STIX Two Math
  (`scripts/gen-math-metrics.py`). The commands are in `tables/math.txt`; the
  build front-codes them into the node area, and the first formula unpacks them
  before it takes nodes, so a document without math skips that work. Name groups
  that do not fit their area, and the macro bodies, go to the second half of the
  atom area (atoms are 8 bytes, so the first half holds 1024 of them).
- A macro (`\argmax`, `\bra`, `\TeX`, ...) is TeX in the table that parses in
  place of the command, so its atoms join the list that reads it. A body with an
  argument is first copied past the source with the argument's text. The copy is
  freed after it parses unless a text or color node points into it; the
  remaining space runs out like the other limits.
- An infix `\over` is found after its numerator was laid out in the wrong style,
  so the list is parsed again, and the first pass's nodes are freed. A table of
  (start, split) pairs lets a numerator parsed again split its inner groups at
  once, so nested splits cost linear work; once the table is full, a split that
  would be searched again fails the formula.
- Font switches (`\bf`, `\rm`, ...) set the letter font until their group ends.
  STIX Two Math has no bold face, so bold text prints math bold letters, digits
  and Greek, and strokes other characters.

A formula that overflows the node arena, the atom or cell stacks, 48 levels of
nesting, or 16,000 bytes of source writes nothing, and the caller shows its
source as code. HTML sessions keep each math SVG as one DOM unit.

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

With an `allowedHtml` list, an allowed element can stay open across a blank
line, so block analysis cannot place the boundary alone. It writes an empty
record at each candidate, and the renderer takes the last one where no allowed
element is open. Open elements close with their leaf, container, or the
document, so pending HTML is always balanced and the boundary output matches a
full render. The host packs the list after the id prefix (control bytes 44 to
47); without it, none of this runs.

An edit, a changed `incomplete` or `allowedHtml` option, a BOM at the boundary,
or a link or footnote definition resets the session. Definitions can change
earlier output, so those documents always render in full.

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
  each code block in slots: the language and meta, the markup before `<code>`,
  the `<code>` tag, and the escaped code, each after a NUL. The output holds no
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

For inline islands the host sends a length-prefixed list of opted-in names. The
inline scanner and the completion pass use the same directive boundaries, so
incomplete-Markdown repair cannot turn part of a label into a link. The
formatter receives escaped label and attribute spans, checks the island’s
payload, and emits inline portal targets inside the surrounding paragraph.

With an island registry, Wasm passes fences whose language starts with `island-`
to the host formatter. Ordinary closed fences stay in Wasm unless a plugin or
filter needs their contents. For an accepted island, the formatter emits a
portal target and text fallback. The DOM patcher keeps the hosts in committed
blocks and looks for new hosts only in patched blocks whose HTML contains an
island. When an edit moves an island, the patcher preserves its portal target by
id so the React component retains its state and context.

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
  completion repairs, 4,096 bytes shared by the escaped id prefix, the packed
  `allowedHtml` list, and inline island registry, 32 open allowed elements, and
  1,073,414,144 bytes (2^30 − 320 KiB) of input.
- A table closes after a row takes it past 524,288 auto-filled cells, matching
  cmark-gfm. Later lines parse as normal Markdown. Supplied cells do not count
  toward this limit.
