---
name: highlights
description:
  Use when an app uses @pierre/highlights to generate syntax-highlighted HTML or
  tokens, stream code, incrementally tokenize edits, or apply Zed-compatible
  themes and CSS variables.
---

# `@pierre/highlights`

Use `@pierre/highlights` for standalone syntax highlighting with built-in
WebAssembly lexers. Choose HTML for a complete code block, tokens for a custom
renderer, `StreamTokenizer` for append-only input, or `LiveTokenizer` for an
editable document.

## Install

```bash
pnpm add @pierre/highlights
```

Import `createHighlighter` from `@pierre/highlights`, select language modules
from `@pierre/highlights/langs/*`, and supply theme objects. Await the factory
once. Its output methods then run synchronously. The core entry imports no
language or theme bundle. Use the combined `langs` export from
`@pierre/highlights/langs` when the application needs all languages.

Import shared output functions, `StreamTokenizer`, and `LiveTokenizer` from
`@pierre/highlights/full`. This entry initializes the shared WebAssembly module
at import. `createHighlighter` requires `{ langs, themes }` and returns a
promise through either entry. Do not pass a Wasm module or omit the options.

## Select a reference

| Task                                                                       | Reference                                 |
| -------------------------------------------------------------------------- | ----------------------------------------- |
| Generate HTML or tokens, validate a language, or manage a Wasm module      | [Rendering](references/rendering.md)      |
| Load or customize themes, switch CSS variables, or render multiple schemes | [Themes](references/themes.md)            |
| Tokenize streamed strings or bytes                                         | [Streaming](references/streaming.md)      |
| Apply edits, prioritize a viewport, or read packed token records           | [Incremental editing](references/live.md) |

For file, diff, or editor components, read the [diffs skill](../diffs/SKILL.md).
