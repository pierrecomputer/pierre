import type {
  Theme,
  ThemeFamily,
  ThemeStyle,
  ThemeSyntaxSettings,
} from './index';
import tokenTypes from './token-types';

export const defaultCssVariablePrefix = '--hls-';

/**
 * Bytes of one packed Wasm theme table: 73 five-byte records padded for the
 * emitter's SIMD comparisons. Mirrors `$mem.themeTable` in src/memory.wat.
 */
export const themeTableBytes = 384;

const colorReg = /^#([a-f0-9]{3,4}|[a-f0-9]{6}|[a-f0-9]{8})$/i;
const displayP3Reg =
  /^color\(display-p3\s+[+-]?(?:\d+(?:\.\d*)?|\.\d+)\s+[+-]?(?:\d+(?:\.\d*)?|\.\d+)\s+[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:\s*\/\s*[+-]?(?:\d+(?:\.\d*)?|\.\d+))?\s*\)$/i;

/** One theme slot's resolved styling for a token type. */
export interface TokenStyle {
  color: string | undefined;
  italic: boolean;
  weight: number;
}

/**
 * Accept hex and numeric Display P3 colors that cannot escape a CSS declaration.
 * Named colors, variables, and arbitrary CSS fragments are rejected.
 */
export function isThemeColor(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    (colorReg.test(value.trim()) || displayP3Reg.test(value.trim()))
  );
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

