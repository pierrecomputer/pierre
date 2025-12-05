import { DEFAULT_THEMES } from '../constants';
import type { PJSThemeNames, ThemesType } from '../types';

export function getThemes(
  theme: PJSThemeNames | ThemesType = DEFAULT_THEMES
): PJSThemeNames[] {
  const themesArr: PJSThemeNames[] = [];
  if (typeof theme === 'string') {
    themesArr.push(theme);
  } else {
    themesArr.push(theme.dark);
    themesArr.push(theme.light);
  }
  return themesArr;
}
