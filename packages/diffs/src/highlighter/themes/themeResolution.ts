import type { ThemeLoader } from '@pierre/theming';
import { shikiThemes } from '@pierre/theming/themes';

import type { DiffsThemeNames, ThemeRegistrationResolved } from '../../types';
import { isWorkerContext } from '../../utils/isWorkerContext';
import { themeResolver } from './themeResolver';

// Shared diffs-specific checks for resolving themes. The generic theming
// resolver owns cache/registry mechanics; diffs still owns worker restrictions,
// Shiki fallback registration, and validating theme.name against the requested
// registry key.
export function prepareThemeResolution(themeName: DiffsThemeNames): void {
  if (isWorkerContext()) {
    throw new Error(
      `Theme "${themeName}" cannot be resolved from a worker context. ` +
        'Themes must be pre-resolved on the main thread and passed to the worker via the resolvedLanguages parameter.'
    );
  }

  if (themeResolver.hasRegisteredTheme(themeName)) {
    return;
  }
  const descriptor = shikiThemes.getTheme(themeName);
  if (descriptor != null) {
    themeResolver.registerThemeIfAbsent(
      descriptor.name,
      descriptor.load as ThemeLoader<ThemeRegistrationResolved>
    );
    return;
  }
  throw new Error(`No valid theme loader registered for "${themeName}"`);
}

export function validateResolvedThemeName(
  themeName: DiffsThemeNames,
  theme: ThemeRegistrationResolved
): void {
  if (theme.name !== themeName) {
    throw new Error(
      `resolvedTheme: themeName: ${themeName} does not match theme.name: ${theme.name}`
    );
  }
}
