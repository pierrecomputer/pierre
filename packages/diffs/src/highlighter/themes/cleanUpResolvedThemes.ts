import { AttachedThemes } from './constants';
import { themeResolver } from './themeResolver';

// Clears the resolved-theme cache (and any in-flight loads) plus the set of
// themes attached to the highlighter. Registered loaders are intentionally
// preserved, so previously registered custom/pierre/bundled themes can be
// resolved again without re-registering.
export function cleanUpResolvedThemes(): void {
  themeResolver.clearResolvedThemes();
  AttachedThemes.clear();
}
