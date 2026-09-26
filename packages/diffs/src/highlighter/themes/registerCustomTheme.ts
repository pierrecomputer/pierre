import type {
  Theme as ZedTheme,
  ThemeFamily as ZedThemeFamily,
} from '@pierre/highlights';
import type { ThemeLoader } from '@pierre/theming';
import type { ThemeRegistration } from 'shiki';

import {
  type CustomThemeLoader,
  registerCustomThemeLoader,
} from './themeResolver';
import type { DiffsTheme } from './types';

export type { CustomThemeLoader } from './themeResolver';

/** Register a lazy TextMate, Zed, or shared Diffs theme loader. */
export function registerCustomTheme(
  themeName: string,
  loader: ThemeLoader<ThemeRegistration>,
  type?: 'textmate'
): void;
export function registerCustomTheme(
  themeName: string,
  loader: ThemeLoader<ZedTheme | ZedThemeFamily>,
  type: 'zed'
): void;
export function registerCustomTheme(
  themeName: string,
  loader: ThemeLoader<DiffsTheme>,
  type: 'diffs'
): void;
export function registerCustomTheme(
  themeName: string,
  loader: CustomThemeLoader,
  type: 'textmate' | 'zed' | 'diffs' = 'textmate'
): void {
  registerCustomThemeLoader(themeName, loader, type);
}
