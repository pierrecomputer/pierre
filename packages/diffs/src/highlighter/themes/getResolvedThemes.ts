import type { DiffsThemeNames, ThemeRegistrationResolved } from '../../types';
import { themeResolver } from './themeResolver';

// This method should only be called if you know all themes are resolved,
// otherwise it will fail. The main intention is a helper to avoid an async
// tick if we don't actually need it
export function getResolvedThemes(
  themeNames: DiffsThemeNames[]
): ThemeRegistrationResolved[] {
  return themeResolver.getResolvedThemes(themeNames);
}
