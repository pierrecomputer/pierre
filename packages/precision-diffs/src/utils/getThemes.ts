import { DEFAULT_THEMES } from '../constants';
import type { PJSThemeNames, ThemesType } from '../types';

interface ThemesShape {
  theme?: PJSThemeNames;
  themes?: ThemesType;
}

export function getThemes({
  theme,
  themes = DEFAULT_THEMES,
}: ThemesShape): PJSThemeNames[] {
  const themesArr: PJSThemeNames[] = [];
  if (theme != null) {
    themesArr.push(theme);
  } else {
    themesArr.push(themes.dark);
    themesArr.push(themes.light);
  }
  return themesArr;
}
