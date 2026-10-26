import type { Theme as ZedTheme } from '@pierre/highlights';
import type { ThemeLike } from '@pierre/theming';
import type { ThemeRegistrationResolved } from 'shiki';

/** Shared editor colors with the syntax theme for each supported backend. */
export interface DiffsTheme extends ThemeLike {
  name: string;
  type: 'dark' | 'light';
  fg: string;
  bg: string;
  textmate?: ThemeRegistrationResolved;
  zed?: ZedTheme;
  cssVariables?: CSSVariablesThemeOptions;
}

export interface CSSVariablesThemeOptions {
  name?: string;
  variablePrefix?: string;
  variableDefaults?: Record<string, string>;
  fontStyle?: boolean;
}
