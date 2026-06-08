import {
  createThemeCollection,
  type ThemeCollection,
  type ThemeDescriptor,
  type ThemeLike,
} from '../index';
import { createTheme } from '../modules/createTheme';

const PIERRE_COLLECTION = 'pierre';

/*
 * Pierre theme order
 */

const LIGHT_PIERRE_THEMES = [
  'pierre-light',
  'pierre-light-soft',
  // 'pierre-light-vibrant',
] as const;
const DARK_PIERRE_THEMES = [
  'pierre-dark',
  'pierre-dark-soft',
  // 'pierre-dark-vibrant',
] as const;
const PIERRE_THEMES = [...LIGHT_PIERRE_THEMES, ...DARK_PIERRE_THEMES] as const;

type PierreThemeName = (typeof PIERRE_THEMES)[number];
type AvailablePierreThemeName =
  | PierreThemeName
  | 'pierre-dark-vibrant'
  | 'pierre-light-vibrant';

const LIGHT_PIERRE_THEME_NAMES = new Set<string>(LIGHT_PIERRE_THEMES);

function pierreColorScheme(name: PierreThemeName): 'light' | 'dark' {
  if (LIGHT_PIERRE_THEME_NAMES.has(name)) return 'light';
  return 'dark';
}

/*
 * Pierre theme metadata
 */

const PIERRE_THEME_DISPLAY_NAMES = {
  'pierre-dark': 'Pierre Dark',
  'pierre-dark-soft': 'Pierre Dark Soft',
  'pierre-dark-vibrant': 'Pierre Dark Vibrant',
  'pierre-light': 'Pierre Light',
  'pierre-light-soft': 'Pierre Light Soft',
  'pierre-light-vibrant': 'Pierre Light Vibrant',
} as const satisfies Record<AvailablePierreThemeName, string>;

/*
 * Pierre theme loaders
 */

const PIERRE_THEME_IMPORTS = {
  'pierre-dark': () => import('@pierre/theme/pierre-dark'),
  'pierre-dark-soft': () => import('@pierre/theme/pierre-dark-soft'),
  'pierre-dark-vibrant': () => import('@pierre/theme/pierre-dark-vibrant'),
  'pierre-light': () => import('@pierre/theme/pierre-light'),
  'pierre-light-soft': () => import('@pierre/theme/pierre-light-soft'),
  'pierre-light-vibrant': () => import('@pierre/theme/pierre-light-vibrant'),
} as const satisfies Record<
  AvailablePierreThemeName,
  () => Promise<{ default: ThemeLike }>
>;

function loadPierreTheme(name: PierreThemeName) {
  return async () => {
    const m = await PIERRE_THEME_IMPORTS[name]();
    // TODO(@pierre/theme): publish each first-party theme with `name` set to
    // its registry slug (e.g. "pierre-dark") instead of its display label
    // ("Pierre Dark"). Until then, preserve the label as displayName metadata
    // and patch the resolved theme's machine name before Shiki normalizes it.
    return { ...m.default, name };
  };
}

function createPierreTheme(name: PierreThemeName): ThemeDescriptor {
  return createTheme({
    name,
    collection: PIERRE_COLLECTION,
    colorScheme: pierreColorScheme(name),
    displayName: PIERRE_THEME_DISPLAY_NAMES[name],
    load: loadPierreTheme(name),
  });
}

export const pierreThemes: ThemeCollection = createThemeCollection({
  themes: PIERRE_THEMES.map((name) => createPierreTheme(name)),
});
