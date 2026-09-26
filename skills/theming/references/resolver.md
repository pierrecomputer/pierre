# Resolver API

This reference covers the resolver exports from `@pierre/theming`.

## Exports

| Export                   | Kind     | Purpose                                                       |
| ------------------------ | -------- | ------------------------------------------------------------- |
| `createThemeResolver`    | Function | Creates an isolated loader registry and resolved-theme cache. |
| `ThemeResolver`          | Type     | Defines the resolver methods.                                 |
| `ThemeLoader`            | Type     | Defines an asynchronous theme loader.                         |
| `DuplicateThemeError`    | Class    | Reports a second registration for the same name.              |
| `UnregisteredThemeError` | Class    | Reports a resolve request for a name with no loader.          |
| `UnresolvedThemeError`   | Class    | Reports a synchronous batch read with an unresolved name.     |

## `ThemeResolver` methods

| Method                                | Purpose                                                  |
| ------------------------------------- | -------------------------------------------------------- |
| `registerTheme(name, loader)`         | Registers one loader.                                    |
| `registerThemeIfAbsent(name, loader)` | Registers one loader only when the name is free.         |
| `hasRegisteredTheme(name)`            | Tests whether a loader exists.                           |
| `resolveTheme(name)`                  | Loads and caches one theme.                              |
| `resolveThemes(names)`                | Loads and caches themes in input order.                  |
| `getResolvedTheme(name)`              | Reads one cached theme or returns `undefined`.           |
| `getResolvedThemes(names)`            | Reads cached themes in input order.                      |
| `getResolvedOrResolveTheme(name)`     | Returns a cached theme or starts its load.               |
| `hasResolvedTheme(name)`              | Tests whether one cached theme exists.                   |
| `hasResolvedThemes(names)`            | Tests whether all named themes exist in the cache.       |
| `seedResolvedTheme(name, theme)`      | Adds one resolved object without a loader.               |
| `seedResolvedThemes(entries)`         | Adds several resolved objects without loaders.           |
| `clearResolvedThemes()`               | Clears cached themes and active loads but keeps loaders. |

Each loader returns a `ThemeLike` object or a module object with that value on
`default`.

## Fallback loading and normalization

`createThemeResolver<TTheme>(options?)` accepts `ThemeResolverOptions<TTheme>`:

```ts
const resolver = createThemeResolver({
  fallbackLoader: async (name) => {
    const loader = bundledLoaders[name];
    return loader === undefined ? undefined : loader();
  },
  normalizeTheme: (theme, name) => ({ ...theme, name }),
});
```

Explicit registrations take precedence over `fallbackLoader`. A fallback may
return a theme, a `{ default: theme }` module, or `undefined` for an unknown
name. `normalizeTheme(theme, name)` can be synchronous or asynchronous and runs
before successful loads enter the cache. Seeded values are already normalized.
Concurrent calls share fallback loading and normalization; rejected loads can be
retried. Clearing caches prevents an earlier in-flight load from repopulating
them. The core resolver still imports no backend or bundled theme data.
