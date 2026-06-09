import { DuplicateThemeError, type ThemeLoader } from '@pierre/theming';
import { createTheme } from '@pierre/theming/themes';

import type { ThemeRegistration, ThemeRegistrationResolved } from '../../types';
import { themeResolver } from './themeResolver';

export type CustomThemeLoader = ThemeLoader<
  ThemeRegistration | ThemeRegistrationResolved
>;

// Registers a named custom theme loader on the diffs resolver. The loader is
// wrapped by createTheme so its result is run through Shiki's
// normalizeTheme before caching — this preserves the legacy behavior where
// every resolved theme (custom, Pierre, or Shiki-provided) was normalized, so
// its fg/bg are derived from the colors map. Re-registering an existing name is
// a no-op that logs, matching the previous contract (the generic resolver throws
// DuplicateThemeError, which we translate back into the log-and-return shape).
export function registerCustomTheme(
  themeName: string,
  loader: CustomThemeLoader
): void {
  try {
    const descriptor = createTheme<ThemeRegistrationResolved>({
      name: themeName,
      load: loader,
    });
    themeResolver.registerTheme(descriptor.name, descriptor.load);
  } catch (error) {
    if (error instanceof DuplicateThemeError) {
      console.error(
        'SharedHighlight.registerCustomTheme: theme name already registered',
        themeName
      );
      return;
    }
    throw error;
  }
}
