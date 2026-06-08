import { createThemeCatalog } from '@pierre/theme-kit';
import { themes } from '@pierre/theme-kit/themes';

export const docsThemeCatalog = createThemeCatalog({
  themes,
  defaultLightThemeName: 'pierre-light-soft',
  defaultDarkThemeName: 'pierre-dark-soft',
});
