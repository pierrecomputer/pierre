import {
  createThemeCollection,
  type ThemeCollection,
  type ThemeDescriptor,
  type ThemeLoader,
} from '../index';
import { createTheme } from '../modules/createTheme';

const SHIKI_COLLECTION = 'shiki';

/*
 * Shiki theme order
 */

const LIGHT_SHIKI_THEMES = [
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
  'rose-pine-dawn',
  'slack-ochin',
  'snazzy-light',
  'solarized-light',
  'vitesse-light',
] as const;

const DARK_SHIKI_THEMES = [
  'andromeeda',
  'aurora-x',
  'ayu-dark',
  'ayu-mirage',
  'catppuccin-frappe',
  'catppuccin-macchiato',
  'catppuccin-mocha',
  'dark-plus',
  'dracula',
  'dracula-soft',
  'everforest-dark',
  'github-dark',
  'github-dark-default',
  'github-dark-dimmed',
  'github-dark-high-contrast',
  'gruvbox-dark-hard',
  'gruvbox-dark-medium',
  'gruvbox-dark-soft',
  'horizon',
  'houston',
  'kanagawa-dragon',
  'kanagawa-wave',
  'laserwave',
  'material-theme',
  'material-theme-darker',
  'material-theme-ocean',
  'material-theme-palenight',
  'min-dark',
  'monokai',
  'night-owl',
  'nord',
  'one-dark-pro',
  'plastic',
  'poimandres',
  'red',
  'rose-pine',
  'rose-pine-moon',
  'slack-dark',
  'solarized-dark',
  'synthwave-84',
  'tokyo-night',
  'vesper',
  'vitesse-black',
  'vitesse-dark',
] as const;

type ShikiThemeName =
  | (typeof LIGHT_SHIKI_THEMES)[number]
  | (typeof DARK_SHIKI_THEMES)[number];

const LIGHT_SHIKI_THEME_NAMES = new Set<string>(LIGHT_SHIKI_THEMES);

function shikiColorScheme(name: ShikiThemeName): 'light' | 'dark' {
  if (LIGHT_SHIKI_THEME_NAMES.has(name)) return 'light';
  return 'dark';
}

/*
 * Shiki theme loaders
 */

