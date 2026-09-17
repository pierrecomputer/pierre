import type { Theme } from '@pierre/highlights';
import { themes } from '@pierre/highlights/themes/loader';

import {
  createThemeCollection,
  type ThemeCollection,
  type ThemeDescriptor,
} from '../index';

// The loader registry has no appearance metadata; keep light themes discoverable
// without loading their theme data.
const LIGHT_HIGHLIGHTS_THEMES = new Set([
  'ayu-light',
  'catppuccin-latte',
  'everforest-light',
  'github-light',
  'github-light-default',
  'github-light-high-contrast',
  'gruvbox-light-hard',
  'gruvbox-light-medium',
  'gruvbox-light-soft',
  'horizon-bright',
  'kanagawa-lotus',
  'light-plus',
  'material-theme-lighter',
  'min-light',
  'night-owl-light',
  'one-light',
  'pierre-light',
  'pierre-light-protanopia-deuteranopia',
  'pierre-light-soft',
  'pierre-light-tritanopia',
  'pierre-light-vibrant',
  'rose-pine-dawn',
  'slack-ochin',
  'snazzy-light',
  'solarized-light',
  'vitesse-light',
]);

export const highlightsThemes: ThemeCollection<Theme> = createThemeCollection({
  themes: Object.entries(themes)
    .map(
      ([name, load]): ThemeDescriptor<Theme> => ({
        name,
        colorScheme: LIGHT_HIGHLIGHTS_THEMES.has(name) ? 'light' : 'dark',
        collection: 'highlights',
        // Keep native Highlights styling and use the catalog slug as the name.
        load: async () => {
          const { default: theme } = await load();
          return { ...theme, name };
        },
      })
    )
    .sort((a, b) =>
      a.colorScheme === b.colorScheme
        ? a.name.localeCompare(b.name)
        : a.colorScheme === 'light'
          ? -1
          : 1
    ),
});
