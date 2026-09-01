import { DEFAULT_THEMES } from '../constants';
import type {
  DiffsHighlighter,
  DiffsThemeNames,
  HighlighterTypes,
  SupportedLanguages,
  ThemesType,
} from '../types';
import { getThemes } from '../utils/getThemes';
import type { CodeHighlighter } from './code_highlighter';
import {
  getRegisteredHighlighter,
  isBuiltinShikiHighlighter,
} from './code_highlighter';
import { areLanguagesAttached } from './languages/areLanguagesAttached';
import { shikiHighlighter } from './shiki_highlighter';
import { areThemesAttached } from './themes/areThemesAttached';
import { hasResolvedThemes } from './themes/hasResolvedThemes';

/**
 * What the renderers hold: either the loaded shiki instance (the pre-existing
 * behavior, kept byte-identical) or a custom `CodeHighlighter` registered
 * with `setHighlighter`.
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
 * The active highlighter when it is NOT the built-in shiki pass-through.
 * The built-in shiki adapter reports `undefined` here so every pre-existing
 * shiki code path (shared instance, worker pool, TextMate edit mode) runs
 * unchanged; the check is by adapter identity, so a custom highlighter that
 * merely implements `getShikiInstance` still loads and renders through its
 * own implementation.
 */
export function getCustomHighlighter(): CodeHighlighter | undefined {
  const active = getCodeHighlighter();
  return isBuiltinShikiHighlighter(active) ? undefined : active;
}

/**
 * Resolve the object render passes should call. For the built-in shiki
 * implementation this is the raw loaded shiki instance (keeping pre-existing
 * behavior and consumers that expect a `DiffsHighlighter` working); for
 * others — including custom highlighters that expose a shiki instance — it
 * is the `CodeHighlighter` itself.
 */
export function resolveRenderHighlighter(
  highlighter: CodeHighlighter
): RenderersHighlighter {
  if (isBuiltinShikiHighlighter(highlighter)) {
    return highlighter.getShikiInstance?.() ?? highlighter;
  }
  return highlighter;
}

/**
 * The highlighter to render with synchronously, if its themes are ready;
 * `undefined` means an async `loadHighlighter` pass is required first.
 */
export function getHighlighterIfReady(
  theme: DiffsThemeNames | ThemesType | undefined
): RenderersHighlighter | undefined {
  const highlighter = getCodeHighlighter();
  if (!highlighter.isReady({ langs: [], themes: getThemes(theme) })) {
    return undefined;
  }
  return resolveRenderHighlighter(highlighter);
}

/** Whether the given theme(s) are ready on the active highlighter. */
export function areHighlighterThemesReady(
  theme: DiffsThemeNames | ThemesType | undefined
): boolean {
  const custom = getCustomHighlighter();
  if (custom != null) {
    return custom.isReady({ langs: [], themes: getThemes(theme) });
  }
  return areThemesAttached(theme ?? DEFAULT_THEMES);
}

/** Whether the given theme names have at least been resolved (fetched). */
export function areHighlighterThemesResolved(
  themes: DiffsThemeNames[]
): boolean {
  const custom = getCustomHighlighter();
  if (custom != null) {
    return custom.isReady({ langs: [], themes });
  }
  return hasResolvedThemes(themes);
}

/** Whether the given language can highlight synchronously right now. */
export function isHighlighterLanguageReady(
  lang: SupportedLanguages | undefined
): boolean {
  const custom = getCustomHighlighter();
  if (custom != null) {
    return custom.isReady({ langs: [lang ?? 'text'], themes: [] });
  }
  return areLanguagesAttached(lang ?? 'text');
}

/**
 * Load (or get) the active highlighter with the given languages and themes
 * ready. The built-in adapter delegates to the shared shiki instance, which
 * `resolveRenderHighlighter` returns for the pre-existing render paths.
 */
export async function loadHighlighter(options: {
  langs: SupportedLanguages[];
  themes: DiffsThemeNames[];
  preferredHighlighter?: HighlighterTypes;
}): Promise<RenderersHighlighter> {
  const highlighter = getCodeHighlighter();
  await highlighter.load(options);
  return resolveRenderHighlighter(highlighter);
}
