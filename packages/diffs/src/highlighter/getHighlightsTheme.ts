import type { Theme } from '@pierre/highlights';

import type { RawTheme } from '../types';

/** Check backend-neutral themes before passing them to Highlights. */
export function getHighlightsTheme(theme: RawTheme): Theme {
  if (
    !('appearance' in theme) ||
    (theme.appearance !== 'dark' && theme.appearance !== 'light') ||
    !('style' in theme) ||
    theme.style == null ||
    typeof theme.style !== 'object' ||
    Array.isArray(theme.style)
  ) {
    throw new Error('Theme "' + theme.name + '" is not a Highlights theme');
  }
  return theme as Theme;
}
