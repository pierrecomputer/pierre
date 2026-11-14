# HTML and plugins

## HTML strings

```ts
import { createHtmlRenderer } from '@pierre/words/html';

const renderer = createHtmlRenderer({ controls: false, idPrefix: 'article-' });
try {
  const html = renderer.render('# Hello', false).html;
} finally {
  renderer.dispose();
}
```

`render(source, incomplete, active = false)` returns the incremental fields from
[`HtmlUpdate`](streaming.md#core-html-sessions), plus code patch data for the
DOM renderer. Keep the renderer for later updates to the same document. Call
`dispose()` when done to release any live code highlighter.

`configure(options)` replaces options and clears formatted caches by default.
Use it when options must apply to previous output. The second argument,
`reset = true`, controls that cache reset.

## DOM updates

Given an `HTMLElement` named `root`:

```ts
import { createDomRenderer } from '@pierre/words/html';
import '@pierre/words/styles.css';

const renderer = createDomRenderer(root, { idPrefix: 'message-' });
renderer.connect();
renderer.update('Hello, **wor', true, true, { duration: 180 }, 'block');
renderer.update('Hello, **world**!', false, false);
```

The method signature is
`update(source, incomplete, active = false, animated = false, caret?)`. The
renderer patches current nodes and adds the `data-markdown="root"` attribute.
Call `disconnect()` when the host unmounts to remove listeners and release the
code session. `connect()` enables code copy/download controls and animation
listeners.

`configure(options)` replaces DOM renderer options. It compares option values to
avoid unnecessary work. A new hook function with the same hook name, or a
replacement `urlTransform`, applies to later output without a full reformat.
Recreate the renderer when a changed policy must affect the entire document.

## Shared options

These options apply to `Markdown`, `createHtmlRenderer()`, and
`createDomRenderer()`:

| Option                   | Effect                                                                                                  |
| ------------------------ | ------------------------------------------------------------------------------------------------------- |
| `components`             | Map from HTML tag names to HTML string hooks. `inlineCode` targets inline code                          |
| `plugins.code`           | Code highlighter plugin                                                                                 |
| `plugins.renderers`      | Custom fence renderers, selected by language                                                            |
| `controls`               | Code copy/download buttons. Default `true`. Accepts `{ code: { copy, download } }` or `{ code: false }` |
| `lineNumbers`            | Code line numbers. Default `true`                                                                       |
| `allowedElements`        | Keep only these generated Markdown tags                                                                 |
| `disallowedElements`     | Remove these generated Markdown tags                                                                    |
| `unwrapDisallowed`       | Keep children when an excluded element is removed                                                       |
| `urlTransform(url, key)` | Transform `href` or `src` before built-in URL validation                                                |
| `idPrefix`               | Prefix generated ids and footnote links. Default `''` outside React                                     |

Use only one of `allowedElements` and `disallowedElements`. These filters apply
to Markdown output before hooks and plugins. They do not validate markup that a
hook or plugin adds.

Raw HTML from Markdown is omitted. URL validation permits relative URLs and
`http`, `https`, `ftp`, `mailto`, `tel`, and `xmpp`. It rejects network paths
such as `//host/path` and unsafe schemes. A custom `urlTransform` cannot bypass
that check. Return `null` or `undefined` to remove a URL.

The renderer allows external images by default. To omit all Markdown images, use
`disallowedElements: ['img']`. To reject image URLs only, return `undefined`
when the transform receives `key === 'src'`.

Hooks and plugins are trusted code. Use the exported `escapeHtml()` for any
untrusted text that they insert. The exported `defaultUrlTransform()` exposes
the built-in URL check. It is also available from `@pierre/words/react`.

## Highlights plugin

```ts
import { createHtmlRenderer } from '@pierre/words/html';
import { createHighlightsPlugin } from '@pierre/words/highlights';
import pierreLight from '@pierre/highlights/themes/pierre-light';

const plugins = { code: createHighlightsPlugin({ theme: pierreLight }) };
const renderer = createHtmlRenderer({ plugins });
try {
  const html = renderer.render('~~~ts\nconst answer = 42;\n~~~', false).html;
} finally {
  renderer.dispose();
}
```

Install `@pierre/highlights` separately. Create one plugin for stable theme
options. The plugin accepts Highlights HTML options except `lang`, which comes
from the fence. Unknown languages use plain text. An active open fence uses a
live tokenizer that the renderer releases when no longer needed.

The plugin uses the main `@pierre/highlights` entry, which loads all built-in
lexers. To add a language, call `registerLanguages([lexer])` from
`@pierre/highlights` with a lexer from `@pierre/wat-tools`. An open fence in
such a language renders again in full on each update.

Use [Highlights themes](https://diffs.com/docs#highlights-themes) for theme
objects, multiple themes, and CSS variable colors. These themes use the
Highlights format, not `@pierre/theme` objects.

## Custom fences and highlighters

```ts
import { escapeHtml } from '@pierre/words/html';
import type { PluginConfig } from '@pierre/words/html';

const plugins: PluginConfig = {
  renderers: [
    {
      language: ['note', 'aside'],
      render: ({ code }) => `<aside>${escapeHtml(code)}</aside>`,
    },
  ],
};
```

The first custom renderer that matches the language replaces the entire code
block and takes precedence over `plugins.code`. It receives
`{ code, language, isIncomplete }` and returns an HTML string.

A custom `CodeHighlighterPlugin` implements `highlight(options)` with the same
input. Return escaped HTML for the inside of `<code>`, or `null` for plain text.
Do not return a `<pre>` wrapper. The optional `createSession()` supplies a live
highlighter with `highlight()` and `dispose()`. Its optional `highlightLines()`
returns `CodeHighlightUpdate` for changed-line output. Use the public types from
`@pierre/words/html` for this advanced integration.
