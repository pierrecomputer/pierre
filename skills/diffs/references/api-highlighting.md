# Highlighting API

`preferredHighlighter` selects `'shiki-js'` (default), `'shiki-wasm'`, or
`'highlights'`. Backends load lazily and have separate shared instances and
theme caches. File, FileDiff, Editor, FileStream, SSR preload options, and
worker highlighter options accept this selection.

## Shared highlighter

```ts
import { getSharedHighlighter } from '@pierre/diffs';

const highlighter = await getSharedHighlighter({
  preferredHighlighter: 'highlights',
  themes: ['pierre-dark'],
  langs: ['typescript'],
});
const html = highlighter.codeToHtml('const value = 1;', {
  lang: 'typescript',
  theme: 'pierre-dark',
});
```

`DiffsHighlighter` owns `name`, `themeResolver`, `getTheme`, `codeToHtml`,
`codeToTokens`, `createLiveTokenizer`, `createStreamTokenizer`, and `dispose`.
Shiki implementations also expose optional `loadLanguages`,
`hasLoadedLanguages`, and `attachLanguages` methods. Import backend-specific
Shiki APIs and types from `shiki` directly.

| Export                                                             | Purpose                                                                                                                 |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| `getSharedHighlighter`                                             | Gets or creates the selected backend and loads themes/languages.                                                        |
| `preloadHighlighter`                                               | Loads the same settings before a render.                                                                                |
| `getHighlighterIfLoaded`                                           | Gets a loaded instance when its requested settings are available.                                                       |
| `isHighlighterLoaded`, `isHighlighterLoading`, `isHighlighterNull` | Inspect a backend's cached state; pass a backend name (default `'shiki-js'`).                                           |
| `disposeHighlighter`                                               | Disposes shared instances and clears resolved caches; retained `createHighlighter` instances keep the themes they used. |
| `getHighlighterOptions`                                            | Converts component options to highlighter input.                                                                        |
| `getHighlighterThemeStyles`                                        | Creates component CSS from a loaded theme.                                                                              |
| `getThemes`                                                        | Converts a theme name or light/dark pair to a name list.                                                                |

## Themes

`DiffsTheme` contains `name`, `type`, `fg`, `bg`, optional editor `colors`, and
backend syntax data: `textmate` for Shiki and `zed` for Highlights. Bundled
Pierre and Shiki theme names also resolve to bundled Highlights palettes.

| Export                                                                | Purpose                                                                                                         |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `registerCustomTheme(name, loader, type = 'textmate')`                | Registers a loader with type `'textmate'` for Shiki or `'zed'` for Highlights.                                  |
| `createCSSVariablesTheme`                                             | Creates a portable palette; accepts name, variablePrefix (default `--diffs-`), variableDefaults, and fontStyle. |
| `registerCustomCSSVariableTheme`                                      | Preserves `(name, variableDefaults, fontStyle = false)` and the `--diffs-` prefix.                              |
| `resolveTheme`, `resolveThemes`                                       | Resolve themes; optional second argument selects the backend.                                                   |
| `getResolvedOrResolveTheme`, `getResolvedThemes`, `hasResolvedThemes` | Read or populate the selected backend's cache.                                                                  |
| `attachResolvedThemes`                                                | Seeds resolved themes into a highlighter, including worker instances.                                           |
| `areThemesAttached`                                                   | Checks cached themes; optionally takes a backend name or highlighter.                                           |
| `cleanUpResolvedThemes`                                               | Clears caches, preserving registrations.                                                                        |

`createCSSVariablesTheme` previously re-exported Shiki's
`createCssVariablesTheme`, whose default prefix is `--shiki-` and whose result
is a raw Shiki registration. Pass `variablePrefix: '--shiki-'` to keep
stylesheets written for that default, or import Shiki's helper directly when a
raw registration is needed.

Loaders return a theme directly or as a module's `default` export. Zed themes
use the registered name instead of their display name and require
`preferredHighlighter: 'highlights'`. A `ThemeFamily` uses its first member;
return `family.themes[index]` from the loader to select another. Raw Zed themes
cannot resolve on Shiki.

Theme resolution returns portable `DiffsTheme` objects. Resolve on the main
thread before passing them to workers. Register one loader per name. Raw
TextMate themes require Shiki. For one theme across backends, use
`createCSSVariablesTheme` or a `DiffsTheme` containing both `textmate` (Shiki's
normalized `ThemeRegistrationResolved`) and `zed` palettes.

## Languages

`registerCustomLanguage(name, loader, extensions?)` registers TextMate grammars
for Shiki. Highlights includes its supported lexers and ignores custom grammar
registrations. Explicit unknown languages fall back to plain text in Highlights.

`resolveLanguage(s)`, `getResolvedLanguages`, `hasResolvedLanguages`,
`getResolvedOrResolveLanguage`, `attachResolvedLanguages`,
`areLanguagesAttached`, and `cleanUpResolvedLanguages` support Shiki grammar
loading. Language loader/cache maps remain available for compatibility.

## Rendering and streams

`renderFileWithHighlighter` and `renderDiffWithHighlighter` create component
syntax trees from backend-independent tokens.

Use `highlighter.createStreamTokenizer(options)` for incremental append-only
input and `highlighter.createLiveTokenizer(options)` for document editing.
`FileStream` connects a readable code stream through `setup(source, wrapper)`,
accepts `preferredHighlighter`, supports `setThemeType`, and releases its stream
through `cleanUp()`.
