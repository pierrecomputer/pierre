import type {
  CodeToTokensOptions,
  Theme,
  ThemedToken,
  ThemeFamily,
  TokensResult,
} from './index';
import { compileTheme } from './theme';
import tokenTypes from './token-types';

/** One theme slot's resolved styling for a token type. */
export interface TokenStyle {
  color: string;
  italic: boolean;
  weight: number;
}

/**
 * A Zed theme resolved to per-token-id styles for JavaScript rendering.
 * `styles` is indexed by token ID; CSS-variable themes reference `var(--hls-*)`.
 */
export interface ResolvedThemeStyles {
  name: string;
  styles: (TokenStyle | null)[];
  fg?: string;
  bg?: string;
}

/**
 * How one resolved theme reaches the output: `single` for the `theme` option
 * (plain `color`/`fontStyle`), `default` for the `defaultColor` theme of a
 * `themes` set (plain `color`, `font-style`, `font-weight` in `htmlStyle`),
 * `variable` for the other themes of a set (custom properties), and
 * `light-dark` for the `light`/`dark` pair merged into CSS `light-dark()`.
 */
export type ThemeRole = 'single' | 'default' | 'variable' | 'light-dark';

/** Resolved styles tagged with the option color key (`null` for `theme`). */
export interface ResolvedTheme extends ResolvedThemeStyles {
  color: string | null;
  role: ThemeRole;
}

/** A `[start, end, tokenId]` style run within one line. */
export type StyleRun = [number, number, number];

/**
 * Map each `$Token` slot to Shiki's `ThemedToken.type`.
 *
 * Values match TextMate's `StandardTokenType`: `0` other, `1` comment,
 * `2` string, `3` regex. Bracket matching and editor heuristics ignore brackets
 * in non-zero ranges.
 */
export const standardTypes: Uint8Array = new Uint8Array(tokenTypes.length);
for (let i = 0; i < tokenTypes.length; i++) {
  const name = tokenTypes[i];
  if (name === 'string.regex') standardTypes[i] = 3;
  else if (name === 'comment' || name.startsWith('comment.'))
    standardTypes[i] = 1;
  else if (name === 'string' || name.startsWith('string.'))
    standardTypes[i] = 2;
}

/** `var(--hls-<token>)` for a `$Token` slot, matching the Wasm emitter. */
function cssVariable(name: string): string {
  return `var(--hls-${name.replace(/[._]/g, '-')})`;
}

// Cache by object identity, not name: same-named themes may have different
// palettes, and a registered theme may be replaced by a new object with the
// same name.
const styleCache = new WeakMap<Theme, ResolvedThemeStyles>();

/**
 * Resolve a Zed theme or family to styles for JavaScript rendering.
 *
 * `styles` is indexed by token ID. Each slot is `{color, italic, weight}` or
 * `null`; CSS-variable themes set each color to its `var(--hls-*)` reference.
 * The result also includes foreground and background colors.
 */
export function resolveThemeStyles(
  theme: Theme | ThemeFamily
): ResolvedThemeStyles {
  const resolved = theme != null && 'themes' in theme ? theme.themes[0] : theme;
  if (
    resolved == null ||
    typeof resolved !== 'object' ||
    typeof resolved.name !== 'string' ||
    resolved.name === ''
  ) {
    throw new TypeError('invalid theme');
  }
  const cached = styleCache.get(resolved);
  if (cached !== undefined) return cached;
  const styles: (TokenStyle | null)[] = new Array(tokenTypes.length).fill(null);
  let fg: string | undefined;
  let bg: string | undefined;
  if (resolved.cssVariables === true) {
    for (let i = 1; i < tokenTypes.length; i++) {
      styles[i] = {
        color: cssVariable(tokenTypes[i]),
        italic: false,
        weight: 0,
      };
    }
    fg = cssVariable('foreground');
    bg = cssVariable('background');
  } else {
    const table = compileTheme(resolved);
    const hex = (n: number) => n.toString(16).padStart(2, '0');
    for (let i = 1; i < tokenTypes.length; i++) {
      const o = i * 5;
      const [r, g, b, a, s] = table.subarray(o, o + 5);
      if ((r | g | b | a) === 0) continue;
      const color = '#' + hex(r) + hex(g) + hex(b) + (a !== 0xff ? hex(a) : '');
      const style = {
        color,
        italic: (s & 0x10) !== 0,
        weight: (s & 0x0f) * 100,
      };
      if (tokenTypes[i] === 'foreground') fg = color;
      else if (tokenTypes[i] === 'background') bg = color;
      else styles[i] = style;
    }
  }
  const entry: ResolvedThemeStyles = { name: resolved.name, styles, fg, bg };
  styleCache.set(resolved, entry);
  return entry;
}

