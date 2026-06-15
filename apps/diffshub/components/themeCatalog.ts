import { createThemeCatalog } from '@pierre/theming';
import { themes } from '@pierre/theming/themes';

export const docsThemeCatalog = createThemeCatalog({
  themes,
  defaultLightThemeName: 'pierre-light-soft',
  defaultDarkThemeName: 'pierre-dark-soft',
});
