import type { ThemeRegistrationResolved } from 'shiki';

import { RegisteredCustomThemes } from './constants';

export function registerCustomTheme(
  themeName: string,
  loader: () => Promise<ThemeRegistrationResolved>
): void {
  if (RegisteredCustomThemes.has(themeName)) {
    console.error(
      'SharedHighlight.registerCustomTheme: theme name already registered',
      themeName
    );
    return;
  }
  RegisteredCustomThemes.set(themeName, loader);
}
