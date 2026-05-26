// Shiki theme names available for the diffshub light/dark theme pickers.
// Mirrors the catalog shown in the diffs docs "Adapts to any Shiki theme"
// example so users can browse the same set of themes from the diffshub UI.

export const LIGHT_THEMES = [
  'pierre-light',
  'pierre-light-soft',
  'catppuccin-latte',
  'everforest-light',
  'github-light',
  'github-light-default',
  'github-light-high-contrast',
  'gruvbox-light-hard',
  'gruvbox-light-medium',
  'gruvbox-light-soft',
  'kanagawa-lotus',
  'light-plus',
  'material-theme-lighter',
  'min-light',
  'one-light',
  'rose-pine-dawn',
  'slack-ochin',
  'snazzy-light',
  'solarized-light',
  'vitesse-light',
] as const;

export const DARK_THEMES = [
  'pierre-dark',
  'pierre-dark-soft',
  'andromeeda',
  'aurora-x',
  'ayu-dark',
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

export type LightTheme = (typeof LIGHT_THEMES)[number];
export type DarkTheme = (typeof DARK_THEMES)[number];
export type ColorMode = 'system' | 'light' | 'dark';

export const DEFAULT_LIGHT_THEME: LightTheme = 'pierre-light-soft';
export const DEFAULT_DARK_THEME: DarkTheme = 'pierre-dark-soft';
