import { bundledThemes } from 'shiki';
import { normalizeTheme } from 'shiki/core';

import { isCustomTheme, resolveCustomTheme } from '../SharedHighlighter';
import type { PJSThemeNames, ThemeRegistrationResolved } from '../types';

/**
 * Resolves a theme to its full ThemeRegistrationResolved data.
 * Handles both custom themes and bundled Shiki themes.
 *
 * @param themeName - The theme name to resolve
 * @returns The resolved theme data, or undefined if not found
 */
export async function resolveTheme(
  themeName: PJSThemeNames
): Promise<ThemeRegistrationResolved | undefined> {
  // Check if it's a custom theme first
  if (isCustomTheme(themeName)) {
    return await resolveCustomTheme(themeName);
  }

  // Otherwise, assume it's a bundled theme
  try {
    const loader = bundledThemes[themeName as keyof typeof bundledThemes];
    if (loader == null) {
      console.warn(`Theme "${themeName}" not found in bundled themes`);
      return undefined;
    }

    const themeModule = await loader();
    return normalizeTheme(themeModule.default);
  } catch (error) {
    console.error(`Failed to resolve theme "${themeName}":`, error);
    return undefined;
  }
}
