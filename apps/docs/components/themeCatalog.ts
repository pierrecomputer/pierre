import { themes as highlightThemes } from '@pierre/highlights/themes';
import { createThemeCatalog } from '@pierre/theming';
import { themes } from '@pierre/theming/themes';

export const docsThemeCatalog = createThemeCatalog({
  themes,
  defaultLightThemeName: 'pierre-light-soft',
  defaultDarkThemeName: 'pierre-dark-soft',
});

export const docsDiffThemeCatalog = createThemeCatalog({
  ...docsThemeCatalog,
  themes: themes.pick(
    themes.getThemeNames().filter((name) => name in highlightThemes)
  ),
});