/** Resolve identical colors and font settings for Wasm and JavaScript output. */
export function resolveThemeStyle(style: ThemeStyle, name: string): TokenStyle {
  let color: string | undefined;
  let font_style: string | undefined;
  let font_weight: number | undefined;
  if (name === 'background') color = themeBackground(style);
  else if (name === 'foreground') color = themeForeground(style);
  else {
    ({ color, font_style, font_weight } =
      resolveThemeSyntax(style.syntax ?? {}, name) ?? {});
    if (font_style != null || font_weight != null)
      color ??= themeForeground(style);
  }
  if (isThemeColor(color)) {
    color = color.trim().toLowerCase();
    if (color.startsWith('#')) {
      if (color.length <= 5) color = color.replace(/[^#]/g, '$&$&');
      if (color.length === 9 && color.endsWith('ff')) color = color.slice(0, 7);
      // A zero RGBA record inherits the foreground in the Wasm emitter.
      if (color === '#00000000') color = undefined;
    }
  } else {
    color = undefined;
  }
  return {
    color,
    italic: font_style === 'italic',
    weight:
      font_weight != null && font_weight >= 100 && font_weight <= 900
        ? Math.round(font_weight / 100) * 100
        : 0,
  };
}

/** A prefixed CSS variable for a token slot, matching the Wasm emitter. */
function cssVariable(name: string, cssVariablePrefix: string): string {
  return `var(${cssVariablePrefix}${name.replace(/[._]/g, '-')})`;
}

/**
 * Escape a user string for a double-quoted HTML attribute, the same escaping
 * the CSS-variable emitter applies to its prefix. Theme colors never need it
 * (`isThemeColor` rejects anything but hex and numeric Display P3), but
 * prefixes and theme keys are arbitrary strings.
 */
export function escapeAttribute(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

/**
 * The `<pre>` opener the CSS-variable emitter writes with an empty prefix.
 * Tag-replacement maps key on it and on `variableSpanTag` openers to rewrite
 * the emitter's output with colors it cannot carry itself.
 */
export const variableRootTag =
  '<pre class="highlights" style="background-color:var(background);color:var(foreground);">';

/** The `<span>` opener the CSS-variable emitter writes for a token id with an empty prefix. */
export function variableSpanTag(hl: number): string {
  return `<span style="color:var(${tokenTypes[hl].replace(/[._]/g, '-')})">`;
}

/**
 * One theme prepared for every output path. `styles` is indexed by token id,
 * with `null` for unstyled slots; the foreground and background live in `fg`
 * and `bg` instead. Which extra representation is present depends on the
 * theme: hex themes carry the packed Wasm `table`, Display P3 themes carry
 * the HTML tag replacements, and CSS-variable themes carry neither because
 * every color is a prefixed custom property. Representations that only some
 * callers need are built on first read: the tag replacements, and the
 * variable references of a CSS-variable theme, which HTML output never reads.
 */
export interface PreparedTheme {
  name: string;
  styles: (TokenStyle | null)[];
  fg?: string;
  bg?: string;
  /** True when any color is `color(display-p3 …)`. */
  usesDisplayP3: boolean;
  /**
   * Five bytes per token id (`r g b a style`) for the Wasm theme table, or
   * `undefined` when HTML must render through the CSS-variable emitter
   * because the colors are custom properties or Display P3.
   */
  table: Uint8Array | undefined;
  /**
   * For Display P3 themes, the CSS-variable emitter's unprefixed `<pre>` and
   * `<span>` openers mapped to openers with the theme's colors and font
   * settings inlined; built on first read, so token-only callers never pay
   * for it. `undefined` for other themes.
   */
  readonly htmlTags: Map<string, string> | undefined;
}

// Cache by object identity, not name: same-named themes may have different
// palettes, and a registered theme may be replaced by a new object with the
// same name. CSS-variable themes get one entry per prefix; the others use ''.
const preparedCache = new WeakMap<Theme, Map<string, PreparedTheme>>();

/**
 * Prepare a theme or family for rendering, resolving every token slot once.
 * Results are cached by theme object identity (and by prefix for
 * CSS-variable themes), so HTML, token, stream, and live output share one
 * prepared object per theme.
 */
export function prepareTheme(
  theme: Theme | ThemeFamily,
  cssVariablePrefix: string = defaultCssVariablePrefix
): PreparedTheme {
  const resolved = resolveTheme(theme);
  const prefix = resolved.cssVariables === true ? cssVariablePrefix : '';
  let prefixes = preparedCache.get(resolved);
  const cached = prefixes?.get(prefix);
  if (cached !== undefined) return cached;
  const prepared =
    resolved.cssVariables === true
      ? prepareCssVariables(resolved.name, cssVariablePrefix)
      : prepareStyles(resolved);
  if (prefixes === undefined) {
    prefixes = new Map();
    preparedCache.set(resolved, prefixes);
  }
  prefixes.set(prefix, prepared);
  return prepared;
}

/**
 * A CSS-variable theme: every slot references its prefixed custom property
 * and the theme's own `style` is never read. The references are built on
 * first read, since HTML output only needs to know there is no table.
 */
function prepareCssVariables(
  name: string,
  cssVariablePrefix: string
): PreparedTheme {
  let variables: Pick<PreparedTheme, 'styles' | 'fg' | 'bg'> | undefined;
  const resolve = () => (variables ??= cssVariableStyles(cssVariablePrefix));
  return {
    name,
    get styles() {
      return resolve().styles;
    },
    get fg() {
      return resolve().fg;
    },
    get bg() {
      return resolve().bg;
    },
    usesDisplayP3: false,
    table: undefined,
    htmlTags: undefined,
  };
}

/** Variable references for every token slot plus the foreground and background. */
function cssVariableStyles(
  cssVariablePrefix: string
): Pick<PreparedTheme, 'styles' | 'fg' | 'bg'> {
  const styles: (TokenStyle | null)[] = new Array(tokenTypes.length).fill(null);
  for (let i = 1; i < tokenTypes.length; i++) {
    styles[i] = {
      color: cssVariable(tokenTypes[i], cssVariablePrefix),
      italic: false,
      weight: 0,
    };
  }
  return {
    styles,
    fg: cssVariable('foreground', cssVariablePrefix),
    bg: cssVariable('background', cssVariablePrefix),
  };
}

/**
 * Resolve every token slot of a hex or Display P3 theme in one pass, packing
 * each hex color and its font settings into the Wasm theme table as it goes.
 * Font settings stay in the table even without a color. Display P3 colors
 * cannot fit the packed RGBA records, so such a theme drops the table and
 * gets HTML tag replacements instead.
 */
function prepareStyles(theme: Theme): PreparedTheme {
  const themeStyle = theme.style ?? {};
  const styles: (TokenStyle | null)[] = new Array(tokenTypes.length).fill(null);
  const table = new Uint8Array(tokenTypes.length * 5);
  let fg: string | undefined;
  let bg: string | undefined;
  let usesDisplayP3 = false;
  for (let i = 1; i < tokenTypes.length; i++) {
    const name = tokenTypes[i];
    const style = resolveThemeStyle(themeStyle, name);
    const { color, italic, weight } = style;
    const o = i * 5;
    if (color !== undefined) {
      if (color.startsWith('#')) {
        const rgb = parseInt(color.slice(1, 7), 16);
        table[o] = rgb >> 16;
        table[o + 1] = (rgb >> 8) & 0xff;
        table[o + 2] = rgb & 0xff;
        table[o + 3] = color.length === 9 ? parseInt(color.slice(7), 16) : 0xff;
      } else {
        // `resolveThemeStyle` only returns hex or `color(display-p3 …)`.
        usesDisplayP3 = true;
      }
    }
    table[o + 4] = (italic ? 0x10 : 0) | (weight / 100);
    if (color === undefined && !italic && weight === 0) continue;
    if (name === 'foreground') fg = color;
    else if (name === 'background') bg = color;
    else styles[i] = style;
  }
  let htmlTags: Map<string, string> | undefined;
  return {
    name: theme.name,
    styles,
    fg,
    bg,
    usesDisplayP3,
    table: usesDisplayP3 ? undefined : table,
    get htmlTags() {
      if (!usesDisplayP3) return undefined;
      return (htmlTags ??= displayP3HtmlTags(styles, fg, bg));
    },
  };
}

/**
 * Tag replacements for Display P3 HTML. The CSS-variable emitter runs with an
 * empty prefix, so its openers read `var(<token>)`; each maps to an opener
 * with the theme's color and font settings inlined, the shape the packed-table
 * emitter produces. Every color passed `isThemeColor`, so none can escape the
 * style attribute.
 */
function displayP3HtmlTags(
  styles: (TokenStyle | null)[],
  fg: string | undefined,
  bg: string | undefined
): Map<string, string> {
  const tags = new Map<string, string>();
  const rootStyle =
    (bg === undefined ? '' : `background-color:${bg};`) +
    (fg === undefined ? '' : `color:${fg}`);
  tags.set(variableRootTag, `<pre class="highlights" style="${rootStyle}">`);
  for (let i = 1; i < tokenTypes.length; i++) {
    const style = styles[i];
    const css =
      `color:${style?.color ?? 'inherit'}` +
      (style?.italic === true ? ';font-style:italic' : '') +
      (style != null && style.weight !== 0
        ? `;font-weight:${style.weight}`
        : '');
    tags.set(variableSpanTag(i), `<span style="${css}">`);
  }
  return tags;
}
