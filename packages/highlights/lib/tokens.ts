import type { CodeToHtmlOptions, ThemedToken, TokensResult } from './index';
import type { PreparedTheme } from './theme';
import {
  escapeAttribute,
  prepareTheme,
  themeTableBytes,
  variableRootTag,
  variableSpanTag,
} from './theme';
import tokenTypes from './token-types';

const enc = new TextEncoder();

/**
 * How one resolved theme reaches the output: `single` for the `theme` option
 * (plain `color`/`fontStyle`), `default` for the `defaultColor` theme of a
 * `themes` set (plain `color`, `font-style`, `font-weight` in `htmlStyle`),
 * `variable` for the other themes of a set (custom properties), and
 * `light-dark` for the `light`/`dark` pair merged into CSS `light-dark()`.
 */
export type ThemeRole = 'single' | 'default' | 'variable' | 'light-dark';

/**
 * A prepared theme's rendering fields tagged with the option color key
 * (`null` for `theme`) and its role in the output.
 */
export interface ResolvedTheme extends Pick<
  PreparedTheme,
  'name' | 'styles' | 'fg' | 'bg' | 'table'
> {
  color: string | null;
  role: ThemeRole;
}

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

// Multi-theme tokens with the same token id share styles for their theme set.
const htmlStyleCache = new WeakMap<
  ResolvedTheme[],
  Map<string, Record<string, string>[]>
>();

// Packed theme sets for the Wasm multi-theme emitter, one per set and
// prefix; `null` records a set the emitter cannot render.
const blobCache = new WeakMap<
  ResolvedTheme[],
  Map<string, Uint8Array | null>
>();
let nextBlobId = 1;

// Tag replacements for multi-theme HTML the emitter cannot render (a member
// with Display P3 or CSS-variable colors), one map per theme set and prefix.
const htmlTagsCache = new WeakMap<
  ResolvedTheme[],
  Map<string, Map<string, string>>
>();

// Resolved theme sets, so the styles and HTML tags derived from a set (keyed
// by the set's identity above) survive across calls that name the same
// themes again. `prepareTheme` returns one object per theme (and per prefix
// for CSS-variable themes), so a set is identified by those objects plus the
// color key and role the options give each one. Entries hang off the first
// prepared theme and are only reachable while it is. Keep at most 128 sets
// per first theme so a fixed theme cannot retain unlimited discarded partners.
const resolvedSetCache = new WeakMap<
  PreparedTheme,
  Map<string, ResolvedTheme[]>
>();
const preparedIds = new WeakMap<PreparedTheme, number>();
let nextPreparedId = 0;

/** A stable number for a prepared theme, assigned on first use. */
function preparedId(prepared: PreparedTheme): number {
  let id = preparedIds.get(prepared);
  if (id === undefined) {
    id = nextPreparedId++;
    preparedIds.set(prepared, id);
  }
  return id;
}

/** Tag one prepared theme with its color key and role. */
function tagTheme(
  { name, styles, fg, bg, table }: PreparedTheme,
  color: string | null,
  role: ThemeRole
): ResolvedTheme {
  return { color, role, name, styles, fg, bg, table };
}

/**
 * Normalize Shiki-style options to a list of themes. With `themes`, the
 * `defaultColor` theme (Shiki's default is `light`) comes first and is applied
 * inline; the others follow in name order as custom properties.
 * `defaultColor: false` makes every theme a custom property, and
 * `'light-dark()'` pairs the `light` and `dark` themes. Recently cached `themes`
 * options return the same list object, so caches keyed by it are shared.
 */