/**
 * Normalize Shiki-style options to a list of themes. With `themes`, the
 * `defaultColor` theme (Shiki's default is `light`) comes first and is applied
 * inline; the others follow in name order as custom properties.
 * `defaultColor: false` makes every theme a custom property, and
 * `'light-dark()'` pairs the `light` and `dark` themes.
 */
export function resolveOptionThemes(
  options: CodeToTokensOptions
): ResolvedTheme[] {
  if (options.themes != null) {
    const entries = Object.entries(options.themes)
      .filter(([, t]) => t != null)
      .sort(([a], [b]) => (a < b ? -1 : 1));
    if (entries.length === 0) throw new TypeError('themes must not be empty');
    const defaultColor = options.defaultColor ?? 'light';
    if (defaultColor === 'light-dark()') {
      const light = entries.find(([key]) => key === 'light');
      const dark = entries.find(([key]) => key === 'dark');
      if (light === undefined || dark === undefined) {
        throw new TypeError(
          "`themes` must contain `light` and `dark` when defaultColor is 'light-dark()'"
        );
      }
      return [light, dark].map(([color, theme]) => ({
        color,
        role: 'light-dark' as const,
        ...resolveThemeStyles(theme),
      }));
    }
    if (defaultColor !== false) {
      const at = entries.findIndex(([key]) => key === defaultColor);
      if (at < 0) {
        throw new TypeError(
          `\`themes\` must contain the defaultColor key \`${defaultColor}\``
        );
      }
      entries.unshift(...entries.splice(at, 1));
    }
    return entries.map(([color, theme], i) => ({
      color,
      role: defaultColor !== false && i === 0 ? 'default' : 'variable',
      ...resolveThemeStyles(theme),
    }));
  }
  return [
    { color: null, role: 'single', ...resolveThemeStyles(options.theme) },
  ];
}

/**
 * Split `(end, tokenId)` records into per-line style runs.
 *
 * A positive `maxLineLength` matches Shiki's `tokenizeMaxLineLength`: lines at
 * or above the limit become one unthemed run to avoid creating too many spans.
 */
export function splitRecordLines(
  code: string,
  recs: Uint32Array,
  count: number,
  resume?: { byte: number; char: number },
  maxLineLength?: number
): StyleRun[][] {
  const lines: StyleRun[][] = [];
  let line: StyleRun[] = [];
  let byte = resume?.byte ?? 0;
  let char = resume?.char ?? 0;
  // Start of the line being built; resume positions are line starts.
  let lineStart = char;
  const max = maxLineLength ?? 0;
  // Finish the pending line at endChar, excluding its terminator.
  const endLine = (endChar: number) => {
    lines.push(
      max > 0 && endChar - lineStart >= max ? [[lineStart, endChar, 0]] : line
    );
    line = [];
  };
  // Records are sorted by end; binary-search the first end greater than `byte`.
  let rec = 0;
  if (byte > 0) {
    let lo = 0;
    let hi = count;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (recs[mid * 2] > byte) hi = mid;
      else lo = mid + 1;
    }
    rec = lo;
  }
  const ascii = isAscii(code, byte, char, recs, count);
  // The resume point includes any multibyte prefix. Its byte-to-UTF-16 delta
  // converts record byte ends to string offsets.
  const charDelta = char - byte;
  for (; rec < count; rec++) {
    const bEnd = recs[rec * 2];
    if (bEnd <= byte) continue;
    const hl = recs[rec * 2 + 1];
    let cEnd;
    if (ascii) {
      cEnd = bEnd + charDelta;
    } else {
      cEnd = char;
      let b = byte;
      while (b < bEnd) {
        const cp = code.codePointAt(cEnd) ?? 0;
        if (cp <= 0x7f) b += 1;
        else if (cp <= 0x7ff) b += 2;
        else if (cp <= 0xffff) b += 3;
        else b += 4;
        cEnd += cp > 0xffff ? 2 : 1;
      }
    }
    // Split records that cross line endings.
    let start = char;
    for (;;) {
      const nl = code.indexOf('\n', start);
      if (nl === -1 || nl >= cEnd) break;
      let cut = nl;
      if (cut > start && code.charCodeAt(cut - 1) === 13) cut--;
      if (cut > start) line.push([start, cut, hl]);
      endLine(cut);
      lineStart = nl + 1;
      start = nl + 1;
    }
    if (cEnd > start) line.push([start, cEnd, hl]);
    byte = bEnd;
    char = cEnd;
  }
  endLine(char);
  return lines;
}

