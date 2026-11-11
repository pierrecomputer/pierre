# React

Install React if the app does not already supply it. Import the component from
the React entry point and import the stylesheet once:

```tsx
import { Markdown } from '@pierre/words/react';
import '@pierre/words/styles.css';

<Markdown isAnimating={status === 'streaming'} animated caret="block">
  {message.text}
</Markdown>;
```

`message.text` is the full accumulated source. Keep the component mounted
between updates. Set `isAnimating` to `false` when the stream ends.

| Prop                                 | Default                  | Effect                                                                |
| ------------------------------------ | ------------------------ | --------------------------------------------------------------------- |
| `children`                           | `''`                     | Full Markdown string                                                  |
| `mode`                               | `'streaming'`            | Use `'static'` to disable stream state and repair                     |
| `isAnimating`                        | `false`                  | Mark the stream active                                                |
| `parseIncompleteMarkdown`            | `true`                   | Repair incomplete syntax while active                                 |
| `animated`                           | `false`                  | Fade new text with `true` or `{ animation: 'fadeIn', duration: 180 }` |
| `caret`                              | None                     | Show a `'block'` or `'circle'` caret while active                     |
| `onAnimationStart`, `onAnimationEnd` | None                     | Callbacks for the active stream lifecycle                             |
| `idPrefix`                           | Unique React id plus `-` | Prefix generated footnote ids and their links                         |

Fades and the caret need `@pierre/words/styles.css`. Fades run only during an
active stream. Reduced motion and a zero duration disable fades. The callbacks
describe stream state, not individual CSS animations.

The component accepts ordinary div attributes, such as `className`, and the
shared [HTML options](html.md#shared-options). Code controls and line numbers
are on by default. React owns the outer div, and the DOM renderer owns its
Markdown children. Do not edit those child nodes from another renderer.

## Hooks and code plugins

```tsx
import { Markdown } from '@pierre/words/react';
import { createHighlightsPlugin } from '@pierre/words/highlights';
import pierreLight from '@pierre/highlights/themes/pierre-light';

const plugins = { code: createHighlightsPlugin({ theme: pierreLight }) };
const components = {
  a: (html: string) => html.replace('<a ', '<a class="message-link" '),
};

<Markdown plugins={plugins} components={components}>
  {message.text}
</Markdown>;
```

Install `@pierre/highlights` for the code plugin. Keep the plugin instance
stable, outside the component or in a memo for its theme options.

Hooks accept and return HTML strings. They do not accept React component props
or return JSX. Use the `inlineCode` hook for inline code. See
[HTML and plugins](html.md) for URL policy, element filters, and custom fences.

## Server output

`Markdown` produces HTML on the server and reuses that HTML during hydration.
Use the same source and options on the server and client. A custom `idPrefix`
must be stable across hydration and unique among Markdown documents on the same
page. The component manages DOM listeners and code session cleanup.
