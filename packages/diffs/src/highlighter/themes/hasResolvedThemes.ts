import type { DiffsThemeNames } from '../../types';
import { themeResolver } from './themeResolver';

export function hasResolvedThemes(themeNames: DiffsThemeNames[]): boolean {
  return themeResolver.hasResolvedThemes(themeNames);
}
