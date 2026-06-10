import type {
  DiffsHighlighter,
  DiffsThemeNames,
  ThemeRegistrationResolved,
} from '../../types';
import { AttachedThemes } from './constants';
import { themeResolver } from './themeResolver';

// Loads resolved themes into the highlighter (loadThemeSync) and records them
// in AttachedThemes so each theme is attached at most once. Accepts either a
// name (which must already be resolved/cached) or a fully-resolved theme
// object. Theme objects are seeded into the resolver when not already present —
// this is the path workers use: they receive pre-resolved themes from the main
// thread (they cannot call resolveTheme themselves) and need them available so
// getResolvedThemes works synchronously.
export function attachResolvedThemes(
  themes:
    | DiffsThemeNames
    | ThemeRegistrationResolved
    | (DiffsThemeNames | ThemeRegistrationResolved)[],
  highlighter: DiffsHighlighter
): void {
  themes = Array.isArray(themes) ? themes : [themes];
  for (let themeRef of themes) {
    let resolvedTheme: ThemeRegistrationResolved | undefined;
    if (typeof themeRef === 'string') {
      resolvedTheme = themeResolver.getResolvedTheme(themeRef);
      if (resolvedTheme == null) {
        throw new Error(
          `loadResolvedThemes: ${themeRef} is not resolved, you must resolve it before calling loadResolvedThemes`
        );
      }
    } else {
      resolvedTheme = themeRef;
      themeRef = themeRef.name;
      if (themeResolver.getResolvedTheme(themeRef) == null) {
        themeResolver.seedResolvedTheme(themeRef, resolvedTheme);
      }
    }
    if (AttachedThemes.has(themeRef)) continue;
    AttachedThemes.add(themeRef);
    highlighter.loadThemeSync(resolvedTheme);
  }
}
