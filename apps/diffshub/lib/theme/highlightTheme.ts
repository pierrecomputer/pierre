import {
  type DiffsTheme,
  registerCustomTheme,
  type ThemesType,
} from '@pierre/diffs';
import { cssVariables, toCSS } from '@pierre/highlights/themes';

export const HIGHLIGHT_THEME_NAME = 'diffshub-css-variables';
export const HIGHLIGHT_THEMES: ThemesType = {
  light: HIGHLIGHT_THEME_NAME,
  dark: HIGHLIGHT_THEME_NAME,
};

registerCustomTheme(
  HIGHLIGHT_THEME_NAME,
  () => Promise.resolve(cssVariables),
  'zed'
);

const styles = new WeakMap<DiffsTheme, Record<string, string>>();

export function highlightThemeStyle(theme: DiffsTheme): Record<string, string> {
  const cached = styles.get(theme);
  if (cached != null) return cached;
  if (theme.zed == null)
    throw new Error(`Missing Highlights theme: ${theme.name}`);
  // Warning: cssVariables carries token colors, but not theme-specific font styles.
  const style: Record<string, string> = {};
  for (const declaration of toCSS(theme.zed, {
    cssVariablePrefix: '--diffs-token-',
  }).split(';')) {
    const colon = declaration.indexOf(':');
    if (colon < 0) continue;
    const value = declaration.slice(colon + 1).trim();
    style[declaration.slice(0, colon)] = value === 'inherit' ? theme.fg : value;
  }
  style['--diffs-token-foreground'] ??= theme.fg;
  style['--diffs-token-background'] ??= theme.bg;
  for (const [kind, key, ansi, light, dark] of [
    ['addition', 'added', 'Green', '#0dbe4e', '#5ecc71'],
    ['deletion', 'deleted', 'Red', '#ff2e3f', '#ff6762'],
    ['modified', 'modified', 'Blue', '#009fff', '#69b1ff'],
  ]) {
    style[`--diffs-${kind}-color-override`] =
      theme.colors?.[`gitDecoration.${key}ResourceForeground`] ??
      theme.colors?.[`terminal.ansi${ansi}`] ??
      (theme.type === 'light' ? light : dark);
  }
  styles.set(theme, style);
  return style;
}
