import { DuplicateThemeError, type ThemeLoader } from '@pierre/theming';

import type {
  DiffsHighlighter,
  DiffsTheme,
  DiffsThemeNames,
  HighlighterRenderBaseOptions,
  ThemesType,
} from '../types';
import { setCustomExtension } from '../utils/getFiletypeFromFileName';
import { getThemes } from '../utils/getThemes';
export * from './themeNames';

type CustomThemeLoader = ThemeLoader<DiffsTheme>;

type CustomLanguageLoader = () => Promise<{
  default: { name: string; scopeName: string; aliases?: string[] }[];
}>;

type HighlighterName = NonNullable<
  HighlighterRenderBaseOptions['preferredHighlighter']
>;

type HighlighterLoader = () => Promise<{
  createDiffsHighlighter(
    customThemeLoaders?: ReadonlyMap<string, CustomThemeLoader>,
    customLanguageLoaders?: ReadonlyMap<string, CustomLanguageLoader>
  ): DiffsHighlighter | Promise<DiffsHighlighter>;
}>;

type CachedOrLoadingHighlighter =
  | DiffsHighlighter
  | Promise<DiffsHighlighter>
  | undefined;

interface HighlighterOptions {
  themes: DiffsThemeNames[];
  langs?: string[];
  preferredHighlighter?: HighlighterName;
}

const cache = new Map<HighlighterName, CachedOrLoadingHighlighter>();

const customThemeLoaders = {
  textmate: new Map<string, CustomThemeLoader>(),
  zed: new Map<string, CustomThemeLoader>(),
};

export const customLanguageLoaders: Map<string, CustomLanguageLoader> =
  new Map();

/** Default highlighter name */
export const defaultHighlighter: HighlighterName = 'highlights';

/** Lazy backend imports used to create shared highlighter instances. */
export const highlighters: Record<HighlighterName, HighlighterLoader> = {
  highlights: () => import('@pierre/diffs/highlighter/highlights'),
  'shiki-wasm': () => import('@pierre/diffs/highlighter/shiki-wasm'),
  'shiki-js': () => import('@pierre/diffs/highlighter/shiki-js'),
};

/**
 * Get or create the shared instance for the selected backend, defaulting to
 * Highlights. Concurrent calls share backend initialization. Resolves after
 * the requested themes and any languages requiring loading are ready.
 */
export async function getSharedHighlighter({
  themes,
  langs = [],
  preferredHighlighter = defaultHighlighter,
}: HighlighterOptions): Promise<DiffsHighlighter> {
  let cached = cache.get(preferredHighlighter);
  if (cached === undefined) {
    const themeLoaders =
      customThemeLoaders[
        preferredHighlighter === 'highlights' ? 'zed' : 'textmate'
      ];
    const pending = highlighters[preferredHighlighter]()
      .then(async ({ createDiffsHighlighter }) => {
        const instance = await createDiffsHighlighter(
          themeLoaders,
          customLanguageLoaders
        );
        for (const [name, loader] of themeLoaders) {
          instance.themeResolver.registerTheme(name, loader);
        }
        // A backend finishing after disposal belongs only to its original callers.
        if (cache.get(preferredHighlighter) === pending)
          cache.set(preferredHighlighter, instance);
        return instance;
      })
      .catch((error: unknown) => {
        if (cache.get(preferredHighlighter) === pending)
          cache.delete(preferredHighlighter);
        throw error;
      });
    cache.set(preferredHighlighter, pending);
    cached = pending;
  }
  const instance = await cached;
  await Promise.all([
    instance.themeResolver.resolveThemes(themes),
    instance.loadLanguages?.(langs),
  ]);
  return instance;
}

/**
 * Get a cached backend synchronously when it is initialized and the requested
 * themes and languages are ready. Defaults to Highlights and returns
 * `undefined` when loading is needed, without starting any loads.
 */
export function getHighlighterIfLoaded(settings?: {
  theme?: DiffsThemeNames | ThemesType;
  langs?: string[];
  preferredHighlighter?: HighlighterName;
}): DiffsHighlighter | undefined {
  const highlighter = cache.get(
    settings?.preferredHighlighter ?? defaultHighlighter
  );
  if (highlighter === undefined || !isHighlighterLoaded(highlighter)) return;
  if (
    settings?.theme != null &&
    !highlighter.themeResolver.hasResolvedThemes(getThemes(settings.theme))
  )
    return;
  if (
    settings?.langs != null &&
    highlighter.hasLoadedLanguages?.(settings.langs) === false
  )
    return;
  return highlighter;
}

