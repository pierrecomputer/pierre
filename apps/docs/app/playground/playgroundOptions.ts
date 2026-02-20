const LIGHT_THEMES = [
  'pierre-light',
  'catppuccin-latte',
  'github-light',
  'one-light',
  'solarized-light',
] as const;

const DARK_THEMES = [
  'pierre-dark',
  'catppuccin-mocha',
  'dracula',
  'github-dark',
  'one-dark-pro',
  'tokyo-night',
  'vitesse-dark',
] as const;

const LINE_DIFF_OPTIONS = [
  { value: 'word-alt', label: 'Word-Alt' },
  { value: 'word', label: 'Word' },
  { value: 'char', label: 'Character' },
  { value: 'none', label: 'None' },
] as const;

const HUNK_SEPARATOR_OPTIONS = [
  { value: 'line-info', label: 'Line-Info' },
  { value: 'line-info-basic', label: 'Line-Info-Basic' },
  { value: 'simple', label: 'Simple' },
  { value: 'metadata', label: 'Metadata' },
] as const;

export type HunkSeparatorValue =
  (typeof HUNK_SEPARATOR_OPTIONS)[number]['value'];

export const DEFAULTS = {
  diffStyle: 'split',
  themeType: 'system',
  lightTheme: 'pierre-light',
  darkTheme: 'pierre-dark',
  diffIndicators: 'bars',
  lineDiffType: 'word-alt',
  hunkSeparators: 'line-info' as HunkSeparatorValue,
  background: true,
  lineNumbers: true,
  wrap: true,
  lineSelection: true,
  hoverButton: true,
  annotations: true,
} as const;

export { LIGHT_THEMES, DARK_THEMES, LINE_DIFF_OPTIONS, HUNK_SEPARATOR_OPTIONS };
