# Streaming

All Words update APIs accept the full accumulated Markdown string. They do not
accept a `ReadableStream` or append individual chunks. Decode byte chunks with a
persistent `TextDecoder` and `{ stream: true }` so UTF-8 characters can cross
chunk boundaries.

## Core HTML sessions

```ts
import { createHtmlSession } from '@pierre/words';

const session = createHtmlSession();
let source = 'First paragraph.\n\n**Sec';
const first = session.render(source, { incomplete: true });

source += 'ond paragraph.**';
const next = session.render(source, { incomplete: true });
const final = session.render(source, { incomplete: false });
```

Keep the session between updates. Create a separate session for each document.
It returns owned HTML strings and needs no `dispose()` call.

| `HtmlUpdate` field | Meaning                                          |
| ------------------ | ------------------------------------------------ |
| `html`             | Full HTML, built on first read                   |
| `stable`           | HTML of completed blocks                         |
| `addition`         | HTML completed since the preceding revision      |
| `pending`          | HTML that can still change                       |
| `reset`            | The previous completed prefix is no longer valid |
| `revision`         | Output version                                   |

`html` equals `stable + pending`. For a custom incremental consumer, replace the
`pending` part on each changed revision. Append `addition` only for a
consecutive revision without `reset`. On reset or a skipped revision, use
`stable` for the completed prefix. Identical source and options return the same
result and revision. Do not append `addition` twice for that result.

Sessions omit raw HTML, but they do not filter URL schemes. Use
[`createHtmlRenderer()` or `createDomRenderer()`](html.md) for page output with
URL checks, code controls, and hooks.

## Completion and reuse

`incomplete: true` repairs a display copy of common unfinished emphasis, code,
and links. It hides unfinished images and does not change the source. A
unfinished link has `data-markdown-incomplete` instead of a destination.
Sessions mark an open code fence with `data-markdown-incomplete` even when
repair is off.

Appended text can reuse completed top-level blocks. An edit, a change to
`incomplete`, or a link or footnote definition can require a full render. A long
open paragraph still requires a parse on each update.

## UI streams

React uses `isAnimating` for active state. The HTML and DOM APIs accept separate
`incomplete` and `active` arguments. For an HTML renderer:

```ts
renderer.render(source, true, true);
renderer.render(source, false, false);
```

For a DOM renderer, use `update()` with the same arguments.

Use `incomplete = active && parseIncompleteMarkdown` when the app has a repair
option. Active state controls the live code highlighter and stream UI.
Completion controls Markdown repair. Set both to `false` when the stream ends or
is canceled. An unfinished final marker then renders as ordinary Markdown.
