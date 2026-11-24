# React

Use `Markdown` with a string in `children`. Import the stylesheet once for code
controls, diagrams, fades, and the caret.

```tsx
import { Markdown } from '@pierre/words/react';
import '@pierre/words/styles.css';

export function Message({ text, active }: { text: string; active: boolean }) {
  return (
    <Markdown isAnimating={active} animated caret="block">
      {text}
    </Markdown>
  );
}
```

Pass the full accumulated text and keep the component mounted for the same
message. Set `isAnimating` to `false` when the stream ends or is canceled. Use
`mode="static"` for a document that never streams. Static mode ignores
`isAnimating`.

| Prop                                 | Behavior                                                                                                    |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| `mode`                               | Defaults to `'streaming'`.                                                                                  |
| `isAnimating`                        | Marks a stream active. Defaults to `false`.                                                                 |
| `parseIncompleteMarkdown`            | Repairs common unfinished syntax while active. Defaults to `true`.                                          |
| `animated`                           | Fades new text while active. Defaults to `false`. Use `true` or `{ animation: 'fadeIn', duration: 180 }`.   |
| `caret`                              | Shows a `'block'` or `'circle'` caret while active.                                                         |
| `onAnimationStart`, `onAnimationEnd` | Run when the stream becomes active or stops. The end callback also runs on unmount during an active stream. |

Reduced motion and a zero duration disable fades. Standard `div` props such as
`className` go on the outer element. Words owns the Markdown nodes inside it.

## Server output and options

The component produces HTML on the server and reuses it during hydration. Keep
the first source and renderer options consistent between server and client.
React supplies a unique footnote `idPrefix` by default. If you set it yourself,
use a stable prefix per document.

Pass [HTML options](html.md#shared-options) as props. Read
[Extensions](extensions.md) for `math`, `cjk`, and code plugins. In a React
Server Components app, define hooks and create plugins in a client component or
in a module it imports.

Replacing a hook under the same tag name or replacing an existing `urlTransform`
can leave completed output in place. Remount `Markdown` with a new `key` when a
changed policy must apply to the entire document.

## Reactive islands

Pass an `islands` registry to mount React components from fenced blocks. The
fence language is `island-NAME`, and the body is a JSON object with a nonempty
string `id`. Keep the id stable and unique in the document so the component
keeps its state across updates. A repeated id shows its fallback.

````md
```island-counter
{"id":"article-votes","label":"Votes"}
```
````

```tsx
import { Markdown, type ReactiveIslands } from '@pierre/words/react';

const islands: ReactiveIslands = {
  counter: {
    fallback: 'Loading counter…',
    pending: { className: 'counter-skeleton', label: 'Loading counter' },
    render: ({ label }) =>
      typeof label === 'string' ? <Counter label={label} /> : null,
  },
};

<Markdown islands={islands} isAnimating={active}>
  {text}
</Markdown>;
```

- `render(data)` is a pure factory. It validates `data` and returns an element,
  or `null` to show the source as code. Put hooks in the returned component.
- A closed fence shows `fallback` on the server and mounts on the client while
  the stream continues. An open fence is hidden while it streams unless
  `pending` is set to text or `{ className, label? }`.
- An invalid payload or an unregistered name renders as code.
- `inline: true` also accepts `:name[label]{key="value"}` in prose. The
  component gets `data.label` and string attributes, and must return phrasing
  content. Without an explicit `id`, Words derives one from the directive.
  Inline names share the 4,096-byte `idPrefix` limit.