/**
 * Check the remaining range for ASCII in O(1).
 *
 * The final record ends at the input byte length. Equal remaining byte and
 * UTF-16 lengths mean the offsets also match, so no character walk is needed.
 */
function isAscii(
  code: string,
  byte: number,
  char: number,
  recs: Uint32Array,
  count: number
): boolean {
  if (count === 0) return true;
  return recs[(count - 1) * 2] - byte === code.length - char;
}

/**
 * Convert a `[start, end, tokenId]` run to a Shiki `ThemedToken`.
 *
 * `theme` uses `color` and `fontStyle`. `themes` uses an `htmlStyle` map: plain
 * `color`/`font-style`/`font-weight` for the `defaultColor` theme and
 * `${cssVariablePrefix}${themeColor}` custom properties for the rest, like
 * Shiki's dual-theme output.
 */
export function runToToken(
  code: string,
  run: StyleRun,
  themes: ResolvedTheme[],
  cssVariablePrefix: string
): ThemedToken {
  const [start, end, hl] = run;
  return rangeToToken(code, start, end, hl, themes, cssVariablePrefix);
}

/** Convert an offset range and token id to a Shiki `ThemedToken`. */
export function rangeToToken(
  code: string,
  start: number,
  end: number,
  hl: number,
  themes: ResolvedTheme[],
  cssVariablePrefix: string,
  offsetBase = 0
): ThemedToken {
  const token: ThemedToken = {
    content: code.slice(start, end),
    offset: start + offsetBase,
  };
  if (themes[0].role === 'single') {
    const { styles, fg } = themes[0];
    const style = styles[hl];
    token.color = style?.color ?? fg;
    let bits = 0;
    if (style?.italic === true) bits |= 1;
    if ((style?.weight ?? 0) >= 600) bits |= 2;
    token.fontStyle = bits;
  } else if (themes[0].role === 'light-dark') {
    token.htmlStyle = lightDarkStyle(themes, hl, cssVariablePrefix);
  } else {
    const htmlStyle: Record<string, string> = {};
    for (const { color, role, styles, fg } of themes) {
      const style = styles[hl];
      // the default theme is applied inline; the others are custom
      // properties the page switches between
      const plain = role === 'default';
      htmlStyle[plain ? 'color' : cssVariablePrefix + color] =
        style?.color ?? fg ?? 'inherit';
      if (style?.italic === true) {
        htmlStyle[
          plain ? 'font-style' : `${cssVariablePrefix}${color}-font-style`
        ] = 'italic';
      }
      if (style != null && style.weight !== 0) {
        htmlStyle[
          plain ? 'font-weight' : `${cssVariablePrefix}${color}-font-weight`
        ] = String(style.weight);
      }
    }
    token.htmlStyle = htmlStyle;
  }
  const type = standardTypes[hl];
  if (type !== 0) token.type = type;
  return token;
}

/**
 * The `htmlStyle` of a token under `defaultColor: 'light-dark()'`: the two
 * colors merge into one CSS `light-dark()` value, and font settings stay plain
 * when both themes agree or become per-theme custom properties otherwise.
 */
