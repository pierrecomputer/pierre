import type {
  CodeToHastOptions,
  CodeToTokensOptions,
  Decoration,
  HastElement,
  HastRoot,
  HastText,
  Theme,
  ThemedToken,
  ThemeFamily,
  TokensResult,
  TransformerContext,
  TransformerContextCommon,
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

/** Resolved styles tagged with the option color key (`null` for `theme`). */
export interface ResolvedTheme extends ResolvedThemeStyles {
  color: string | null;
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
 * Normalize Shiki-style options to a list of themes.
 */
export function resolveOptionThemes(
  options: CodeToTokensOptions
): ResolvedTheme[] {
  if (options.themes != null) {
    const entries = Object.entries(options.themes)
      .filter(([, t]) => t != null)
      .sort(([a], [b]) => (a < b ? -1 : 1));
    if (entries.length === 0) throw new TypeError('themes must not be empty');
    return entries.map(([color, theme]) => ({
      color,
      ...resolveThemeStyles(theme),
    }));
  }
  return [{ color: null, ...resolveThemeStyles(options.theme) }];
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
 * `theme` uses `color` and `fontStyle`. `themes` uses an `htmlStyle` map keyed by
 * `${cssVariablePrefix}${themeColor}`, like Shiki's dual-theme output.
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
  if (themes.length === 1 && themes[0].color === null) {
    const { styles, fg } = themes[0];
    const style = styles[hl];
    token.color = style?.color ?? fg;
    let bits = 0;
    if (style?.italic === true) bits |= 1;
    if ((style?.weight ?? 0) >= 600) bits |= 2;
    token.fontStyle = bits;
  } else {
    const htmlStyle: Record<string, string> = {};
    for (const { color, styles, fg } of themes) {
      const style = styles[hl];
      htmlStyle[cssVariablePrefix + color] = style?.color ?? fg ?? 'inherit';
      if (style?.italic === true) {
        htmlStyle[`${cssVariablePrefix}${color}-font-style`] = 'italic';
      }
      if (style != null && style.weight !== 0) {
        htmlStyle[`${cssVariablePrefix}${color}-font-weight`] = String(
          style.weight
        );
      }
    }
    token.htmlStyle = htmlStyle;
  }
  const type = standardTypes[hl];
  if (type !== 0) token.type = type;
  return token;
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

/** Convert UTF-16 line records to runs and source line starts for HAST. */
export function lineRecordsToRuns(
  recs: Uint32Array,
  count: number,
  maxLineLength?: number
): { lineRuns: StyleRun[][]; lineStarts: number[] } {
  const lineRuns: StyleRun[][] = [];
  const lineStarts = [0];
  let line: StyleRun[] = [];
  let start = 0;
  let lineStart = 0;
  const max = maxLineLength ?? 0;
  for (let rec = 0; rec < count; rec++) {
    const end = recs[rec * 2];
    const hl = recs[rec * 2 + 1];
    if (hl === 0xffffffff) {
      lineRuns.push(
        max > 0 && start - lineStart >= max ? [[lineStart, start, 0]] : line
      );
      line = [];
      start = end;
      lineStart = end;
      lineStarts.push(end);
    } else if (end > start) {
      line.push([start, end, hl]);
      start = end;
    }
  }
  lineRuns.push(
    max > 0 && start - lineStart >= max ? [[lineStart, start, 0]] : line
  );
  return { lineRuns, lineStarts };
}

/**
 * Build the `fg`, `bg`, `themeName`, and `rootStyle` block of a Shiki
 * `TokensResult`. `themes` uses CSS declaration lists.
 */
export function themeMeta(
  themes: ResolvedTheme[],
  cssVariablePrefix: string
): Pick<TokensResult, 'fg' | 'bg' | 'themeName' | 'rootStyle'> {
  if (themes.length === 1 && themes[0].color === null) {
    return {
      fg: themes[0].fg,
      bg: themes[0].bg,
      themeName: themes[0].name,
    };
  }
  const fg = themes
    .map((t) => `${cssVariablePrefix}${t.color}:${t.fg ?? 'inherit'}`)
    .join(';');
  const bg = themes
    .map((t) => `${cssVariablePrefix}${t.color}-bg:${t.bg ?? 'inherit'}`)
    .join(';');
  return {
    fg,
    bg,
    themeName: `highlights-themes ${themes.map((t) => t.name).join(' ')}`,
    rootStyle: `${fg};${bg}`,
  };
}

/** Render a token's inline `style`, matching Shiki's span output. */
function tokenStyle(token: ThemedToken): string {
  if (token.htmlStyle != null) {
    return Object.entries(token.htmlStyle)
      .map(([k, v]) => `${k}:${v}`)
      .join(';');
  }
  const parts = [];
  if (token.color != null) parts.push(`color:${token.color}`);
  if (token.bgColor != null) parts.push(`background-color:${token.bgColor}`);
  const fontStyle = token.fontStyle ?? 0;
  if ((fontStyle & 1) !== 0) parts.push('font-style:italic');
  if ((fontStyle & 2) !== 0) parts.push('font-weight:bold');
  const decorations = [];
  if ((fontStyle & 4) !== 0) decorations.push('underline');
  if ((fontStyle & 8) !== 0) decorations.push('line-through');
  if (decorations.length > 0) {
    parts.push(`text-decoration:${decorations.join(' ')}`);
  }
  return parts.join(';');
}

/**
 * Shiki's `addClassToHast` context helper: append classes to a HAST element,
 * converting an existing string class to an array.
 */
export function addClassToHast(
  node: HastElement,
  className: string | string[]
): HastElement {
  if (className == null || className === '') return node;
  node.properties ??= {};
  const existing = node.properties.class;
  let classes: (string | number)[];
  if (typeof existing === 'string') classes = existing.split(/\s+/g);
  else if (Array.isArray(existing)) classes = existing;
  else classes = [];
  const targets = Array.isArray(className)
    ? className
    : className.split(/\s+/g);
  for (const c of targets) {
    if (c !== '' && classes.includes(c) === false) classes.push(c);
  }
  node.properties.class = classes;
  return node;
}

/** A decoration's column range on one line, `Infinity` when it runs past it. */
interface LineDecoration {
  from: number;
  to: number;
  dec: Decoration;
}

/**
 * Normalize Shiki `DecorationItem` positions (`offset` or `{line, character}`)
 * into per-line `[start, end)` columns keyed by line index.
 */
function decorationsByLine(
  decorations: Decoration[],
  starts: number[]
): Map<number, LineDecoration[]> {
  const locate = (pos: number | { line: number; character: number }) => {
    if (typeof pos === 'number') {
      // Binary-search the line containing the absolute offset.
      let lo = 0;
      let hi = starts.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (starts[mid] <= pos) lo = mid;
        else hi = mid - 1;
      }
      return { line: lo, character: pos - starts[lo] };
    }
    return pos;
  };
  const byLine = new Map<number, LineDecoration[]>();
  for (const dec of decorations) {
    const start = locate(dec.start);
    const end = locate(dec.end);
    for (let line = start.line; line <= end.line; line++) {
      const from = line === start.line ? start.character : 0;
      const to = line === end.line ? end.character : Infinity;
      let list = byLine.get(line);
      if (list === undefined) byLine.set(line, (list = []));
      list.push({ from, to, dec });
    }
  }
  return byLine;
}

/** Split per-line runs so decoration and token edges align. */
function splitRunsAt(runs: StyleRun[], cuts: number[]): StyleRun[] {
  const out: StyleRun[] = [];
  for (const [start, end, hl] of runs) {
    let s = start;
    for (const cut of cuts) {
      if (cut > s && cut < end) {
        out.push([s, cut, hl]);
        s = cut;
      }
    }
    out.push([s, end, hl]);
  }
  return out;
}

/**
 * Build Shiki-compatible HAST from line runs, then run transformer hooks for
 * diff renderers and other Shiki integrations.
 */
export function buildHast(
  code: string,
  lineRuns: StyleRun[][],
  lineStarts: number[],
  themes: ResolvedTheme[],
  options: CodeToHastOptions,
  common: Pick<TransformerContextCommon, 'codeToHast' | 'codeToTokens' | 'meta'>
): HastRoot {
  const cssVariablePrefix = options.cssVariablePrefix ?? '--hls-';
  const transformers = options.transformers ?? [];
  const themeInfo = themeMeta(themes, cssVariablePrefix);
  const decorations =
    options.decorations != null && options.decorations.length > 0
      ? decorationsByLine(options.decorations, lineStarts)
      : undefined;

  // Build per-line tokens after splitting runs so decoration and span edges align.
  let lines = lineRuns.map((runs, lineIndex) => {
    let split = runs;
    const lineDecs = decorations?.get(lineIndex);
    if (lineDecs !== undefined) {
      const lineStart = lineStarts[lineIndex];
      const cuts = [];
      for (const { from, to } of lineDecs) {
        if (Number.isFinite(from)) cuts.push(lineStart + from);
        if (Number.isFinite(to)) cuts.push(lineStart + to);
      }
      cuts.sort((a, b) => a - b);
      split = splitRunsAt(runs, cuts);
    }
    return split.map((run) => runToToken(code, run, themes, cssVariablePrefix));
  });

  // Build shell nodes first so every hook can reach them through context getters,
  // matching Shiki's `tokensToHast`.
  const codeChildren: (HastElement | HastText)[] = [];
  const lineNodes: HastElement[] = [];
  let codeNode: HastElement = {
    type: 'element',
    tagName: 'code',
    properties: {},
    children: codeChildren,
  };
  const preProperties: HastElement['properties'] = {
    class: `shiki ${themeInfo.themeName}`,
    style:
      themeInfo.rootStyle ??
      `background-color:${themeInfo.bg};color:${themeInfo.fg}`,
    tabindex: '0',
  };
  for (const [key, value] of Object.entries(options.meta ?? {})) {
    if (!key.startsWith('_')) preProperties[key] = value as string;
  }
  let preNode: HastElement = {
    type: 'element',
    tagName: 'pre',
    properties: preProperties,
    children: [],
  };
  let root: HastRoot = { type: 'root', children: [] };
  const context: TransformerContext = {
    ...common,
    structure: 'classic',
    addClassToHast,
    source: code,
    options,
    get tokens() {
      return lines;
    },
    get root() {
      return root;
    },
    get pre() {
      return preNode;
    },
    get code() {
      return codeNode;
    },
    get lines() {
      return lineNodes;
    },
  };
  for (const t of transformers) {
    if (t.tokens != null) lines = t.tokens.call(context, lines) ?? lines;
  }

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const tokens = lines[lineIndex];
    let lineNode: HastElement = {
      type: 'element',
      tagName: 'span',
      properties: { class: 'line' },
      children: [],
    };
    let col = 0;
    for (const token of tokens) {
      let span: HastElement = {
        type: 'element',
        tagName: 'span',
        properties: { ...token.htmlAttrs },
        children: [{ type: 'text', value: token.content }],
      };
      const style = tokenStyle(token);
      if (style !== '') span.properties.style = style;
      for (const t of transformers) {
        if (t.span != null) {
          span =
            t.span.call(context, span, lineIndex + 1, col, lineNode, token) ??
            span;
        }
      }
      lineNode.children.push(span);
      col += token.content.length;
    }
    const lineDecs = decorations?.get(lineIndex);
    if (lineDecs !== undefined) {
      // Apply inner ranges first so every edge stays on a child boundary.
      const ranges = lineDecs
        .slice()
        .sort((a, b) => (b.from !== a.from ? b.from - a.from : a.to - b.to));
      for (const { from, to, dec } of ranges) {
        wrapDecoration(lineNode, from, to, dec);
      }
    }
    for (const t of transformers) {
      if (t.line != null) {
        lineNode = t.line.call(context, lineNode, lineIndex + 1) ?? lineNode;
      }
    }
    lineNodes.push(lineNode);
    codeChildren.push(lineNode);
    if (lineIndex < lines.length - 1) {
      codeChildren.push({ type: 'text', value: '\n' });
    }
  }

  for (const t of transformers) {
    if (t.code != null) codeNode = t.code.call(context, codeNode) ?? codeNode;
  }
  preNode.children.push(codeNode);
  for (const t of transformers) {
    if (t.pre != null) preNode = t.pre.call(context, preNode) ?? preNode;
  }
  root.children.push(preNode);
  for (const t of transformers) {
    if (t.root != null) root = t.root.call(context, root) ?? root;
  }
  return root;
}

/** Total text length of a HAST node: text nodes and element subtrees. */
function textLength(node: HastElement | HastText): number {
  if (node.type === 'text') return node.value.length;
  let length = 0;
  for (const child of node.children) length += textLength(child);
  return length;
}

/**
 * Wrap children covering `[from, to)` in an element with the decoration's
 * properties, matching Shiki's decoration behavior.
 *
 * Spans are split at decoration edges first. Resolve columns from current child
 * text because an earlier nested decoration may have replaced several spans
 * with one wrapper.
 */
function wrapDecoration(
  lineNode: HastElement,
  from: number,
  to: number,
  dec: Decoration
): void {
  let first = -1;
  let last = -1;
  let col = 0;
  const children = lineNode.children;
  for (let i = 0; i < children.length; i++) {
    const start = col;
    const end = (col += textLength(children[i]));
    if (end <= from || start >= to) continue;
    if (first === -1) first = i;
    last = i;
  }
  if (first === -1) return;
  const wrapper: HastElement = {
    type: 'element',
    tagName: dec.tagName ?? 'span',
    properties: { ...dec.properties },
    children: children.slice(first, last + 1),
  };
  children.splice(first, last + 1 - first, wrapper);
}
