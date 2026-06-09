import {
  createThemeCollection,
  type ThemeCollection,
  type ThemeCollectionInput,
} from './createThemeCollection';
import type { ThemeLike } from './types';

export interface ThemeCatalog<
  TTheme extends ThemeLike = ThemeLike,
> extends ThemeCollection<TTheme> {
  defaultLightThemeName: string;
  defaultDarkThemeName: string;
}

export function createThemeCatalog<TTheme extends ThemeLike>(options: {
  themes: ThemeCollectionInput<TTheme>;
  defaultLightThemeName: string;
  defaultDarkThemeName: string;
}): ThemeCatalog<TTheme> {
  const collection = createThemeCollection({ themes: options.themes });

  if (!collection.hasTheme(options.defaultLightThemeName)) {
    throw new Error(
      `Default light theme "${options.defaultLightThemeName}" is not in the catalog`
    );
  }
  if (!collection.hasTheme(options.defaultDarkThemeName)) {
    throw new Error(
      `Default dark theme "${options.defaultDarkThemeName}" is not in the catalog`
    );
  }

  return {
    ...collection,
    defaultLightThemeName: options.defaultLightThemeName,
    defaultDarkThemeName: options.defaultDarkThemeName,
  };
}
