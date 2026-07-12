import { createThemeController, type ThemePersistence } from '@pierre/theming';

import { docsThemeCatalog } from './themeCatalog';
import {
  readBrowserStorageKey,
  writeBrowserStorageKey,
} from '@/lib/browserStorage';

export { docsThemeCatalog } from './themeCatalog';

// The single owner of the diffshub app's theming state. Color mode (light/
// dark/system), the light/dark theme-name picks, and their persistence all
// live here, so there is no parallel state ownership. The controller creates
// and owns the resolver; consumers that need an explicit resolver use the
// docsThemeResolver alias below rather than creating a second cache.
//
// It is a module singleton: created once per process on the server (where the
// browser guards make it a constant) and once per page-load on the client,
// surviving client-side navigations.

// The persistence keys the pre-paint no-flash bootstrap script (which reads
// `theme`) and existing users' saved selections depend on, so changing them
// would orphan saved preferences.
// TODO(theming): migrate off these legacy keys and use
// createThemeController's built-in `storageKey` persistence shape instead.
const MODE_KEY = 'theme';
const LIGHT_THEME_KEY = 'diffshub-light-theme';
const DARK_THEME_KEY = 'diffshub-dark-theme';

// Maps the controller's selection onto the app's three storage keys: mode as a
// plain `light`/`dark`/`system` string under `theme` (what the bootstrap script
// reads), and the theme names under the diffshub-prefixed keys.
const docsPersistence: ThemePersistence = {
  load() {
    const mode = readBrowserStorageKey(MODE_KEY);
    const light = readBrowserStorageKey(LIGHT_THEME_KEY);
    const dark = readBrowserStorageKey(DARK_THEME_KEY);
    if (mode == null && light == null && dark == null) return null;
    const validMode =
      mode === 'light' || mode === 'dark' || mode === 'system'
        ? mode
        : 'system';
    return {
      mode: validMode,
      lightThemeName: light ?? docsThemeCatalog.defaultLightThemeName,
      darkThemeName: dark ?? docsThemeCatalog.defaultDarkThemeName,
    };
  },
  save(selection) {
    writeBrowserStorageKey(MODE_KEY, selection.mode);
    writeBrowserStorageKey(LIGHT_THEME_KEY, selection.lightThemeName);
    writeBrowserStorageKey(DARK_THEME_KEY, selection.darkThemeName);
  },
};

export const themeController = createThemeController({
  catalog: docsThemeCatalog,
  persistence: docsPersistence,
  defaultMode: 'system',
});

export const docsThemeResolver = themeController.resolver;
