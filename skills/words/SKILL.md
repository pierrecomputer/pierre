---
name: words
description:
  Use when an app uses @pierre/words to render Markdown as HTML or ANSI, display
  streamed Markdown in React or the DOM, customize generated HTML, or highlight
  fenced code with @pierre/highlights.
---

# `@pierre/words`

Use Words for CommonMark and GFM Markdown. Choose the core API for HTML or
terminal bytes, `Markdown` for React, or the HTML and DOM renderers for other
frameworks. Use one session or renderer per document that receives updates.

## Install

```bash
pnpm add @pierre/words
```

The package initializes WebAssembly on import in Node.js, browsers, and
Cloudflare Workers. Normal use needs no `init()` call. The core entry point has
no runtime dependencies. React and `@pierre/highlights` are optional peers.

## Select a reference

| Task                                                                 | Reference                              |
| -------------------------------------------------------------------- | -------------------------------------- |
| Render HTML or ANSI bytes, or extract YAML frontmatter               | [Core API](references/core.md)         |
| Update a Markdown document from a stream or consume incremental HTML | [Streaming](references/streaming.md)   |
| Use the React component, animation, or a caret                       | [React](references/react.md)           |
| Update the DOM, customize HTML, filter URLs, or highlight code       | [HTML and plugins](references/html.md) |

## Integration rules

- Decode or copy core output bytes before another render. The bytes share
  WebAssembly memory.
- Pass the full accumulated source on each update, not the latest chunk.
- Finish a stream with incomplete repair and active state set to `false`.
- Core HTML and sessions do not sanitize URLs. Use the formatted HTML, DOM, or
  React API for its URL checks and element filters.
- `components` hooks and plugins return HTML strings, not React elements. They
  are trusted code. Escape untrusted text that they add.
- Math, Mermaid, CJK extensions, and remark or rehype plugins are not built in.
  Use a custom code renderer when the app needs a special fence language.
