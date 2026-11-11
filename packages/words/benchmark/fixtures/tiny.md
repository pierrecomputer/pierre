# @wat-labs/md

A GitHub Flavored Markdown renderer written **by hand** in WebAssembly Text.
Everything on this page is rendered by ~65 KB of Wasm, in *one* pass over
linear memory.

## What it supports

- [x] CommonMark 0.31.2, all 642 examples
- [x] Tables, task lists, strikethrough, autolinks
- [x] Footnotes[^why] and YAML frontmatter
- [ ] Anything that needs an AST

[^why]: Not in the GFM specification, but GitHub renders them, so we do too.

## Inline

Emphasis is *italic*, **bold**, ***both***, and ~~struck through~~.
Code spans keep `their <em>markup</em>` literal, and links can be
[inline](https://github.com/wat-labs/md "the repository"), [collapsed][] or
bare: https://github.com/wat-labs/md.

[collapsed]: https://github.com/wat-labs/md

## Blocks

> Block quotes nest, and a lazy continuation
line still belongs to the paragraph above.
>
> 1. Ordered lists
> 2. keep their numbers
>    - and their nesting

```js
import { renderToHtml, renderToAnsi } from "@wat-labs/md";

const html = renderToHtml("# Hello, **world**!");
const ansi = renderToAnsi("# Hello, **world**!");
```

| Backend | Output | Throughput |
| ------- | :----- | ---------: |
| HTML    | `<h1>` and friends | 254 MB/s |
| ANSI    | SGR escapes for a terminal | 231 MB/s |

---

Entities work too: &copy; &amp; &#x1F49A; &nbsp;— and so do hard breaks,\
like that one.
