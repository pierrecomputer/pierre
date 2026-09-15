import { normalizeThemeColors } from '@pierre/theming/color';

import type { DiffsTheme, DiffsThemeStyle } from '../types';

const cache = new WeakMap<DiffsTheme, DiffsThemeStyle>();

/** Read theme UI colors without validating a backend's syntax theme format. */
export function getThemeStyle(raw: DiffsTheme): DiffsThemeStyle {
  if (
    'style' in raw &&
    raw.style != null &&
    typeof raw.style === 'object' &&
    !Array.isArray(raw.style)
  )
    return raw.style;
  const cached = cache.get(raw);
  if (cached !== undefined) return cached;
  const { fg, bg, colors = {} } = normalizeThemeColors(raw);
  const style = {
    'editor.foreground': fg ?? colors['editor.foreground'],
    'editor.background': bg ?? colors['editor.background'],
    created: colors['gitDecoration.addedResourceForeground'],
    deleted: colors['gitDecoration.deletedResourceForeground'],
    modified: colors['gitDecoration.modifiedResourceForeground'],
    'editor.active_line.background': colors['editor.lineHighlightBackground'],
    'editor.active_line.border': colors['editor.lineHighlightBorder'],
    'search.match_background': colors['editor.findMatchBackground'],
    'editor.document_highlight.bracket_background':
      colors['editorBracketMatch.background'],
    'editor.document_highlight.bracket_border':
      colors['editorBracketMatch.border'],
    players: [
      {
        cursor: colors['editorCursor.foreground'],
        selection: colors['editor.selectionBackground'],
      },
    ],
    hint: colors['editorHint.foreground'],
    info: colors['editorInfo.foreground'],
    warning: colors['editorWarning.foreground'],
    error: colors['editorError.foreground'],
  };
  cache.set(raw, style);
  return style;
}
