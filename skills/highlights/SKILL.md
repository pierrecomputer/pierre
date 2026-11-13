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

`@pierre/highlights` contains all lexers in one Wasm module, initialized at
import, and all themes. Import shared output functions, `StreamTokenizer`, and
`LiveTokenizer` from it. `registerLanguages(langs)` adds custom lexers to its
shared output functions.

`@pierre/highlights/core` contains no lexers or themes. Import
`createHighlighter` from it, select language modules from
`@pierre/highlights/langs/*`, and supply theme objects. Await the factory once.
Its output methods then run synchronously. Use the combined `langs` export from
`@pierre/highlights/langs` when the application needs all languages.

Use the main entry by default. Use `/core` with selected modules when download
size matters. Embedded code and Markdown fences are plain text there until their
languages are in `langs`; see [Rendering](references/rendering.md).

## Select a reference

| Task                                                                       | Reference                                 |
| -------------------------------------------------------------------------- | ----------------------------------------- |
| Generate HTML or tokens, select or add languages, or manage a Wasm module  | [Rendering](references/rendering.md)      |
| Load or customize themes, switch CSS variables, or render multiple schemes | [Themes](references/themes.md)            |
| Tokenize streamed strings or bytes                                         | [Streaming](references/streaming.md)      |
| Apply edits, prioritize a viewport, or read packed token records           | [Incremental editing](references/live.md) |

For file, diff, or editor components, read the [diffs skill](../diffs/SKILL.md).
