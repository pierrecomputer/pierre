import type {
  DiffsHighlighter,
  DiffsThemeNames,
  HighlighterTypes,
  SupportedLanguages,
  ThemesType,
} from '../types';
import { cleanUpResolvedLanguages } from './languages/cleanUpResolvedLanguages';
import { cleanUpResolvedThemes } from './themes/cleanUpResolvedThemes';

type CachedHighlighter = DiffsHighlighter | Promise<DiffsHighlighter>;
const highlighters = new Map<HighlighterTypes, CachedHighlighter>();

/** A backend's cache slot by name, or a cached instance or promise directly. */
type HighlighterState = HighlighterTypes | CachedHighlighter | undefined;

export interface HighlighterOptions {
  themes: DiffsThemeNames[];
  langs: SupportedLanguages[];
  preferredHighlighter?: HighlighterTypes;
}

/** Load only the selected backend and create an independently disposable instance. */
export async function createHighlighter({
  preferredHighlighter = 'shiki-js',
}: {
  preferredHighlighter?: HighlighterTypes;
} = {}): Promise<DiffsHighlighter> {
  if (preferredHighlighter === 'highlights') {
    const { createHighlightsHighlighter } =
      await import('./backends/highlights');
    return createHighlightsHighlighter();
  }
  const { createShikiHighlighter } = await import('./backends/shiki');
  return createShikiHighlighter(preferredHighlighter);
}

export async function getSharedHighlighter({
  themes,
  langs,
  preferredHighlighter = 'shiki-js',
}: HighlighterOptions): Promise<DiffsHighlighter> {
  let cached = highlighters.get(preferredHighlighter);
  if (cached == null) {
    cached = createHighlighter({ preferredHighlighter });
    highlighters.set(preferredHighlighter, cached);
  }
  let instance: DiffsHighlighter;
  try {
    instance = await cached;
  } catch (error) {
    if (highlighters.get(preferredHighlighter) === cached)
      highlighters.delete(preferredHighlighter);
    throw error;
  }
  if (highlighters.get(preferredHighlighter) === cached)
    highlighters.set(preferredHighlighter, instance);
  await Promise.all([
    instance.themeResolver.resolveThemes(themes),
    instance.loadLanguages?.(langs),
  ]);
  return instance;
}

function getCachedHighlighter(
  state: HighlighterState
): CachedHighlighter | undefined {
  return typeof state === 'string' ? highlighters.get(state) : state;
}

// Resolves the cache entry a load-state predicate should inspect. A bare call
// checks the default `shiki-js` backend, but an explicit `undefined` argument
// comes from the instance type-guard overload and means "no instance", so it
// must not fall back to the default backend the way a parameter default would.
function resolvePredicateTarget(
  args: [state?: HighlighterState]
): CachedHighlighter | undefined {
  return getCachedHighlighter(args.length === 0 ? 'shiki-js' : args[0]);
}

function isLoadedInstance(
  cached: CachedHighlighter | undefined
): cached is DiffsHighlighter {
  return cached != null && !('then' in cached);
}

/**
 * Whether a backend's shared instance is ready. Pass the backend name to
 * check a backend other than the default `shiki-js`.
 */
export function isHighlighterLoaded(
  h: CachedHighlighter | undefined
): h is DiffsHighlighter;
export function isHighlighterLoaded(backend?: HighlighterTypes): boolean;
export function isHighlighterLoaded(
  ...args: [state?: HighlighterState]
): boolean {
  return isLoadedInstance(resolvePredicateTarget(args));
}

interface GetHighlighterIfLoadedProps {
  theme?: DiffsThemeNames | ThemesType;
  lang?: SupportedLanguages;
  preferredHighlighter?: HighlighterTypes;
}

export function getHighlighterIfLoaded({
  theme,
  lang,
  preferredHighlighter = 'shiki-js',
}: GetHighlighterIfLoadedProps = {}): DiffsHighlighter | undefined {
  const highlighter = highlighters.get(preferredHighlighter);
  if (!isLoadedInstance(highlighter)) return undefined;
  if (
    theme != null &&
    !highlighter.themeResolver.hasResolvedThemes(
      typeof theme === 'string' ? [theme] : Object.values(theme)
    )
  )
    return undefined;
  if (lang != null && highlighter.hasLoadedLanguages?.([lang]) === false)
    return undefined;
  return highlighter;
}

/** Whether a backend's shared instance is still initializing. */
export function isHighlighterLoading(
  h: CachedHighlighter | undefined
): h is Promise<DiffsHighlighter>;
export function isHighlighterLoading(backend?: HighlighterTypes): boolean;
export function isHighlighterLoading(
  ...args: [state?: HighlighterState]
): boolean {
  const cached = resolvePredicateTarget(args);
  return cached != null && 'then' in cached;
}

/** Whether a backend has neither a shared instance nor one loading. */
export function isHighlighterNull(
  h: CachedHighlighter | undefined
): h is undefined;
export function isHighlighterNull(backend?: HighlighterTypes): boolean;
export function isHighlighterNull(
  ...args: [state?: HighlighterState]
): boolean {
  return resolvePredicateTarget(args) == null;
}

export async function preloadHighlighter(
  options: HighlighterOptions
): Promise<void> {
  await getSharedHighlighter(options);
}

/**
 * Dispose every shared instance and clear the shared theme and language
 * caches. Instances created with createHighlighter() are not disposed and
 * keep the themes and grammars they have already used.
 */
export async function disposeHighlighter(): Promise<void> {
  const cached = [...highlighters.values()];
  highlighters.clear();
  // Failed initialization must not prevent other backends and caches from being cleared.
  const results = await Promise.allSettled(
    cached.map(async (highlighter) => {
      let instance: DiffsHighlighter;
      try {
        instance = await highlighter;
      } catch {
        return;
      }
      instance.dispose();
    })
  );
  cleanUpResolvedLanguages();
  cleanUpResolvedThemes();
  for (const result of results) {
    if (result.status === 'rejected') throw result.reason;
  }
}
