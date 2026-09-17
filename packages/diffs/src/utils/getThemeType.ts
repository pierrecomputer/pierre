import type { DiffsTheme } from '../types';

/** Read the color scheme from a Zed or TextMate theme. */
export function getThemeType(raw: DiffsTheme): 'dark' | 'light' | undefined {
  const type =
    'appearance' in raw && typeof raw.appearance === 'string'
      ? raw.appearance
      : 'type' in raw
        ? (raw.type ?? 'dark')
        : 'dark';
  return type === 'dark' || type === 'light' ? type : undefined;
}