function lightDarkStyle(
  themes: ResolvedTheme[],
  hl: number,
  cssVariablePrefix: string
): Record<string, string> {
  const [light, dark] = themes;
  const a = light.styles[hl];
  const b = dark.styles[hl];
  const ac = a?.color ?? light.fg ?? 'inherit';
  const bc = b?.color ?? dark.fg ?? 'inherit';
  const htmlStyle: Record<string, string> = {
    color: ac === bc ? ac : `light-dark(${ac}, ${bc})`,
  };
  const ai = a?.italic === true;
  const bi = b?.italic === true;
  if (ai && bi) htmlStyle['font-style'] = 'italic';
  else {
    if (ai) htmlStyle[`${cssVariablePrefix}light-font-style`] = 'italic';
    if (bi) htmlStyle[`${cssVariablePrefix}dark-font-style`] = 'italic';
  }
  const aw = a?.weight ?? 0;
  const bw = b?.weight ?? 0;
  if (aw !== 0 && aw === bw) htmlStyle['font-weight'] = String(aw);
  else {
    if (aw !== 0)
      htmlStyle[`${cssVariablePrefix}light-font-weight`] = String(aw);
    if (bw !== 0)
      htmlStyle[`${cssVariablePrefix}dark-font-weight`] = String(bw);
  }
  return htmlStyle;
}

/** Convert UTF-16 token records with `0xffffffff` line markers to tokens. */
export function lineRecordsToTokens(
  code: string,
  recs: Uint32Array,
  count: number,
  themes: ResolvedTheme[],
  cssVariablePrefix: string,
  maxLineLength?: number,
  offsetBase = 0
): ThemedToken[][] {
  const lines: ThemedToken[][] = [];
  let line: ThemedToken[] = [];
  let start = 0;
  let lineStart = 0;
  const max = maxLineLength ?? 0;
  for (let rec = 0; rec < count; rec++) {
    const end = recs[rec * 2];
    const hl = recs[rec * 2 + 1];
    if (hl === 0xffffffff) {
      if (max > 0 && start - lineStart >= max) {
        line = [
          rangeToToken(
            code,
            lineStart,
            start,
            0,
            themes,
            cssVariablePrefix,
            offsetBase
          ),
        ];
      }
      lines.push(line);
      line = [];
      start = end;
      lineStart = end;
    } else if (end > start) {
      line.push(
        rangeToToken(
          code,
          start,
          end,
          hl,
          themes,
          cssVariablePrefix,
          offsetBase
        )
      );
      start = end;
    }
  }
  if (max > 0 && start - lineStart >= max) {
    line = [
      rangeToToken(
        code,
        lineStart,
        start,
        0,
        themes,
        cssVariablePrefix,
        offsetBase
      ),
    ];
  }
  lines.push(line);
  return lines;
}

/**
 * Build the `fg`, `bg`, `themeName`, and `rootStyle` block of a Shiki
 * `TokensResult`. With `themes`, `fg` and `bg` are CSS declaration lists: the
 * `defaultColor` theme's plain color first, then one custom property per other
 * theme. `rootStyle` is set only when no theme is applied inline, so the
 * `<pre>` style is either `rootStyle` or `background-color:bg;color:fg`.
 */
export function themeMeta(
  themes: ResolvedTheme[],
  cssVariablePrefix: string
): Pick<TokensResult, 'fg' | 'bg' | 'themeName' | 'rootStyle'> {
  if (themes[0].role === 'single') {
    return {
      fg: themes[0].fg,
      bg: themes[0].bg,
      themeName: themes[0].name,
    };
  }
  const themeName = `highlights-themes ${themes.map((t) => t.name).join(' ')}`;
  if (themes[0].role === 'light-dark') {
    const pair = (a: string | undefined, b: string | undefined) => {
      const x = a ?? 'inherit';
      const y = b ?? 'inherit';
      return x === y ? x : `light-dark(${x}, ${y})`;
    };
    return {
      fg: pair(themes[0].fg, themes[1].fg),
      bg: pair(themes[0].bg, themes[1].bg),
      themeName,
    };
  }
  const fg = themes
    .map((t) =>
      t.role === 'default'
        ? (t.fg ?? 'inherit')
        : `${cssVariablePrefix}${t.color}:${t.fg ?? 'inherit'}`
    )
    .join(';');
  const bg = themes
    .map((t) =>
      t.role === 'default'
        ? (t.bg ?? 'inherit')
        : `${cssVariablePrefix}${t.color}-bg:${t.bg ?? 'inherit'}`
    )
    .join(';');
  return {
    fg,
    bg,
    themeName,
    rootStyle: themes[0].role === 'default' ? undefined : `${fg};${bg}`,
  };
}
