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
