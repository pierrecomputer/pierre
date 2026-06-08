import type { DiffsThemeNames, ThemeRegistrationResolved } from '../../types';
import { resolveTheme } from './resolveTheme';
import { themeResolver } from './themeResolver';

// Returns the resolved theme synchronously when it is already cached, otherwise
// kicks off (and returns the Promise for) a full resolveTheme. Uses the diffs
// resolveTheme wrapper for the cold path so the worker guard, bundled fallback,
// and name validation still apply.
export function getResolvedOrResolveTheme(
  themeName: DiffsThemeNames
): ThemeRegistrationResolved | Promise<ThemeRegistrationResolved> {
  return themeResolver.getResolvedTheme(themeName) ?? resolveTheme(themeName);
}
