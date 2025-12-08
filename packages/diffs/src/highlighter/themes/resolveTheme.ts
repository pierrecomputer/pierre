import { bundledThemes, normalizeTheme } from 'shiki';

import type { DiffsThemeNames, ThemeRegistrationResolved } from '../../types';
import { isWorkerContext } from '../../utils/isWorkerContext';
import {
  RegisteredCustomThemes,
  ResolvedThemes,
  ResolvingThemes,
} from './constants';

export async function resolveTheme(
  themeName: DiffsThemeNames
): Promise<ThemeRegistrationResolved> {
  if (isWorkerContext()) {
    throw new Error(
      `resolveTheme("${themeName}") cannot be called from a worker context. ` +
        'Themes must be pre-resolved on the main thread and passed to the worker via the resolvedLanguages parameter.'
    );
  }

  const resolver = ResolvingThemes.get(themeName);
  if (resolver != null) {
    return resolver;
  }

  try {
    const loader =
      RegisteredCustomThemes.get(themeName) ??
      bundledThemes[themeName as keyof typeof bundledThemes];

    if (loader == null) {
      throw new Error(`resolveTheme: No valid loader for ${themeName}`);
    }

    const resolver = loader().then((result) => {
      return normalizeAndCacheResolvedTheme(
        themeName,
        ('default' in result
          ? result.default
          : result) as ThemeRegistrationResolved
      );
    });

    ResolvingThemes.set(themeName, resolver);
    const theme = await resolver;
    if (theme.name !== themeName) {
      throw new Error(
        `resolvedTheme: themeName: ${themeName} does not match theme.name: ${theme.name}`
      );
    }
    ResolvedThemes.set(theme.name, theme);
    return theme;
  } finally {
    ResolvingThemes.delete(themeName);
  }
}

function normalizeAndCacheResolvedTheme(
  themeName: string,
  themeData: ThemeRegistrationResolved
): ThemeRegistrationResolved {
  const resolvedTheme = ResolvedThemes.get(themeName);
  if (resolvedTheme != null) {
    return resolvedTheme;
  }
  themeData = normalizeTheme(themeData);
  ResolvedThemes.set(themeName, themeData);
  return themeData;
}
