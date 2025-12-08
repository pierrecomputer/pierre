import type { DiffsThemeNames, ThemeRegistrationResolved } from '../../types';
import { getResolvedOrResolveTheme } from './getResolvedOrResolveTheme';
import { resolveTheme } from './resolveTheme';

export async function resolveThemes(
  themes: DiffsThemeNames[]
): Promise<ThemeRegistrationResolved[]> {
  const resolvedThemes: ThemeRegistrationResolved[] = [];
  const themesToResolve: Promise<ThemeRegistrationResolved | undefined>[] = [];
  for (const themeName of themes) {
    const themeData =
      getResolvedOrResolveTheme(themeName) ?? resolveTheme(themeName);
    if ('then' in themeData) {
      themesToResolve.push(themeData);
    } else {
      resolvedThemes.push(themeData);
    }
  }

  if (themesToResolve.length > 0) {
    await Promise.all(themesToResolve).then((resolved) => {
      for (const theme of resolved) {
        if (theme != null) {
          resolvedThemes.push(theme);
        }
      }
    });
  }

  return resolvedThemes;
}