export function resolveOptionThemes(
  options: CodeToHtmlOptions
): ResolvedTheme[] {
  const { cssVariablePrefix } = options;
  if (options.themes == null) {
    return [
      tagTheme(prepareTheme(options.theme, cssVariablePrefix), null, 'single'),
    ];
  }
  const entries = Object.entries(options.themes)
    .filter(([, t]) => t != null)
    .sort(([a], [b]) => (a < b ? -1 : 1));
  if (entries.length === 0) throw new TypeError('themes must not be empty');
  const defaultColor = options.defaultColor ?? 'light';
  let roles: ThemeRole[];
  if (defaultColor === 'light-dark()') {
    const light = entries.find(([key]) => key === 'light');
    const dark = entries.find(([key]) => key === 'dark');
    if (light === undefined || dark === undefined) {
      throw new TypeError(
        "`themes` must contain `light` and `dark` when defaultColor is 'light-dark()'"
      );
    }
    entries.splice(0, entries.length, light, dark);
    roles = ['light-dark', 'light-dark'];
  } else {
    if (defaultColor !== false) {
      const at = entries.findIndex(([key]) => key === defaultColor);
      if (at < 0) {
        throw new TypeError(
          `\`themes\` must contain the defaultColor key \`${defaultColor}\``
        );
      }
      entries.unshift(...entries.splice(at, 1));
    }
    roles = entries.map((_, i) =>
      defaultColor !== false && i === 0 ? 'default' : 'variable'
    );
  }
  const prepared = entries.map(([, theme]) =>
    prepareTheme(theme, cssVariablePrefix)
  );
  const key = JSON.stringify(
    entries.map(([color], i) => [preparedId(prepared[i]), roles[i], color])
  );
  let sets = resolvedSetCache.get(prepared[0]);
  const cached = sets?.get(key);
  if (cached !== undefined) return cached;
  const themes = entries.map(([color], i) =>
    tagTheme(prepared[i], color, roles[i])
  );
  if (sets === undefined) {
    sets = new Map();
    resolvedSetCache.set(prepared[0], sets);
  }
  sets.set(key, themes);
  if (sets.size > 128) {
    const oldest = sets.keys().next().value;
    if (oldest !== undefined) sets.delete(oldest);
  }
  return themes;
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
  } else {
    token.htmlStyle = themeHtmlStyle(themes, hl, cssVariablePrefix);
  }
  const type = standardTypes[hl];
  if (type !== 0) token.type = type;
  return token;
}

/**
 * The `htmlStyle` map of token id `hl` under a multi-theme set: the default
 * theme's plain `color`, `font-style`, and `font-weight`, the other themes as
 * custom properties, or one `light-dark()` merge. Built once per set, prefix,
 * and token id and shared by every token and HTML tag with that id.
 */
