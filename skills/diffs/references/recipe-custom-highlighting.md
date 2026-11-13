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

Set `file.lang` and `options.theme` to the registered names. TextMate grammars
apply to Shiki. For Highlights, build a lexer with `buildHighlightsLexer` from
`@pierre/wat-tools` at build time and save it as the default export of a module.
Register that module with the `'highlights'` type; the lexer's `aliases` must
include the registered name:

```ts
registerCustomLanguage(
  'my-language',
  () => import('./my-language.highlights.js'),
  ['myext'],
  'highlights'
);
```

Highlights uses registered lexers for rendered code. Its stream and editor
tokenizers use built-in lexers only. A registered name replaces a built-in lexer
with the same name on the whole page.

To use a built-in lexer under another name, add the name to a copy of its
module:

```ts
registerCustomLanguage(
  'my-json',
  async () => {
    const { default: json } = await import('@pierre/highlights/langs/json');
    return {
      default: {
        ...json,
        aliases: { ...json.aliases, 'my-json': json.aliases.json },
      },
    };
  },
  ['myjson'],
  'highlights'
);
```

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
