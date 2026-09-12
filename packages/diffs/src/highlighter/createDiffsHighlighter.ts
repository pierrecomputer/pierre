import { codeToTokens, isSupportedLanguage } from '@pierre/highlights';
import { themes } from '@pierre/highlights/themes/loader';
import { createThemeResolver, type ThemeLoader } from '@pierre/theming';

import type { DiffsHighlighter, RawTheme } from '../types';
import { getHighlightsTheme } from './getHighlightsTheme';

/** Keep Highlights loaders and resolved themes local to this backend instance. */
export function createDiffsHighlighter(
  customThemeLoaders?: ReadonlyMap<string, ThemeLoader<RawTheme>>
): DiffsHighlighter {
  const themeResolver = createThemeResolver<RawTheme>({
    fallbackLoader: (name) =>
      customThemeLoaders?.get(name) ??
      (Object.hasOwn(themes, name) ? themes[name] : undefined),
    normalizeTheme(theme, name) {
      const resolved = getHighlightsTheme(theme);
      return resolved.name === name ? resolved : { ...resolved, name };
    },
  });
  return {
    themeResolver,
    codeToTokens(code, { theme, lang, ...options }) {
      return codeToTokens(code, {
        ...options,
        lang: isSupportedLanguage(lang) ? lang : 'text',
        ...('name' in theme
          ? { theme: getHighlightsTheme(theme) }
          : {
              themes: {
                dark: getHighlightsTheme(theme.dark),
                light: getHighlightsTheme(theme.light),
              },
            }),
      });
    },
    getTheme(name) {
      const theme = themeResolver.getResolvedTheme(name);
      if (theme == null) throw new Error('Theme "' + name + '" is not loaded');
      return theme;
    },
  };
}
