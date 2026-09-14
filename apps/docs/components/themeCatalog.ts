import { bundledThemeNames } from '@pierre/diffs';
import { createThemeCatalog } from '@pierre/theming';
import { themes } from '@pierre/theming/themes';

const diffThemeNames = new Set(bundledThemeNames);

export const docsThemeCatalog = createThemeCatalog({
  themes,
  defaultLightThemeName: 'pierre-light-soft',
  defaultDarkThemeName: 'pierre-dark-soft',
});

export const docsDiffThemeCatalog = createThemeCatalog({
  ...docsThemeCatalog,
  themes: themes.pick(
    themes.getThemeNames().filter((name) => diffThemeNames.has(name))
  ),
});
