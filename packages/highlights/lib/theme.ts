import type {
  Theme,
  ThemeFamily,
  ThemeStyle,
  ThemeSyntaxSettings,
} from './index';
import tokenTypes from './token-types';

const colorReg = /^#([a-f0-9]{3,4}|[a-f0-9]{6}|[a-f0-9]{8})$/i;

/**
 * True for the hex colors the theme compiler accepts: `#rgb`, `#rgba`,
 * `#rrggbb`, or `#rrggbbaa`, ignoring surrounding whitespace exactly as
 * `compileTheme` does. Anything else (named colors, `var()`, CSS fragments)
 * is rejected, which lets `toCSS` interpolate only values that cannot escape
 * a declaration.
 */
export function isThemeColor(value: unknown): value is string {
  return typeof value === 'string' && colorReg.test(value.trim());
}

/** A theme's default text color: `editor.foreground`, `text`, then `foreground`. */
export function themeForeground(style: ThemeStyle): string | undefined {
  return style['editor.foreground'] ?? style.text ?? style.foreground;
}

/** A theme's editor background: `editor.background`, then `background`. */
export function themeBackground(style: ThemeStyle): string | undefined {
  return style['editor.background'] ?? style.background;
}

/** Describe a rejected theme value for the `invalid theme` error message. */
function describeThemeValue(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'string') {
    return `the string ${JSON.stringify(value)} (theme ids are not supported; import the theme object from "@pierre/highlights/themes")`;
  }
  if (Array.isArray(value)) return 'an array';
  if (typeof value === 'object') {
    if ('themes' in value && Array.isArray(value.themes)) {
      return `a ThemeFamily whose first member is ${describeThemeValue(value.themes[0])}`;
    }
    return 'an object without a `name`';
  }
  return `a ${typeof value}`;
}

/** True for an object with a non-empty `name`, the shape every theme needs. */
function isThemeObject(value: unknown): value is Theme {
  return (
    value != null &&
    typeof value === 'object' &&
    'name' in value &&
    typeof value.name === 'string' &&
    value.name !== ''
  );
}

/**
 * The single `Theme` behind a `theme` option: a `ThemeFamily` resolves to its
 * first member. Throws a `TypeError` naming what was received when the value
 * is not a theme object, so a theme id passed as a string (Shiki style) fails
 * with a clear message instead of a raw engine error.
 */
export function resolveTheme(theme: Theme | ThemeFamily): Theme {
  const resolved: unknown =
    theme != null &&
    typeof theme === 'object' &&
    'themes' in theme &&
    theme.themes != null
      ? theme.themes[0]
      : theme;
  if (!isThemeObject(resolved)) {
    throw new TypeError(
      `invalid theme: expected a Theme or ThemeFamily object, received ${describeThemeValue(theme)}`
    );
  }
  return resolved;
}

/** Keep the nearest scope's font settings while finding an inherited color. */
export function resolveThemeSyntax(
  syntax: Record<string, string | ThemeSyntaxSettings>,
  name: string
): ThemeSyntaxSettings | undefined {
  let settings: ThemeSyntaxSettings | undefined;
  for (let k = name; k !== ''; ) {
    const v = syntax[k];
    if (typeof v === 'string') return { ...settings, color: v };
    if (v != null && typeof v === 'object') {
      settings ??= v;
      if (v.color != null) return { ...settings, color: v.color };
    }
    const dot = k.lastIndexOf('.');
    k = dot < 0 ? '' : k.slice(0, dot);
  }
  return settings;
}

/**
 * Compile a Zed theme into its binary style table.
 */
export function compileTheme(theme: Theme): Uint8Array {
  const style = theme.style ?? {};
  const foreground = themeForeground(style);
  const syntax = style.syntax ?? {};
  const bytes = new Uint8Array(tokenTypes.length * 5);
  for (let i = 0; i < tokenTypes.length; i++) {
    const name = tokenTypes[i];
    let color: string | undefined;
    let font_style: string | undefined;
    let font_weight: number | undefined;
    if (name === 'none') continue;
    else if (name === 'background') color = themeBackground(style);
    else if (name === 'foreground') color = foreground;
    else {
      ({ color, font_style, font_weight } =
        resolveThemeSyntax(syntax, name) ?? {});
      if (font_style != null || font_weight != null) color ??= foreground;
    }
    const o = i * 5;
    const m = typeof color === 'string' ? colorReg.exec(color.trim()) : null;
    if (m !== null) {
      const hex = m[1].length <= 4 ? m[1].replace(/./g, '$&$&') : m[1];
      const rgb = parseInt(hex.slice(0, 6), 16);
      bytes[o] = rgb >> 16;
      bytes[o + 1] = (rgb >> 8) & 0xff;
      bytes[o + 2] = rgb & 0xff;
      bytes[o + 3] = hex.length === 8 ? parseInt(hex.slice(6), 16) : 0xff;
    }
    let s = font_style === 'italic' ? 0x10 : 0;
    if (font_weight !== undefined && font_weight >= 100 && font_weight <= 900)
      s |= Math.round(font_weight / 100);
    bytes[o + 4] = s;
  }
  return bytes;
}
