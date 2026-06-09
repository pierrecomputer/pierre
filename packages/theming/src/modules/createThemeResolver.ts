/**
 * Generic theme resolver: a pure cache + registry with no Shiki, no theme JSON,
 * and no bundled fallbacks. Callers register named loaders; this module dedupes
 * concurrent loads (same loader runs at most once per name per cache cycle) and
 * caches resolved ThemeLike objects for synchronous access after the first
 * successful load.
 * The `{ default: theme }` unwrap handles the common pattern of dynamic ESM
 * imports (`import('some-theme.json')`) that wrap the value under `default`.
 */

import type { ThemeLike } from './types';
import { type DefaultExport, unwrapDefault } from './unwrapDefault';

// A loader is a zero-argument async factory that returns either a ThemeLike
// directly or a module-style `{ default: ThemeLike }` (the shape produced by
// `import()` on a JSON theme file or a re-exporting ESM module).
export interface ThemeLoader<TTheme extends ThemeLike = ThemeLike> {
  (): Promise<TTheme | DefaultExport<TTheme>>;
}

export interface ThemeResolver<TTheme extends ThemeLike = ThemeLike> {
  // Seed the resolved cache with an already-resolved theme under `name`,
  // without registering or running a loader. Intended for environments that
  // receive a fully-resolved theme object out of band (for example a worker
  // that is handed pre-resolved themes by the main thread and cannot run a
  // loader itself). A subsequent getResolvedTheme/getResolvedOrResolveTheme/
  // resolveTheme for `name` returns the seeded theme; a later resolveTheme is
  // served from the cache and never invokes a registered loader for that name.
  seedResolvedTheme(name: string, theme: TTheme): void;

  // Seed multiple resolved themes. Accepts any iterable of `[name, theme]`
  // entries so callers can pass arrays or Maps without reshaping.
  seedResolvedThemes(entries: Iterable<readonly [string, TTheme]>): void;

  // Clear the resolved cache and in-flight promises. Registered loaders are
  // kept so subsequent resolveTheme calls re-run them.
  clearResolvedThemes(): void;

  // Returns the cached ThemeLike synchronously when warm; otherwise returns
  // the resolveTheme Promise so callers can await it when cold.
  getResolvedOrResolveTheme(name: string): TTheme | Promise<TTheme>;

  // Synchronous cache read. Returns undefined if the theme has not been
  // resolved yet.
  getResolvedTheme(name: string): TTheme | undefined;

  // Synchronous cache read for a batch. Throws UnresolvedThemeError naming the
  // first missing theme if any requested name is not warm.
  getResolvedThemes(names: readonly string[]): TTheme[];

  // Registry/cache introspection helpers for callers that need to avoid an async
  // tick or decide whether to register a fallback loader.
  hasRegisteredTheme(name: string): boolean;
  hasResolvedTheme(name: string): boolean;
  hasResolvedThemes(names: readonly string[]): boolean;

  // Register a named loader. Throws DuplicateThemeError if a loader for
  // `name` is already present.
  registerTheme(name: string, loader: ThemeLoader<TTheme>): void;

  // Register a loader only when `name` has no loader yet. Returns true when the
  // loader was added and false when a loader already existed.
  registerThemeIfAbsent(name: string, loader: ThemeLoader<TTheme>): boolean;

  // Resolve a theme by name. Dedupes concurrent calls and caches the result.
  // Rejects with UnregisteredThemeError if no loader has been registered.
  resolveTheme(name: string): Promise<TTheme>;

  // Resolve a batch of themes in input order. Each name still goes through the
  // same cache and in-flight dedupe as resolveTheme.
  resolveThemes(names: readonly string[]): Promise<TTheme[]>;
}

// Thrown when a caller tries to register a second loader for an already-known
// theme name. The generic resolver is strict — idempotency layers live above.
export class DuplicateThemeError extends Error {
  constructor(name: string) {
    super(`Theme "${name}" is already registered`);
    this.name = 'DuplicateThemeError';
  }
}

// Thrown when resolveTheme is called for a name with no registered loader.
export class UnregisteredThemeError extends Error {
  constructor(name: string) {
    super(`No loader registered for theme "${name}"`);
    this.name = 'UnregisteredThemeError';
  }
}

// Thrown when callers require a synchronously resolved theme but the cache does
// not contain that name. This is distinct from UnregisteredThemeError: the
// theme may have a loader, it just has not been resolved or seeded yet.
export class UnresolvedThemeError extends Error {
  constructor(name: string) {
    super(`Theme "${name}" has not been resolved`);
    this.name = 'UnresolvedThemeError';
  }
}

// Creates an isolated ThemeResolver instance with its own loader registry,
// resolved-theme cache, and in-flight dedupe map. Multiple instances never
// share state.
export function createThemeResolver<
  TTheme extends ThemeLike = ThemeLike,
