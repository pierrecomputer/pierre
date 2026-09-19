# Recipe: register custom highlighting

Register a language or theme before the first surface uses it:

```ts
import { registerCustomLanguage, registerCustomTheme } from '@pierre/diffs';

registerCustomLanguage(
  'my-language',
  () => import('./my-language.tmLanguage.json'),
  ['myext']
);

registerCustomTheme('my-theme', () => import('./my-theme.json'), 'textmate');
```

Set `file.lang` to the custom language name. Set `options.theme` to the custom
theme name.

The language loader returns a module whose default export is an array of Shiki
grammars; one grammar must declare the registered name as its `name` or an
alias. Both Shiki backends load the grammar on demand. The Highlights backend
uses its built-in lexers and ignores custom grammars.

Themes are registered per format. Pass `'textmate'` for `'shiki-wasm'` and
`'shiki-js'`, or `'zed'` for `'highlights'`. Omit the format to register one
loader for every backend when its result matches each backend's format. To
support both Shiki and Highlights under one name, register a loader per format:

```ts
import { registerCustomTheme } from '@pierre/diffs';
import type { Theme } from '@pierre/highlights';

const zedTheme: Theme = {
  name: 'my-theme',
  appearance: 'dark',
  style: {
    'editor.background': '#181818',
    'editor.foreground': '#eeeeee',
    syntax: { keyword: { color: '#ff88aa' } },
  },
};

registerCustomTheme('my-theme', () => import('./my-theme.json'), 'textmate');
registerCustomTheme('my-theme', async () => zedTheme, 'zed');
```

Select the backend with `preferredHighlighter` in the same options object as
`theme`. Bundled theme names such as `pierre-dark` resolve in every backend.
