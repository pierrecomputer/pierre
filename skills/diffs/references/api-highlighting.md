# Highlighting API

This reference lists every language, theme, shared highlighter, and stream
export from `@pierre/diffs`.

## Contents

- [Shiki passthrough APIs](#shiki-passthrough-apis)
- [Highlighter selection](#highlighter-selection)
- [Language APIs](#language-apis)
- [Theme APIs](#theme-apis)
- [Shared highlighter APIs](#shared-highlighter-apis)
- [Render APIs](#render-apis)
- [Stream APIs](#stream-apis)

## Shiki passthrough APIs

| Export                    | Kind     | Purpose                                          |
| ------------------------- | -------- | ------------------------------------------------ |
| `codeToHtml`              | Function | Re-exports Shiki's complete code-to-HTML helper. |
| `createCSSVariablesTheme` | Function | Re-exports Shiki's CSS variable theme factory.   |

## Highlighter selection

Shiki is the default. To use the optional Highlights adapter, install
`@pierre/highlights` and import `highlightsHighlighter` from
`@pierre/diffs/highlights`. Pass it to `setHighlighter` before rendering. Pass
`shikiHighlighter` to restore the default. Custom highlighters render on the
main thread; the worker pool always uses Shiki.

| Export               | Purpose                                                   |
| -------------------- | --------------------------------------------------------- |
| `CodeHighlighter`    | Defines loading, theme metadata, tokens, and streaming.   |
| `CodeLiveTokenizer`  | Defines the incremental document tokenizer for edit mode. |
| `setHighlighter`     | Selects the implementation used by subsequent renders.    |
| `getCodeHighlighter` | Gets the selected implementation.                         |
| `shikiHighlighter`   | Provides the built-in Shiki adapter.                      |
| `toHtml`             | Serializes token lines with optional token transformers.  |

The `@pierre/diffs/highlights` entry exports `highlightsHighlighter` and
`registerHighlightsTheme` for registering custom Highlights themes.

## Language APIs

| Export                         | Kind     | Purpose                                                   |
| ------------------------------ | -------- | --------------------------------------------------------- |
| `registerCustomLanguage`       | Function | Registers a lazy language and optional file mappings.     |
| `resolveLanguage`              | Function | Loads and caches one language registration.               |
| `resolveLanguages`             | Function | Loads and caches several language registrations.          |
| `getResolvedOrResolveLanguage` | Function | Returns one cached language or starts its load.           |
| `getResolvedLanguages`         | Function | Gets cached registrations for the supplied languages.     |
| `hasResolvedLanguages`         | Function | Tests whether language registrations are cached.          |
| `attachResolvedLanguages`      | Function | Adds resolved registrations to a highlighter.             |
| `areLanguagesAttached`         | Function | Tests whether a highlighter has the supplied languages.   |
| `cleanUpResolvedLanguages`     | Function | Clears language resolution state.                         |
| `RegisteredCustomLanguages`    | Map      | Stores registered custom language loaders.                |
| `ResolvedLanguages`            | Map      | Stores resolved language registrations.                   |
| `ResolvingLanguages`           | Map      | Stores active language load promises.                     |
| `AttachedLanguages`            | Set      | Stores language names attached to the shared highlighter. |

## Theme APIs

| Export                           | Kind     | Purpose                                                |
| -------------------------------- | -------- | ------------------------------------------------------ |
| `registerCustomTheme`            | Function | Registers a lazy Shiki theme loader.                   |
| `CustomThemeLoader`              | Type     | Defines a raw or resolved Shiki theme loader.          |
| `registerCustomCSSVariableTheme` | Function | Registers a theme that reads CSS variables.            |
| `resolveTheme`                   | Function | Loads and caches one theme.                            |
| `resolveThemes`                  | Function | Loads and caches several themes.                       |
| `getResolvedOrResolveTheme`      | Function | Returns one cached theme or starts its load.           |
| `getResolvedThemes`              | Function | Gets cached themes by name.                            |
| `hasResolvedThemes`              | Function | Tests whether themes are cached.                       |
| `attachResolvedThemes`           | Function | Adds resolved themes to a highlighter.                 |
| `areThemesAttached`              | Function | Tests whether a highlighter has the supplied themes.   |
| `cleanUpResolvedThemes`          | Function | Clears theme resolution state.                         |
| `AttachedThemes`                 | Set      | Stores theme names attached to the shared highlighter. |

## Shared highlighter APIs

| Export                      | Purpose                                                           |
| --------------------------- | ----------------------------------------------------------------- |
| `getSharedHighlighter`      | Gets or creates the shared highlighter for themes and languages.  |
| `preloadHighlighter`        | Loads the shared highlighter before a render.                     |
| `getHighlighterIfLoaded`    | Gets the shared highlighter after load.                           |
| `isHighlighterLoaded`       | Tests a highlighter cache value for a loaded instance.            |
| `isHighlighterLoading`      | Tests a highlighter cache value for an active promise.            |
| `isHighlighterNull`         | Tests a highlighter cache value for an empty state.               |
| `disposeHighlighter`        | Disposes and clears the shared highlighter.                       |
| `getHighlighterOptions`     | Converts one language and component options to highlighter input. |
| `getHighlighterThemeStyles` | Creates theme CSS from a loaded highlighter.                      |
| `getThemes`                 | Converts one theme or light/dark pair to a name list.             |
| `isWorkerContext`           | Tests whether code runs in a worker global scope.                 |

## Render APIs

| Export                      | Purpose                                                |
| --------------------------- | ------------------------------------------------------ |
| `renderFileWithHighlighter` | Creates highlighted file token lines and theme CSS.    |
| `renderDiffWithHighlighter` | Creates highlighted deletion and addition token lines. |

## Stream APIs

| Export                              | Kind  | Purpose                                                       |
| ----------------------------------- | ----- | ------------------------------------------------------------- |
| `FileStream`                        | Class | Renders a readable code stream as highlighted rows.           |
| `FileStreamOptions`                 | Type  | Configures stream language, theme, start line, and callbacks. |
| `CodeToTokenTransformStream`        | Class | Converts code chunks to themed or recall tokens.              |
| `CodeToTokenTransformStreamOptions` | Type  | Configures stream tokenization and recall tokens.             |
| `ShikiStreamTokenizer`              | Class | Tracks stable and unstable tokens across code chunks.         |
| `ShikiStreamTokenizerOptions`       | Type  | Supplies Shiki token options and a highlighter.               |
| `ShikiStreamTokenizerEnqueueResult` | Type  | Returns recalled, stable, and unstable tokens for one chunk.  |
| `RecallToken`                       | Type  | Requests removal of prior unstable tokens.                    |

## `FileStream` members

| Member                     | Purpose                                    |
| -------------------------- | ------------------------------------------ |
| `new FileStream(options?)` | Creates a stream renderer.                 |
| `setup(source, wrapper)`   | Connects a readable code stream to a host. |
| `setThemeType(themeType)`  | Selects system, light, or dark theme mode. |
| `cleanUp()`                | Aborts the stream and releases resources.  |

## `ShikiStreamTokenizer` members

| Member                              | Purpose                              |
| ----------------------------------- | ------------------------------------ |
| `new ShikiStreamTokenizer(options)` | Creates a stateful tokenizer.        |
| `enqueue(chunk)`                    | Tokenizes one code chunk.            |
| `close()`                           | Finalizes and returns stable tokens. |
| `clear()`                           | Clears accumulated token state.      |
| `clone()`                           | Copies current tokenizer state.      |

`CodeToTokenTransformStream` exposes its `tokenizer` and `options` values.
