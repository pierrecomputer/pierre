# Stream Markdown

Keep the full source string and pass it on each update. If a transport supplies
UTF-8 byte chunks, use one `TextDecoder` with `{ stream: true }` and flush it at
the end so a character can span chunks.

## Streaming UI

Use [Markdown](react.md) or [the DOM renderer](html.md#update-a-dom-container)
to reuse completed nodes across updates. For `createHtmlRenderer().render()` or
`createDomRenderer().update()`, `incomplete` enables syntax repair and `active`
enables stream behavior. They are separate flags. For example, if the app
disables repair, pass `false, true` while text arrives. On the final update,
pass `false, false`. React derives both flags from its props.

Repair can complete unfinished emphasis, code, and links for display and hide
unfinished images. It leaves the source string intact. An incomplete link can
have `data-markdown-incomplete` in place of a destination.

## Read incremental HTML yourself

Use `createHtmlSession()` for parsing without UI or formatting plugins. The
session omits raw HTML, except tags listed in `allowedHtml`, or shows it as
escaped text with `escapeHtml: true`. Sanitize its output before using it to
display untrusted Markdown, since Markdown URLs pass through it.
`render(source, options)` takes a string only, and `incomplete`, `math`, `cjk`,
`allowedHtml`, and `escapeHtml` options.

```ts
import { createHtmlSession } from '@pierre/words';

const session = createHtmlSession();
let source = 'First paragraph.\n\n**Sec';
const partial = session.render(source, { incomplete: true });

source += 'ond paragraph.**';
const final = session.render(source, { incomplete: false });
```

The session returns owned strings. Keep the instance between updates to reuse
completed blocks. Edits, option changes, or a link or footnote definition can
require a reparse. The formatted HTML renderer exposes these same update fields.

| Field      | Meaning                                                |
| ---------- | ------------------------------------------------------ |
| `html`     | Full `stable + pending` HTML, assembled on first read. |
| `stable`   | Completed blocks.                                      |
| `addition` | HTML completed since the previous revision.            |
| `pending`  | The tail that can still change.                        |
| `reset`    | Invalidate the previously completed prefix.            |
| `revision` | Output version for this renderer or session.           |

The same source and options return the same result and revision. For a custom
incremental consumer, skip a revision you already applied. On first use, a
reset, or a gap in revisions, replace the completed HTML with `stable`.
Otherwise, append `addition` once. Replace the pending HTML with `pending` on
each changed revision. Read `html` instead when you need the full result.