const SHIKI_THEME_IMPORTS = {
  andromeeda: () => import('@shikijs/themes/andromeeda'),
  'aurora-x': () => import('@shikijs/themes/aurora-x'),
  'ayu-dark': () => import('@shikijs/themes/ayu-dark'),
  'ayu-light': () => import('@shikijs/themes/ayu-light'),
  'ayu-mirage': () => import('@shikijs/themes/ayu-mirage'),
  'catppuccin-frappe': () => import('@shikijs/themes/catppuccin-frappe'),
  'catppuccin-latte': () => import('@shikijs/themes/catppuccin-latte'),
  'catppuccin-macchiato': () => import('@shikijs/themes/catppuccin-macchiato'),
  'catppuccin-mocha': () => import('@shikijs/themes/catppuccin-mocha'),
  'dark-plus': () => import('@shikijs/themes/dark-plus'),
  dracula: () => import('@shikijs/themes/dracula'),
  'dracula-soft': () => import('@shikijs/themes/dracula-soft'),
  'everforest-dark': () => import('@shikijs/themes/everforest-dark'),
  'everforest-light': () => import('@shikijs/themes/everforest-light'),
  'github-dark': () => import('@shikijs/themes/github-dark'),
  'github-dark-default': () => import('@shikijs/themes/github-dark-default'),
  'github-dark-dimmed': () => import('@shikijs/themes/github-dark-dimmed'),
  'github-dark-high-contrast': () =>
    import('@shikijs/themes/github-dark-high-contrast'),
  'github-light': () => import('@shikijs/themes/github-light'),
  'github-light-default': () => import('@shikijs/themes/github-light-default'),
  'github-light-high-contrast': () =>
    import('@shikijs/themes/github-light-high-contrast'),
  'gruvbox-dark-hard': () => import('@shikijs/themes/gruvbox-dark-hard'),
  'gruvbox-dark-medium': () => import('@shikijs/themes/gruvbox-dark-medium'),
  'gruvbox-dark-soft': () => import('@shikijs/themes/gruvbox-dark-soft'),
  'gruvbox-light-hard': () => import('@shikijs/themes/gruvbox-light-hard'),
  'gruvbox-light-medium': () => import('@shikijs/themes/gruvbox-light-medium'),
  'gruvbox-light-soft': () => import('@shikijs/themes/gruvbox-light-soft'),
  horizon: () => import('@shikijs/themes/horizon'),
  'horizon-bright': () => import('@shikijs/themes/horizon-bright'),
  houston: () => import('@shikijs/themes/houston'),
  'kanagawa-dragon': () => import('@shikijs/themes/kanagawa-dragon'),
  'kanagawa-lotus': () => import('@shikijs/themes/kanagawa-lotus'),
  'kanagawa-wave': () => import('@shikijs/themes/kanagawa-wave'),
  laserwave: () => import('@shikijs/themes/laserwave'),
  'light-plus': () => import('@shikijs/themes/light-plus'),
  'material-theme': () => import('@shikijs/themes/material-theme'),
  'material-theme-darker': () =>
    import('@shikijs/themes/material-theme-darker'),
  'material-theme-lighter': () =>
    import('@shikijs/themes/material-theme-lighter'),
  'material-theme-ocean': () => import('@shikijs/themes/material-theme-ocean'),
  'material-theme-palenight': () =>
    import('@shikijs/themes/material-theme-palenight'),
  'min-dark': () => import('@shikijs/themes/min-dark'),
  'min-light': () => import('@shikijs/themes/min-light'),
  monokai: () => import('@shikijs/themes/monokai'),
  'night-owl': () => import('@shikijs/themes/night-owl'),
  'night-owl-light': () => import('@shikijs/themes/night-owl-light'),
  nord: () => import('@shikijs/themes/nord'),
  'one-dark-pro': () => import('@shikijs/themes/one-dark-pro'),
  'one-light': () => import('@shikijs/themes/one-light'),
  plastic: () => import('@shikijs/themes/plastic'),
  poimandres: () => import('@shikijs/themes/poimandres'),
  red: () => import('@shikijs/themes/red'),
  'rose-pine': () => import('@shikijs/themes/rose-pine'),
  'rose-pine-dawn': () => import('@shikijs/themes/rose-pine-dawn'),
  'rose-pine-moon': () => import('@shikijs/themes/rose-pine-moon'),
  'slack-dark': () => import('@shikijs/themes/slack-dark'),
  'slack-ochin': () => import('@shikijs/themes/slack-ochin'),
  'snazzy-light': () => import('@shikijs/themes/snazzy-light'),
  'solarized-dark': () => import('@shikijs/themes/solarized-dark'),
  'solarized-light': () => import('@shikijs/themes/solarized-light'),
  'synthwave-84': () => import('@shikijs/themes/synthwave-84'),
  'tokyo-night': () => import('@shikijs/themes/tokyo-night'),
  vesper: () => import('@shikijs/themes/vesper'),
  'vitesse-black': () => import('@shikijs/themes/vitesse-black'),
  'vitesse-dark': () => import('@shikijs/themes/vitesse-dark'),
  'vitesse-light': () => import('@shikijs/themes/vitesse-light'),
} as const satisfies Record<ShikiThemeName, ThemeLoader>;

function createShikiTheme(name: ShikiThemeName): ThemeDescriptor {
  return createTheme({
    name,
    collection: SHIKI_COLLECTION,
    colorScheme: shikiColorScheme(name),
    load: SHIKI_THEME_IMPORTS[name],
  });
}

const SHIKI_THEME_DESCRIPTORS = Object.freeze([
  ...LIGHT_SHIKI_THEMES.map((name) => createShikiTheme(name)),
  ...DARK_SHIKI_THEMES.map((name) => createShikiTheme(name)),
]);

export const shikiThemes: ThemeCollection = createThemeCollection({
  themes: SHIKI_THEME_DESCRIPTORS,
});
