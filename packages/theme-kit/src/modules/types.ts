export interface ThemeLike {
  bg?: string;
  colors?: Record<string, string>;
  fg?: string;
  name?: string;
  type?: 'dark' | 'light';
}

export type ColorScheme = 'dark' | 'light';

export type ColorMode = ColorScheme | 'system';
