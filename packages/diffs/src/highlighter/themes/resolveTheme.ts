import type { DiffsThemeNames, ThemeRegistrationResolved } from '../../types';
import {
  prepareThemeResolution,
  validateResolvedThemeName,
} from './themeResolution';
import { themeResolver } from './themeResolver';

// Resolves a theme by name to a normalized Shiki theme, delegating the cache,
// concurrent-load dedupe, normalization, and registry to the shared
// @pierre/theming resolver. The diffs-specific behavior layered on top:
//   1. Worker-context guard — themes must be pre-resolved on the main thread
//      and handed to the worker, which seeds them via attachResolvedThemes.
//   2. Bundled-theme fallback — a name with no registered loader that matches a
//      Shiki bundled theme is registered on demand (per-name dynamic import),
//      so callers never have to pre-register the full Shiki theme set.
//   3. theme.name validation — the resolved theme's own name must match the
//      requested name, catching mismatched registrations early.
export async function resolveTheme(
  themeName: DiffsThemeNames
): Promise<ThemeRegistrationResolved> {
  prepareThemeResolution(themeName);

  const theme = await themeResolver.resolveTheme(themeName);

  validateResolvedThemeName(themeName, theme);

  return theme;
}
