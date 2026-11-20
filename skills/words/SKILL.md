---
name: words
description:
  Use when integrating @pierre/words to render or stream Markdown in React, in
  the DOM, as HTML, or in a terminal.
---

# `@pierre/words`

Words supports CommonMark, GFM, and footnotes. Install `@pierre/words` with the
app's package manager. The package initializes WebAssembly on import. Install
React for the React entry point, `@pierre/highlights` for syntax colors, or
`pele` for Mermaid diagrams as needed.

## Choose an API

| Task                                                               | API and import                                                        | Reference                              |
| ------------------------------------------------------------------ | --------------------------------------------------------------------- | -------------------------------------- |
| Render Markdown in React                                           | `Markdown` from `@pierre/words/react`                                 | [React](references/react.md)           |
| Generate HTML strings with URL checks or patch an existing element | `createHtmlRenderer` or `createDomRenderer` from `@pierre/words/html` | [HTML and DOM](references/html.md)     |
| Generate UTF-8 HTML or ANSI bytes, or read YAML frontmatter        | `renderToHtml` or `renderToAnsi` from `@pierre/words`                 | [Core](references/core.md)             |
| Consume completed and pending HTML yourself                        | `createHtmlSession` from `@pierre/words`                              | [Streaming](references/streaming.md)   |
| Add math, CJK emphasis, Mermaid, syntax colors, or custom fences   | Parser options or renderer plugins                                    | [Extensions](references/extensions.md) |

Use one renderer or session per document that receives updates. Pass the full
accumulated Markdown string each time. See [Streaming](references/streaming.md)
for final updates and incremental results.

Prefer the React, HTML, or DOM renderer for untrusted Markdown in a page. These
omit raw HTML, except tags listed in `allowedHtml`, and check Markdown URLs.
Core HTML and core sessions require an application sanitizer for that use. Treat
hooks and plugin output as trusted HTML and escape any untrusted text they
insert.
