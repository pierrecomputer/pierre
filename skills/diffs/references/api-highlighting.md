# Highlighting API

`preferredHighlighter` selects `'shiki-js'` (default), `'shiki-wasm'`, or
`'highlights'`. Backends load lazily. File, FileDiff, Editor, FileStream, SSR
preload options, and worker highlighter options accept this selection.

Only one backend type can be loaded per JavaScript realm (page, worker, or SSR
process). Requests without `preferredHighlighter` use the loaded type, else
`'shiki-js'`. Requesting another type throws until every instance of the loaded
type, shared or from `createHighlighter`, is disposed. `getHighlighterType()`
returns the loaded type.

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

`DiffsHighlighter` is an abstract class with `name`, `themeResolver`,
`getTheme`, `codeToHtml`, `codeToTokens`, `createEditorTokenizer`,
`createStreamTokenizer`, `loadLanguages`, `hasLoadedLanguages`,
`attachLanguages`, and `dispose`. Highlights bundles its lexers, so its language
methods do nothing and `hasLoadedLanguages` is true until disposal. Import
backend-specific Shiki APIs and types from `shiki` directly.

| Export                                                             | Purpose                                                                                                            |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| `getSharedHighlighter`                                             | Gets or creates the shared instance and loads themes/languages.                                                    |
| `createHighlighter`                                                | Creates an independently disposable instance: `createHighlighter('highlights')`.                                   |
| `getHighlighterType`                                               | Returns the backend type loaded in this realm, if any.                                                             |
| `preloadHighlighter`                                               | Loads the same settings before a render.                                                                           |
| `getHighlighterIfLoaded`                                           | Gets the loaded shared instance when its requested settings are available.                                         |
| `isHighlighterLoaded`, `isHighlighterLoading`, `isHighlighterNull` | Inspect shared state without arguments. Use `getHighlighterIfLoaded()` to obtain a ready instance.                 |
| `disposeHighlighter`                                               | Disposes the shared instance and clears resolved caches; retained `createHighlighter` instances keep their themes. |
| `getHighlighterOptions`                                            | Converts component options to highlighter input.                                                                   |
| `getHighlighterThemeStyles`                                        | Creates component CSS from a loaded theme.                                                                         |
| `getThemes`                                                        | Converts a theme name or light/dark pair to a name list.                                                           |

## Themes

`DiffsTheme` contains `name`, `type`, `fg`, `bg`, optional editor `colors`, and
backend syntax data: `textmate` for Shiki and `zed` for Highlights. Bundled
Pierre and Shiki theme names also resolve to bundled Highlights palettes.

| Export                                                                | Purpose                                                                                                         |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `registerCustomTheme(name, loader, type = 'textmate')`                | Registers a loader with type `'textmate'` for Shiki, `'zed'` for Highlights, or `'diffs'` for portable themes.  |
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

Loaders return a theme directly or as a module's `default` export. Register one
loader per name and type; explicit TextMate or Zed loaders take priority over a
shared Diffs loader. TextMate and Diffs names must match the registration. Zed
themes use the registered name instead of their display name; a `ThemeFamily`
uses its first member unless the loader selects another.

Resolve themes on the main thread before passing them to workers. For one theme
across backends, use `createCSSVariablesTheme` or a `DiffsTheme` containing both
`textmate` (Shiki's normalized `ThemeRegistrationResolved`) and `zed` palettes.

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
input and `highlighter.createEditorTokenizer(options)` for document editing.
`FileStream` connects a readable code stream through `setup(source, wrapper)`,
accepts `preferredHighlighter`, supports `setThemeType`, and releases its stream
through `cleanUp()`.