/**
 * Register a lazy Shiki grammar loader and optional filenames or extensions
 * (without a leading dot). The name must match a returned grammar or alias.
 * Successful loads are cached across Shiki instances; failed loads can retry.
 * Duplicate registrations log an error and are ignored. Highlights does not
 * use these loaders.
 *
 * @throws If `lang` is the reserved name `text` or `ansi`.
 */
export function registerCustomLanguage(
  lang: string,
  loader: CustomLanguageLoader,
  extensionsOrFilenames: string[] = []
): void {
  if (lang === 'text' || lang === 'ansi') {
    throw new Error(
      "registerCustomLanguage: 'text' and 'ansi' are reserved language names"
    );
  }
  if (customLanguageLoaders.has(lang)) {
    console.error(
      `registerCustomLanguage: lang: ${lang} is already registered`
    );
    return;
  }
  let pending: ReturnType<CustomLanguageLoader> | undefined;
  customLanguageLoaders.set(lang, () => {
    pending ??= Promise.resolve()
      .then(loader)
      .then((result) => {
        if (
          !result.default.some(
            (grammar) =>
              grammar.name === lang || grammar.aliases?.includes(lang) === true
          )
        ) {
          throw new Error(
            `registerCustomLanguage: No returned grammar declares "${lang}" as its name or an alias.`
          );
        }
        return result;
      })
      .catch((error: unknown) => {
        pending = undefined;
        throw error;
      });
    return pending;
  });
  for (const extension of extensionsOrFilenames) {
    setCustomExtension(extension, lang);
  }
}

/**
 * Register a lazy theme loader for current and future backend instances.
 * Duplicate names in the selected registries log an error and are ignored.
 *
 * @param type Theme format: `textmate` for Shiki or `zed` for Highlights.
 * Omit to register with both; the theme must be compatible with each backend used.
 */
export function registerCustomTheme(
  name: string,
  loader: CustomThemeLoader,
  type?: 'textmate' | 'zed'
): void {
  const registries =
    type === undefined
      ? Object.values(customThemeLoaders)
      : [customThemeLoaders[type]];
  const highlighters = [...cache.values()].filter(
    (highlighter): highlighter is DiffsHighlighter =>
      isHighlighterLoaded(highlighter) &&
      (type === undefined ||
        (highlighter.name === 'highlights' ? 'zed' : 'textmate') === type)
  );
  try {
    if (registries.some((registry) => registry.has(name)))
      throw new DuplicateThemeError(name);
    for (const highlighter of highlighters) {
      if (highlighter.themeResolver.hasRegisteredTheme(name)) {
        throw new DuplicateThemeError(name);
      }
    }
    for (const highlighter of highlighters) {
      highlighter.themeResolver.registerTheme(name, loader);
    }
    for (const registry of registries) registry.set(name, loader);
  } catch (error) {
    if (!(error instanceof DuplicateThemeError)) throw error;
    console.error('registerCustomTheme: theme name already registered', name);
  }
}

/**
 * Check whether a cached value is an initialized instance. Defaults to the
 * shared Highlights cache entry; does not check theme or language readiness.
 */
export function isHighlighterLoaded(
  h: CachedOrLoadingHighlighter = cache.get(defaultHighlighter)
): h is DiffsHighlighter {
  return h != null && !('then' in h);
}

/**
 * Check whether a cached value is an initialization promise. Defaults to the
 * shared Highlights cache entry.
 */
export function isHighlighterLoading(
  h: CachedOrLoadingHighlighter = cache.get(defaultHighlighter)
): h is Promise<DiffsHighlighter> {
  return h != null && 'then' in h;
}

/**
 * Check whether a cached value is absent. Defaults to the shared Highlights
 * cache entry.
 */
export function isHighlighterNull(
  h: CachedOrLoadingHighlighter = cache.get(defaultHighlighter)
): h is undefined {
  return h == null;
}

/**
 * Initialize the selected shared backend and load the requested themes and
 * languages before rendering. Defaults to Highlights.
 */
export async function preloadHighlighter(
  options: HighlighterOptions
): Promise<void> {
  await getSharedHighlighter(options);
}

/**
 * Clear all shared backend cache entries so subsequent requests create fresh
 * instances. Existing instances, pending loads, and custom registrations remain
 * usable. Returns an already-resolved promise.
 */
export function disposeHighlighter(): Promise<void> {
  cache.clear();
  return Promise.resolve();
}
