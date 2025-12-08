import type { DiffsThemeNames, ThemesType } from '../../types';
import { getThemes } from '../../utils/getThemes';
import { AttachedThemes } from './constants';

export function areThemesAttached(
  themes: DiffsThemeNames | ThemesType
): boolean {
  for (const theme of getThemes(themes)) {
    if (!AttachedThemes.has(theme)) {
      return false;
    }
  }
  return true;
}
