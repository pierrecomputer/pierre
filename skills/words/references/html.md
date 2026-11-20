# HTML and DOM

## Render an HTML string

`createHtmlRenderer(options?)` works with or without a browser. It applies URL
checks, element filters, hooks, and plugins before it returns HTML.

```ts
import { createHtmlRenderer } from '@pierre/words/html';

const renderer = createHtmlRenderer({ controls: false, idPrefix: 'article-' });
try {
  const html = renderer.render('# Hello', false).html;
} finally {
  renderer.dispose();
}
```

`render(source, incomplete, active = false)` requires the `incomplete` flag. Use
`false` for a complete document. For streaming, keep the same instance and
follow the [update protocol](streaming.md). Call `dispose()` to release any live
code highlighter. `configure(next, reset = true)` replaces all options and
clears cached output by default.

The stylesheet targets descendants of `[data-markdown="root"]`. Add that
attribute to your wrapper and import `@pierre/words/styles.css`. Use the DOM
renderer for interactive copy and download buttons.

## Update a DOM container

Given an `HTMLElement` named `root`:

```ts
import { createDomRenderer } from '@pierre/words/html';
import '@pierre/words/styles.css';

const renderer = createDomRenderer(root, { idPrefix: 'message-' });
renderer.connect();
renderer.update('Hello, **wor', true, true, { duration: 180 }, 'block');
renderer.update('Hello, **world**!', false, false);
```

`update(source, incomplete, active = false, animated = false, caret?)` patches
the container. The DOM renderer sets `data-markdown="root"`. `connect()`
attaches listeners for code controls and fades. Call `disconnect()` on unmount
to remove listeners and release the live highlighter.

`configure(next)` replaces the options. It compares option values to decide
whether to reformat completed blocks. A new hook under the same tag name or a
replacement `urlTransform` can apply only to later output. Recreate the renderer
when a new policy must apply to the entire document.

## Shared options

These options also work as `Markdown` props.

| Option                                  | Behavior                                                                                                                                                   |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `math`, `cjk`, `plugins`                | See [Extensions](extensions.md).                                                                                                                           |
| `components`                            | Map HTML tag names to HTML string transformations. Use `inlineCode` for inline code.                                                                       |
| `controls`                              | Code copy and download controls. Defaults to `true`. Accepts `false`, `{ code: false }`, or `{ code: { copy, download } }`.                                |
| `lineNumbers`                           | Defaults to `true`.                                                                                                                                        |
| `idPrefix`                              | Prefix for generated footnote IDs and links. Use a distinct prefix per document, up to 4096 UTF-8 bytes. React supplies one. HTML and DOM default to `''`. |
| `allowedElements`, `disallowedElements` | Set one list to keep or drop generated tags.                                                                                                               |
| `unwrapDisallowed`                      | Keep the children of excluded tags. Defaults to `false`.                                                                                                   |
| `urlTransform(url, key)`                | Transform a Markdown `href` or `src` before URL validation.                                                                                                |

## Hooks and URL policy

```ts
import { createHtmlRenderer } from '@pierre/words/html';

const renderer = createHtmlRenderer({
  controls: false,
  components: {
    a: (html) => html.replace('<a ', '<a class="message-link" '),
  },
  urlTransform: (url, key) => (key === 'src' ? null : url),
});
try {
  const { html } = renderer.render('[Guide](/docs)', false);
} finally {
  renderer.dispose();
}
```

Return `null` or `undefined` from `urlTransform` to drop a URL. Built-in
validation permits relative URLs and `http`, `https`, `ftp`, `mailto`, `tel`,
and `xmpp`. It rejects network paths such as `//host/path`. Invalid links lose
their destination. Images with a rejected URL disappear. External images are
allowed by default. Use `disallowedElements: ['img']` to remove all images.

Raw HTML from Markdown is dropped, except tags listed in `allowedHtml`.
Filtering applies to generated Markdown before hooks and plugins add their own
markup. Use `escapeHtml()` from `@pierre/words/html` for untrusted text inside a
hook's output. For custom URLs, use `defaultUrlTransform()` and HTML-escape the
validated attribute value. `defaultUrlTransform()` is also exported from
`@pierre/words/react`.
