import type { DiffsHighlighter, DiffsThemeNames } from '../../types';
import type { DiffsTheme } from './types';

/** Seed themes received from the main thread into the worker's backend resolver. */
export function attachResolvedThemes(
  themes: DiffsThemeNames | DiffsTheme | (DiffsThemeNames | DiffsTheme)[],
  highlighter: DiffsHighlighter
): void {
  for (const theme of Array.isArray(themes) ? themes : [themes]) {
    const resolved =
      typeof theme === 'string'
        ? highlighter.themeResolver.getResolvedThemes([theme])[0]
        : theme;
    highlighter.themeResolver.seedResolvedTheme(resolved.name, resolved);
  }
}