export function themeHtmlStyle(
  themes: ResolvedTheme[],
  hl: number,
  cssVariablePrefix: string
): Record<string, string> {
  let prefixes = htmlStyleCache.get(themes);
  if (prefixes === undefined) {
    prefixes = new Map();
    htmlStyleCache.set(themes, prefixes);
  }
  let slots = prefixes.get(cssVariablePrefix);
  if (slots === undefined) {
    slots = [];
    prefixes.set(cssVariablePrefix, slots);
  }
  let htmlStyle = slots[hl];
  if (htmlStyle === undefined) {
    if (themes[0].role === 'light-dark') {
      htmlStyle = lightDarkStyle(themes, hl, cssVariablePrefix);
    } else {
      htmlStyle = {};
      for (const { color, role, styles, fg } of themes) {
        const style = styles[hl];
        // The default theme is applied inline; the others are custom
        // properties the page switches between.
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
    }
    slots[hl] = htmlStyle;
  }
  return htmlStyle;
}

/**
 * Pack a theme set for the Wasm multi-theme HTML emitter (mode 2), which
 * writes every theme's colors and font settings into each span itself. The
 * layout, mirrored by `$multiRec` in src/emit.wat:
 *
 *     0   u8  slot count       1  u8  kind: 0 custom properties, 1 light-dark()
 *     4   u32 tables offset    8  u32 span reserve    12  u32 prologue reserve
 *     16  u32 set id
 *     32  per slot, 16 bytes: u32 name offset, u32 name length, u32 inline
 *     then one padded theme table per slot, then the name bytes
 *
 * A slot's name is its escaped custom property (`--hls-dark`); the inline
 * slot (the `defaultColor` theme) has none. The reserves bound the output one
 * span opener or the `<pre>` opener can add, since names are host-sized. The
 * set id is unique per blob, so an instance's opener cache is keyed by it.
 * Built once per set and prefix. Returns `undefined` for a set the emitter
 * cannot pack because a member has no theme table (Display P3 or CSS-variable
 * colors); HTML output then falls back to `multiThemeHtmlTags`.
 */
export function multiThemeBlob(
  themes: ResolvedTheme[],
  cssVariablePrefix: string
): Uint8Array | undefined {
  let prefixes = blobCache.get(themes);
  if (prefixes === undefined) {
    prefixes = new Map();
    blobCache.set(themes, prefixes);
  }
  const cached = prefixes.get(cssVariablePrefix);
  if (cached !== undefined) return cached ?? undefined;
  const count = themes.length;
  const packable = count <= 255 && themes.every((t) => t.table !== undefined);
  if (!packable) {
    prefixes.set(cssVariablePrefix, null);
    return undefined;
  }
  const names = themes.map((t) =>
    t.role === 'default'
      ? new Uint8Array(0)
      : enc.encode(escapeAttribute(`${cssVariablePrefix}${t.color}`))
  );
  const tablesOffset = 32 + 16 * count;
  const namesOffset = tablesOffset + themeTableBytes * count;
  let spanReserve = 64;
  let prologueReserve = 128;
  let nameBytes = 0;
  for (const { length } of names) {
    // per slot: `NAME:#rrggbbaa;`, `NAME-font-style:italic;`, and
    // `NAME-font-weight:N00;` (or the light-dark() forms) for a span;
    // `NAME-bg:#rrggbbaa;` and `NAME:#rrggbbaa;` for the root
    spanReserve += 64 + 3 * length;
    prologueReserve += 48 + 2 * length;
    nameBytes += length;
  }
  const blob = new Uint8Array(namesOffset + nameBytes);
  const dv = new DataView(blob.buffer);
  blob[0] = count;
  blob[1] = themes[0].role === 'light-dark' ? 1 : 0;
  dv.setUint32(4, tablesOffset, true);
  dv.setUint32(8, spanReserve, true);
  dv.setUint32(12, prologueReserve, true);
  dv.setUint32(16, nextBlobId++, true);
  let nameOffset = namesOffset;
  for (let i = 0; i < count; i++) {
    const slot = 32 + 16 * i;
    dv.setUint32(slot, nameOffset, true);
    dv.setUint32(slot + 4, names[i].length, true);
    dv.setUint32(slot + 8, themes[i].role === 'default' ? 1 : 0, true);
    blob.set(themes[i].table as Uint8Array, tablesOffset + themeTableBytes * i);
    blob.set(names[i], nameOffset);
    nameOffset += names[i].length;
  }
  prefixes.set(cssVariablePrefix, blob);
  return blob;
}

/**
 * Tag replacements for multi-theme HTML the Wasm emitter cannot pack. Wasm
 * renders the set through the CSS-variable emitter with an empty prefix, so
 * its openers read `var(<token>)`; each maps to an opener whose style
 * attribute serializes the token's `htmlStyle` (the map `codeToTokens`
 * returns for that id), and the `<pre>` opener carries the root colors
 * `themeMeta` reports. Built once per set and prefix. Prefixes and theme keys
 * are user strings, so attribute values are escaped.
 */
export function multiThemeHtmlTags(
  themes: ResolvedTheme[],
  cssVariablePrefix: string
): Map<string, string> {
  let prefixes = htmlTagsCache.get(themes);
  if (prefixes === undefined) {
    prefixes = new Map();
    htmlTagsCache.set(themes, prefixes);
  }
  let tags = prefixes.get(cssVariablePrefix);
  if (tags !== undefined) return tags;
  tags = new Map();
  const { fg, bg, rootStyle } = themeMeta(themes, cssVariablePrefix);
  tags.set(
    variableRootTag,
    `<pre class="highlights" style="${escapeAttribute(
      rootStyle ?? `background-color:${bg};color:${fg}`
    )}">`
  );
  for (let hl = 1; hl < tokenTypes.length; hl++) {
    const htmlStyle = themeHtmlStyle(themes, hl, cssVariablePrefix);
    let css = '';
    for (const property in htmlStyle) {
      css += `${css === '' ? '' : ';'}${property}:${htmlStyle[property]}`;
    }
    tags.set(variableSpanTag(hl), `<span style="${escapeAttribute(css)}">`);
  }
  prefixes.set(cssVariablePrefix, tags);
  return tags;
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
  const ac = a?.color ?? light.fg ?? 'currentcolor';
  const bc = b?.color ?? dark.fg ?? 'currentcolor';
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
  for (let rec = 0; rec < recs.length; rec += 2) {
    const end = recs[rec];
    const hl = recs[rec + 1];
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
      // Overlong lines collapse below; skip tokens that would be discarded.
      if (!(max > 0 && end - lineStart >= max)) {
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
      }
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
    const pair = (
      a: string | undefined,
      b: string | undefined,
      fallback: string
    ) => {
      const x = a ?? fallback;
      const y = b ?? fallback;
      return x === y ? x : `light-dark(${x}, ${y})`;
    };
    return {
      fg: pair(themes[0].fg, themes[1].fg, 'currentcolor'),
      bg: pair(themes[0].bg, themes[1].bg, 'transparent'),
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
