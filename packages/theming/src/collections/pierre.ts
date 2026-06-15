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

const DARK_PIERRE_THEMES = [
  'pierre-dark',
  'pierre-dark-soft',
  'pierre-dark-vibrant',
  'pierre-dark-protanopia-deuteranopia',
  'pierre-dark-tritanopia',
] as const;
const LIGHT_PIERRE_THEMES = [
  'pierre-light',
  'pierre-light-soft',
  'pierre-light-vibrant',
  'pierre-light-protanopia-deuteranopia',
  'pierre-light-tritanopia',
] as const;
const PIERRE_THEMES = [...LIGHT_PIERRE_THEMES, ...DARK_PIERRE_THEMES] as const;

type PierreThemeName = (typeof PIERRE_THEMES)[number];

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
  'pierre-dark-protanopia-deuteranopia':
    'Pierre Dark Protanopia & Deuteranopia',
  'pierre-dark-tritanopia': 'Pierre Dark Tritanopia',
  'pierre-light': 'Pierre Light',
  'pierre-light-soft': 'Pierre Light Soft',
  'pierre-light-vibrant': 'Pierre Light Vibrant',
  'pierre-light-protanopia-deuteranopia':
    'Pierre Light Protanopia & Deuteranopia',
  'pierre-light-tritanopia': 'Pierre Light Tritanopia',
} as const satisfies Record<PierreThemeName, string>;

/*
 * Pierre theme loaders
 */

const PIERRE_THEME_IMPORTS = {
  'pierre-dark': () => import('@pierre/theme/pierre-dark'),
  'pierre-dark-soft': () => import('@pierre/theme/pierre-dark-soft'),
  'pierre-dark-vibrant': () => import('@pierre/theme/pierre-dark-vibrant'),
  'pierre-dark-protanopia-deuteranopia': () =>
    import('@pierre/theme/pierre-dark-protanopia-deuteranopia'),
  'pierre-dark-tritanopia': () =>
    import('@pierre/theme/pierre-dark-tritanopia'),
  'pierre-light': () => import('@pierre/theme/pierre-light'),
  'pierre-light-soft': () => import('@pierre/theme/pierre-light-soft'),
  'pierre-light-vibrant': () => import('@pierre/theme/pierre-light-vibrant'),
  'pierre-light-protanopia-deuteranopia': () =>
    import('@pierre/theme/pierre-light-protanopia-deuteranopia'),
  'pierre-light-tritanopia': () =>
    import('@pierre/theme/pierre-light-tritanopia'),
} as const satisfies Record<
  PierreThemeName,
  () => Promise<{ default: ThemeLike }>
>;

function createPierreTheme(name: PierreThemeName): ThemeDescriptor {
  return createTheme({
    name,
    collection: PIERRE_COLLECTION,
    colorScheme: pierreColorScheme(name),
    displayName: PIERRE_THEME_DISPLAY_NAMES[name],
    load: PIERRE_THEME_IMPORTS[name],
  });
}

export const pierreThemes: ThemeCollection = createThemeCollection({
  themes: PIERRE_THEMES.map((name) => createPierreTheme(name)),
});
