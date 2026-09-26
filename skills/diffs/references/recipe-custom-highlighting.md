# Recipe: register custom highlighting

Register themes before a surface loads them with
`registerCustomTheme(name, loader, type = 'textmate')`. Use `'textmate'` for
Shiki and `'zed'` for Highlights. Loaders accept a TextMate theme, a
Zed-compatible `Theme` or `ThemeFamily`, or a portable `DiffsTheme`, directly or
as a module's `default` export.

For a Zed-compatible theme:

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

The registered name replaces the Zed theme's display name. A theme family uses
its first member; return `family.themes[index]` from the loader to select
another. Raw Zed themes require Highlights and cannot be loaded by Shiki.

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

Register one loader per name and type. The same name can have separate TextMate
and Zed loaders. For a palette that works across backends:

```ts
import { registerCustomCSSVariableTheme } from '@pierre/diffs';

registerCustomCSSVariableTheme('app-palette', {
  foreground: '#eeeeee',
  background: '#101010',
  'token-keyword': '#c084fc',
  'token-string-expression': '#86efac',
});
```

This retains the `--diffs-*` variables on every backend, including defaults and
optional font styles. `createCSSVariablesTheme(options)` returns a portable
`DiffsTheme` for use with `registerCustomTheme` or application theme catalogs.
Register a portable theme's loader for both `'textmate'` and `'zed'` to use both
palettes; `registerCustomCSSVariableTheme` does this automatically.
