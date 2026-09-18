# Highlighting API

This reference lists every highlighter backend, shared highlighter, theme,
language, render, and stream export from `@pierre/diffs`.

## Contents

- [Highlighter backends](#highlighter-backends)
- [Shared highlighter APIs](#shared-highlighter-apis)
- [Theme APIs](#theme-apis)
- [Language APIs](#language-apis)
- [`DiffsHighlighter` members](#diffshighlighter-members)
- [Render APIs](#render-apis)
- [Stream APIs](#stream-apis)

## Highlighter backends

`preferredHighlighter` in file, diff, editor, or worker pool options selects one
backend. Each backend loads on demand from its own entry, and the package keeps
one shared instance per backend.

| Name           | Entry                                  | Engine                                                |
| -------------- | -------------------------------------- | ----------------------------------------------------- |
| `'shiki-wasm'` | `@pierre/diffs/highlighter/shiki-wasm` | Shiki with the Oniguruma WebAssembly engine. Default. |
| `'shiki-js'`   | `@pierre/diffs/highlighter/shiki-js`   | Shiki with the JavaScript regex engine.               |
| `'highlights'` | `@pierre/diffs/highlighter/highlights` | `@pierre/highlights` WebAssembly lexers.              |

Each entry exports
`createDiffsHighlighter(customThemeLoaders?, customLanguageLoaders?)`, which
returns a `DiffsHighlighter`. The Shiki backends load bundled and registered
grammars on demand and take TextMate themes. The Highlights backend bundles its
languages, ignores `langs` and custom grammar loaders, tokenizes unsupported
languages as `text`, and takes Zed themes.

| Export               | Kind     | Purpose                                          |
| -------------------- | -------- | ------------------------------------------------ |
| `defaultHighlighter` | Constant | Names the default backend, `'shiki-wasm'`.       |
| `highlighters`       | Object   | Maps each backend name to its lazy entry import. |
| `bundledThemeNames`  | Array    | Lists the theme names bundled by every backend.  |
| `BundledTheme`       | Type     | Names one bundled theme.                         |

## Shared highlighter APIs

| Export                                                               | Purpose                                                                                                 |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `getSharedHighlighter({ themes, langs?, preferredHighlighter? })`    | Gets or creates the backend's shared instance, then resolves the themes and loads the languages.        |
| `preloadHighlighter(options)`                                        | Loads a backend with its themes and languages before a render; takes the same options.                  |
| `getHighlighterIfLoaded({ theme?, langs?, preferredHighlighter? }?)` | Gets a loaded backend synchronously when the requested themes and languages are ready; starts no loads. |
| `isHighlighterLoaded(value?)`                                        | Tests a cache value for a loaded instance; defaults to the `'shiki-wasm'` entry.                        |
| `isHighlighterLoading(value?)`                                       | Tests a cache value for an active initialization promise.                                               |
| `isHighlighterNull(value?)`                                          | Tests a cache value for an empty state.                                                                 |
| `disposeHighlighter()`                                               | Clears every cached backend so the next request creates a fresh instance; registrations remain.         |
| `getHighlighterOptions(options)`                                     | Selects theme names and the preferred backend from component options.                                   |
| `getHighlighterThemeStyles({ theme, highlighter, prefix? })`         | Creates theme CSS from a loaded highlighter.                                                            |
| `getThemes(theme)`                                                   | Converts one theme or light/dark pair to a name list.                                                   |
| `getThemeStyle(theme)`                                               | Reads editor UI colors from a Zed or TextMate theme as `DiffsThemeStyle`.                               |
| `isWorkerContext()`                                                  | Tests whether code runs in a worker global scope.                                                       |

## Theme APIs

| Export                                      | Purpose                                                                                             |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `registerCustomTheme(name, loader, type?)`  | Registers a lazy theme loader for current and future backend instances; bundled names are rejected. |
| `resolveTheme(name, preferredHighlighter?)` | Loads and caches one bundled or registered theme in the selected backend's format.                  |

`type` is `'textmate'` for the Shiki backends or `'zed'` for Highlights. Omit it
to register the loader for every backend; the loader must then return the format
of whichever backend loads it. Names are registered separately per format, and a
duplicate name in a format is logged and ignored. Registration does not load a
backend or run the loader. Loaders return the theme object or a module with it
on `default`; the registered name replaces the theme's own name. `resolveTheme`
defaults to `'shiki-wasm'`.

## Language APIs

| Export                                                         | Kind     | Purpose                                                           |
| -------------------------------------------------------------- | -------- | ----------------------------------------------------------------- |
| `registerCustomLanguage(lang, loader, extensionsOrFilenames?)` | Function | Registers a lazy Shiki grammar loader and optional file mappings. |
| `customLanguageLoaders`                                        | Map      | Stores registered custom grammar loaders by language name.        |

The loader returns a module whose `default` export is an array of Shiki
grammars; one grammar must declare `lang` as its `name` or an alias. `text` and
`ansi` are reserved and throw. Duplicate names are logged and ignored, and a
failed load can retry. Register an alias before Shiki loads its grammar. Both
Shiki backends and Shiki worker pools load the grammar on demand; the Highlights
backend ignores these loaders.

## `DiffsHighlighter` members

| Member                           | Purpose                                                       |
| -------------------------------- | ------------------------------------------------------------- |
| `name`                           | Names the backend.                                            |
| `themeResolver`                  | Exposes the backend's `@pierre/theming` `ThemeResolver`.      |
| `getTheme(name)`                 | Gets one resolved theme object; throws when it is not loaded. |
| `codeToTokens(code, options)`    | Tokenizes a string into a `TokensResult`.                     |
| `createStreamTokenizer(options)` | Creates a `DiffsStreamTokenizer` for append-only input.       |
| `createLiveTokenizer(options)`   | Creates a `DiffsLiveTokenizer` for an editor `TextDocument`.  |
| `loadLanguages(languages)`       | Loads grammars on demand; Shiki backends only.                |
| `hasLoadedLanguages(languages)`  | Tests whether grammars are loaded; Shiki backends only.       |
| `dispose()`                      | Releases backend resources; Shiki backends only.              |

`CodeToTokensOptions` supplies `lang`, a theme object or light/dark pair,
`cssVariablePrefix`, `defaultColor`, `useTokenTransformer`, and
`tokenizeMaxLineLength`. `DiffsLiveTokenizerOptions` adds `textDocument`,
`renderRange`, `onDeferTokenize`, and `omitInitialTokens`, which keeps unedited
lines of the initial document out of `onDeferTokenize` when the host already
renders them (Shiki backends only).

## Render APIs

| Export                                                          | Purpose                                               |
| --------------------------------------------------------------- | ----------------------------------------------------- |
| `renderFileWithHighlighter(file, highlighter, options, range?)` | Creates a highlighted file HTML tree.                 |
| `renderDiffWithHighlighter(diff, highlighter, options, range?)` | Creates highlighted deletion and addition HTML trees. |

## Stream APIs

| Export                  | Kind  | Purpose                                                       |
| ----------------------- | ----- | ------------------------------------------------------------- |
| `FileStream`            | Class | Renders a readable code stream as highlighted rows.           |
| `FileStreamOptions`     | Type  | Configures stream language, theme, start line, and callbacks. |
| `FileStreamRecallToken` | Type  | Removes provisional tokens from the unfinished streamed line. |

## `FileStream` members

| Member                     | Purpose                                    |
| -------------------------- | ------------------------------------------ |
| `new FileStream(options?)` | Creates a stream renderer.                 |
| `setup(source, wrapper)`   | Connects a readable code stream to a host. |
| `setThemeType(themeType)`  | Selects system, light, or dark theme mode. |
| `cleanUp()`                | Aborts the stream and releases resources.  |

`FileStream` tokenizes through the selected backend's `DiffsStreamTokenizer`,
which exposes `pushCode(chunk)`, `end()`, and `dispose()`. `onStreamWrite`
receives each `ThemedToken` or `FileStreamRecallToken`.