>(): ThemeResolver<TTheme> {
  // Maps theme name → registered loader function (set at register time).
  const loaders = new Map<string, ThemeLoader<TTheme>>();

  // Synchronous cache of successfully resolved ThemeLike objects.
  const resolved = new Map<string, TTheme>();

  // In-flight dedupe map: while a load is running, subsequent callers for the
  // same name receive the same Promise instead of launching another load.
  const inflight = new Map<string, Promise<TTheme>>();

  // Incremented whenever resolved/in-flight state is cleared. A loader that
  // started before a clear may still settle later; the generation check prevents
  // that stale promise from repopulating the cache.
  let cacheGeneration = 0;

  function registerTheme(name: string, loader: ThemeLoader<TTheme>): void {
    if (loaders.has(name)) {
      throw new DuplicateThemeError(name);
    }
    loaders.set(name, loader);
  }

  function registerThemeIfAbsent(
    name: string,
    loader: ThemeLoader<TTheme>
  ): boolean {
    if (loaders.has(name)) return false;
    loaders.set(name, loader);
    return true;
  }

  function hasRegisteredTheme(name: string): boolean {
    return loaders.has(name);
  }

  // Resolves a theme by name. Returns immediately if the theme is already in
  // the synchronous cache, dedupes concurrent calls via the inflight map, and
  // clears the inflight entry after settlement (success or failure) so that
  // failed loads can be retried by the next caller.
  function resolveTheme(name: string): Promise<TTheme> {
    const cached = resolved.get(name);
    if (cached !== undefined) {
      return Promise.resolve(cached);
    }

    const existing = inflight.get(name);
    if (existing !== undefined) {
      return existing;
    }

    const loader = loaders.get(name);
    if (loader === undefined) {
      return Promise.reject(new UnregisteredThemeError(name));
    }

    const generation = cacheGeneration;
    const promise = loader()
      .then((result) => {
        // A loader may return either a bare ThemeLike or an ES-module namespace
        // object ({ default: ThemeLike }) — the latter is typical when the
        // loader calls a dynamic import() on a JSON or .ts theme file and the
        // bundler/runtime wraps the value under `default`. We treat any object
        // carrying a top-level `default` key as the module-namespace form.
        // Real ThemeLike theme objects never carry a top-level `default` key,
        // so the heuristic is unambiguous in practice.
        const theme = unwrapDefault(result);
        if (generation === cacheGeneration) {
          resolved.set(name, theme);
        }
        if (inflight.get(name) === promise) {
          inflight.delete(name);
        }
        return theme;
      })
      .catch((err: unknown) => {
        // Clear the inflight entry so a later call can retry.
        if (inflight.get(name) === promise) {
          inflight.delete(name);
        }
        throw err;
      });

    inflight.set(name, promise);
    return promise;
  }

  function resolveThemes(names: readonly string[]): Promise<TTheme[]> {
    return Promise.all(names.map((name) => resolveTheme(name)));
  }

  // Seeds the resolved cache directly with a pre-resolved theme. No loader is
  // registered or run — the value is simply made available to subsequent
  // getResolvedTheme/getResolvedOrResolveTheme/resolveTheme calls. Used by
  // callers (e.g. workers) that obtain a fully-resolved theme object out of
  // band and want it served synchronously without a loader round-trip.
  function seedResolvedTheme(name: string, theme: TTheme): void {
    resolved.set(name, theme);
  }

  function seedResolvedThemes(
    entries: Iterable<readonly [string, TTheme]>
  ): void {
    for (const [name, theme] of entries) {
      seedResolvedTheme(name, theme);
    }
  }

  function getResolvedTheme(name: string): TTheme | undefined {
    return resolved.get(name);
  }

  function getResolvedThemes(names: readonly string[]): TTheme[] {
    const themes: TTheme[] = [];
    for (const name of names) {
      const theme = resolved.get(name);
      if (theme === undefined) {
        throw new UnresolvedThemeError(name);
      }
      themes.push(theme);
    }
    return themes;
  }

  function hasResolvedTheme(name: string): boolean {
    return resolved.has(name);
  }

  function hasResolvedThemes(names: readonly string[]): boolean {
    for (const name of names) {
      if (!resolved.has(name)) return false;
    }
    return true;
  }

  // Returns the cached ThemeLike synchronously if available, otherwise falls
  // through to resolveTheme so callers can await the returned Promise. This
  // matches the "get hot, resolve cold" pattern used throughout the diffs
  // package (getResolvedOrResolveTheme semantics).
  function getResolvedOrResolveTheme(name: string): TTheme | Promise<TTheme> {
    const cached = resolved.get(name);
    if (cached !== undefined) {
      return cached;
    }
    return resolveTheme(name);
  }

  // Clears the resolved cache and any in-flight promises so that subsequent
  // calls re-run loaders from scratch. Registered loaders are preserved.
  function clearResolvedThemes(): void {
    cacheGeneration++;
    resolved.clear();
    inflight.clear();
  }

  return {
    clearResolvedThemes,
    getResolvedOrResolveTheme,
    getResolvedTheme,
    getResolvedThemes,
    hasRegisteredTheme,
    hasResolvedTheme,
    hasResolvedThemes,
    registerTheme,
    registerThemeIfAbsent,
    resolveTheme,
    resolveThemes,
    seedResolvedTheme,
    seedResolvedThemes,
  };
}
