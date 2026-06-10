import { createThemeController, type ThemePersistence } from '@pierre/theming';

import { docsThemeCatalog } from './themeCatalog';

export { docsThemeCatalog } from './themeCatalog';

// The single owner of the docs app's theming state. Color mode (light/dark/
// system), the diffshub light/dark theme-name picks, and their persistence all
// live here — the React ThemeProvider and diffshub both read/drive this one
// instance, so there is no parallel state ownership. The controller creates
// and owns the resolver; consumers that still need an explicit resolver use
// the docsThemeResolver alias below rather than creating a second cache.
//
// It is a module singleton: created once per process on the server (where the
// browser guards make it a constant) and once per page-load on the client,
// surviving client-side navigations.

// Persistence keys, kept exactly as they were before the unification so the
// pre-paint no-flash bootstrap script (which reads `theme`) and existing users'
// saved selections both keep working.
// TODO(theming): When docs can migrate away from these legacy keys, remove the
// custom adapter below and use createThemeController's built-in `storageKey`
// persistence shape instead.
const MODE_KEY = 'theme';
const LIGHT_THEME_KEY = 'diffshub-light-theme';
const DARK_THEME_KEY = 'diffshub-dark-theme';

function readKey(key: string): string | null {
  try {
    return globalThis.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function writeKey(key: string, value: string): void {
  try {
    globalThis.localStorage?.setItem(key, value);
  } catch {
    // Storage may be unavailable (private mode / denied) — non-fatal.
  }
}

// Maps the controller's selection onto the app's three pre-existing keys: mode
// as a plain `light`/`dark`/`system` string under `theme` (what the bootstrap
// script reads), and the theme names under the diffshub keys.
const docsPersistence: ThemePersistence = {
  load() {
    const mode = readKey(MODE_KEY);
    const light = readKey(LIGHT_THEME_KEY);
    const dark = readKey(DARK_THEME_KEY);
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
    writeKey(MODE_KEY, selection.mode);
    writeKey(LIGHT_THEME_KEY, selection.lightThemeName);
    writeKey(DARK_THEME_KEY, selection.darkThemeName);
  },
};

export const themeController = createThemeController({
  catalog: docsThemeCatalog,
  persistence: docsPersistence,
  defaultMode: 'system',
});

export const docsThemeResolver = themeController.resolver;
