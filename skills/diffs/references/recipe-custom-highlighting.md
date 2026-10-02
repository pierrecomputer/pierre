# Recipe: register custom highlighting

Register themes before rendering. For a Zed-compatible theme with Highlights:

```tsx
import { registerCustomTheme } from '@pierre/diffs';
import { FileDiff } from '@pierre/diffs/react';

registerCustomTheme('app-dark', () => import('./my-zed-theme.json'), 'zed');

<FileDiff
  oldFile={oldFile}
  newFile={newFile}
  options={{ theme: 'app-dark', preferredHighlighter: 'highlights' }}
/>;
```

For TextMate themes and custom grammars, use Shiki:

```ts
import { registerCustomLanguage, registerCustomTheme } from '@pierre/diffs';

registerCustomLanguage(
  'my-language',
  () => import('./my-language.tmLanguage.json'),
  ['myext']
);
registerCustomTheme('my-theme', () => import('./my-textmate-theme.json'));
```

Set `file.lang` and `options.theme` to the registered names. Custom languages
apply to Shiki; Highlights bundles its lexers and ignores custom grammars.

For a CSS palette that works across backends:

```ts
import { registerCustomCSSVariableTheme } from '@pierre/diffs';

registerCustomCSSVariableTheme('app-palette', {
  foreground: '#eeeeee',
  background: '#101010',
  'token-keyword': '#c084fc',
  'token-string-expression': '#86efac',
});
```

This registers a shared Diffs theme using `--diffs-*` variables. See
[Highlighting API](api-highlighting.md#themes) for loader formats, name
matching, and CSS palette options.
