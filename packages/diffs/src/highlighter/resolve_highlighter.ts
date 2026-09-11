import { DEFAULT_THEMES } from '../constants';
import type {
  DiffsHighlighter,
  DiffsThemeNames,
  SupportedLanguages,
  ThemesType,
} from '../types';
import { getThemes } from '../utils/getThemes';
import {
  type CodeHighlighter,
  type CodeHighlighterOptions,
  getRegisteredHighlighter,
} from './code_highlighter';
import { areLanguagesAttached } from './languages/areLanguagesAttached';
import { shikiHighlighter } from './shiki_highlighter';
import { areThemesAttached } from './themes/areThemesAttached';
import { hasResolvedThemes } from './themes/hasResolvedThemes';

/**
 * A loaded Shiki instance or a registered custom highlighter.
 */
export type RenderersHighlighter = DiffsHighlighter | CodeHighlighter;

/**
 * The active `CodeHighlighter`: the one registered with `setHighlighter`, or
 * the built-in shiki implementation when none is registered.
 */
export function getCodeHighlighter(): CodeHighlighter {
  return getRegisteredHighlighter() ?? shikiHighlighter;
}

/**
 * The active custom highlighter, or undefined for the built-in Shiki adapter.
 * Custom adapters keep their own loading and rendering behavior even when
 * they expose a Shiki instance.
 */
export function getCustomHighlighter(): CodeHighlighter | undefined {
  const active = getCodeHighlighter();
  return active === shikiHighlighter ? undefined : active;
}

/**
 * Get a resolved custom highlighter without consulting the current registration.
 * Raw Shiki instances and the built-in adapter return undefined.
 */
export function customHighlighterOf(
  highlighter: RenderersHighlighter
): CodeHighlighter | undefined {
  if (
    highlighter !== shikiHighlighter &&
    'load' in highlighter &&
    'isReady' in highlighter
  ) {
    return highlighter;
  }
  return undefined;
}

/**
 * Unwrap the built-in adapter to its loaded Shiki instance.
 * Custom adapters render through their own implementation.
 */
export function resolveRenderHighlighter(
  highlighter: CodeHighlighter
): RenderersHighlighter {
  if (highlighter === shikiHighlighter) {
    return highlighter.getShikiInstance?.() ?? highlighter;
  }
  return highlighter;
}

/**
 * The highlighter to render with synchronously, if its themes are ready;
 * `undefined` means an async `loadHighlighter` pass is required first.
 * Pass a captured highlighter to keep an edit session on its implementation.
 */
export function getHighlighterIfReady(
  theme: DiffsThemeNames | ThemesType | undefined,
  highlighter: CodeHighlighter = getCodeHighlighter()
): RenderersHighlighter | undefined {
  if (!highlighter.isReady({ langs: [], themes: getThemes(theme) })) {
    return undefined;
  }
  return resolveRenderHighlighter(highlighter);
}

/** Whether the given theme(s) are ready; defaults to the active highlighter. */
export function areHighlighterThemesReady(
  theme: DiffsThemeNames | ThemesType | undefined,
  highlighter: CodeHighlighter = getCodeHighlighter()
): boolean {
  const custom = customHighlighterOf(highlighter);
  if (custom != null) {
    return custom.isReady({ langs: [], themes: getThemes(theme) });
  }
  return areThemesAttached(theme ?? DEFAULT_THEMES);
}

/** Whether the given theme names have at least been resolved (fetched). */
export function areHighlighterThemesResolved(
  themes: DiffsThemeNames[],
  highlighter: CodeHighlighter = getCodeHighlighter()
): boolean {
  const custom = customHighlighterOf(highlighter);
  if (custom != null) {
    return custom.isReady({ langs: [], themes });
  }
  return hasResolvedThemes(themes);
}

/** Whether the given languages can highlight synchronously right now. */
export function isHighlighterLanguageReady(
  lang: SupportedLanguages | SupportedLanguages[] | undefined,
  highlighter: CodeHighlighter = getCodeHighlighter()
): boolean {
  const custom = customHighlighterOf(highlighter);
  if (custom != null) {
    return custom.isReady({
      langs: Array.isArray(lang) ? lang : [lang ?? 'text'],
      themes: [],
    });
  }
  return areLanguagesAttached(lang ?? 'text');
}

/**
 * Load languages and themes on the active highlighter for synchronous rendering.
 */
export async function preloadHighlighter(
  options: CodeHighlighterOptions
): Promise<void> {
  await getCodeHighlighter().load(options);
}

/**
 * Load languages and themes on a captured highlighter, then resolve it for rendering.
 */
export async function loadHighlighter(
  options: CodeHighlighterOptions,
  highlighter: CodeHighlighter = getCodeHighlighter()
): Promise<RenderersHighlighter> {
  await highlighter.load(options);
  return resolveRenderHighlighter(highlighter);
}
