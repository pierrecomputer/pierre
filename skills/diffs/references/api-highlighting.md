# Highlighting API

This reference lists every language, theme, shared highlighter, and stream
export from `@pierre/diffs`.

## Contents

- [Theme APIs](#theme-apis)
- [Shared highlighter APIs](#shared-highlighter-apis)
- [Render APIs](#render-apis)
- [Stream APIs](#stream-apis)

Languages are built into Highlights. Use `setLanguageOverride` to assign a
supported language to a file or diff, or set `file.lang` directly.

## Theme APIs

| Export                | Kind     | Purpose                                                |
| --------------------- | -------- | ------------------------------------------------------ |
| `registerCustomTheme` | Function | Registers a lazy theme loader for shared highlighters. |
| `CustomThemeLoader`   | Type     | Defines a loader for the selected provider's theme.    |

Each `DiffsHighlighter` exposes a `themeResolver` implementing the
`ThemeResolver<RawTheme>` API from `@pierre/theming`. The highlighter owns its
loaders and cache. Built-in names load themes lazily in the provider's format;
custom loaders must return that same format. The current provider is Highlights.

```ts
import { getSharedHighlighter } from '@pierre/diffs';

const highlighter = await getSharedHighlighter({ themes: [] });
await highlighter.themeResolver.resolveThemes(['github-dark', 'github-light']);
const theme = highlighter.getTheme('github-dark');
```

| Resolver method                       | Purpose                                                  |
| ------------------------------------- | -------------------------------------------------------- |
| `registerTheme(name, loader)`         | Registers one lazy loader.                               |
| `registerThemeIfAbsent(name, loader)` | Registers a loader when its name is free.                |
| `hasRegisteredTheme(name)`            | Tests whether a loader exists.                           |
| `resolveTheme(name)`                  | Loads and caches one theme.                              |
| `resolveThemes(names)`                | Loads and caches themes in input order.                  |
| `getResolvedTheme(name)`              | Reads one cached theme or returns `undefined`.           |
| `getResolvedThemes(names)`            | Reads cached themes in input order.                      |
| `getResolvedOrResolveTheme(name)`     | Returns a cached theme or starts its load.               |
| `hasResolvedTheme(name)`              | Tests whether one theme is cached.                       |
| `hasResolvedThemes(names)`            | Tests whether all named themes are cached.               |
| `seedResolvedTheme(name, theme)`      | Adds a resolved object without a loader.                 |
| `seedResolvedThemes(entries)`         | Adds several resolved objects without loaders.           |
| `clearResolvedThemes()`               | Clears cached themes and active loads but keeps loaders. |

## Shared highlighter APIs

| Export                      | Purpose                                                          |
| --------------------------- | ---------------------------------------------------------------- |
| `getSharedHighlighter`      | Gets or creates the shared highlighter for the requested themes. |
| `preloadHighlighter`        | Loads the shared highlighter before a render.                    |
| `getHighlighterIfLoaded`    | Gets the shared highlighter after load.                          |
| `isHighlighterLoaded`       | Tests a highlighter cache value for a loaded instance.           |
| `isHighlighterLoading`      | Tests a highlighter cache value for an active promise.           |
| `isHighlighterNull`         | Tests a highlighter cache value for an empty state.              |
| `disposeHighlighter`        | Releases the shared instance so the next request creates one.    |
| `getHighlighterOptions`     | Converts component theme options to highlighter input.           |
| `getHighlighterThemeStyles` | Creates theme CSS from a loaded highlighter.                     |
| `getThemes`                 | Converts one theme or light/dark pair to a name list.            |
| `isWorkerContext`           | Tests whether code runs in a worker global scope.                |

`disposeHighlighter()` keeps loaders registered through `registerCustomTheme`.
The next shared instance resolves its own themes. Existing highlighter
references retain their resolver and cached themes; registrations made directly
on that resolver remain local to that instance.

## Render APIs

| Export                      | Purpose                                                 |
| --------------------------- | ------------------------------------------------------- |
| `renderFileWithHighlighter` | Creates a highlighted file syntax tree.                 |
| `renderDiffWithHighlighter` | Creates highlighted deletion and addition syntax trees. |

## Stream APIs

| Export              | Kind  | Purpose                                                       |
| ------------------- | ----- | ------------------------------------------------------------- |
| `FileStream`        | Class | Renders a readable code stream as highlighted rows.           |
| `FileStreamOptions` | Type  | Configures stream language, theme, start line, and callbacks. |

## `FileStream` members

| Member                     | Purpose                                    |
| -------------------------- | ------------------------------------------ |
| `new FileStream(options?)` | Creates a stream renderer.                 |
| `setup(source, wrapper)`   | Connects a readable code stream to a host. |
| `setThemeType(themeType)`  | Selects system, light, or dark theme mode. |
| `cleanUp()`                | Aborts the stream and releases resources.  |

For standalone HTML, tokenization, streaming, or live edits, import the
corresponding APIs directly from `@pierre/highlights`.
