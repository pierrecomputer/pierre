/**
 * Bundled theme collections for @pierre/theming.
 * This is the only public package entry that imports Shiki normalization,
 * Shiki-packaged theme modules, or first-party Pierre theme modules.
 */

import { pierreThemes } from './collections/pierre';
import { shikiThemes } from './collections/shiki';
import { createThemeCollection, type ThemeCollection } from './index';

export { createTheme, type CreateThemeOptions } from './modules/createTheme';
export { pierreThemes } from './collections/pierre';
export { shikiThemes } from './collections/shiki';

/*
 * Combined bundled themes
 */

// The default bundled collection keeps the app-facing order stable: Pierre
// first, then Shiki, while still allowing callers to filter, pick, or reorder.
export const themes: ThemeCollection = createThemeCollection({
  themes: [pierreThemes, shikiThemes],
});
