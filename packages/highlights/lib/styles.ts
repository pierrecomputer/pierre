import type { ThemedToken } from './index';
import tokenTypes from './token-types';
import { rangeToToken, type ResolvedTheme } from './tokens';

const foreground = tokenTypes.indexOf('foreground');
const background = tokenTypes.indexOf('background');
const BOLD = 1;
const DIM = 2;
const ITALIC = 4;
const UNDERLINE = 8;
const REVERSE = 16;
const STRIKE = 32;
type StyledToken = Pick<
  ThemedToken,
  'color' | 'bgColor' | 'fontStyle' | 'htmlStyle'
>;

const styleCache = new WeakMap<
  ResolvedTheme[],
  { prefix: string; styles: Map<string, StyledToken> }
>();

export function styledTokens(
  code: string,
  recs: Uint32Array,
  themes: ResolvedTheme[],
  cssVariablePrefix: string,
  maxLineLength: number | undefined,
  offsetBase: number
): ThemedToken[][] {
  const lines: ThemedToken[][] = [];
  let line: ThemedToken[] = [];
  let cache = styleCache.get(themes);
  if (cache?.prefix !== cssVariablePrefix) {
    cache = { prefix: cssVariablePrefix, styles: new Map() };
    styleCache.set(themes, cache);
  }
  const styles = cache.styles;
  let start = 0;
  let last: ThemedToken | undefined;
  let lastKey: string | number | undefined;
  for (let rec = 2; rec < recs.length; rec += 4) {
    const end = recs[rec];
    const kind = recs[rec + 1];
    if (kind === 0xffffffff) {
      lines.push(line);
      line = [];
      last = undefined;
    } else if (kind !== 0xfffffffe && end > start) {
      if ((kind & 0xffffffc0) >>> 0 === 0x80000000) {
        const flags = kind & 63;
        const fg = recs[rec + 2];
        const bg = recs[rec + 3] | 0;
        const key = `${fg},${bg},${flags}`;
        let style = styles.get(key);
        if (style === undefined) {
          const fontStyle =
            ((flags & ITALIC) !== 0 ? 1 : 0) |
            ((flags & BOLD) !== 0 ? 2 : 0) |
            ((flags & UNDERLINE) !== 0 ? 4 : 0) |
            ((flags & STRIKE) !== 0 ? 8 : 0);
          const colors = themes.map((theme) => {
            let color =
              fg === foreground
                ? theme.fg
                : fg === background
                  ? theme.bg
                  : fg < 0x1000000
                    ? theme.styles[fg]?.color
                    : `#${(fg & 0xffffff).toString(16).padStart(6, '0')}`;
            let bgColor =
              bg < 0
                ? undefined
                : bg < 0x1000000
                  ? theme.styles[bg]?.color
                  : `#${(bg & 0xffffff).toString(16).padStart(6, '0')}`;
            if ((flags & REVERSE) !== 0) {
              bgColor = color;
              color =
                bg < 0
                  ? theme.bg
                  : bg < 0x1000000
                    ? theme.styles[bg]?.color
                    : `#${(bg & 0xffffff).toString(16).padStart(6, '0')}`;
            }
            if ((flags & DIM) !== 0 && color !== undefined) {
              color = !color.startsWith('#')
                ? `color-mix(in srgb, ${color} 50%, transparent)`
                : color.length === 9
                  ? color.slice(0, 7) +
                    Math.round(parseInt(color.slice(7), 16) / 2)
                      .toString(16)
                      .padStart(2, '0')
                  : `${color}80`;
            }
            return [color, bgColor];
          });
          if (themes[0].role === 'single') {
            const [color, bgColor] = colors[0];
            style =
              bgColor === undefined
                ? { color, fontStyle }
                : { color, bgColor, fontStyle };
          } else {
            const font: [property: string, value: string][] = [];
            if ((fontStyle & 1) !== 0) font.push(['font-style', 'italic']);
            if ((fontStyle & 2) !== 0) font.push(['font-weight', 'bold']);
            if ((fontStyle & 12) !== 0) {
              font.push([
                'text-decoration',
                (fontStyle & 12) === 12
                  ? 'underline line-through'
                  : (fontStyle & 4) !== 0
                    ? 'underline'
                    : 'line-through',
              ]);
            }
            const htmlStyle: Record<string, string> = {};
            if (themes[0].role === 'light-dark') {
              const [[a, ab], [b, bb]] = colors;
              const ac = a ?? 'currentcolor';
              const bc = b ?? 'currentcolor';
              htmlStyle.color = ac === bc ? ac : `light-dark(${ac}, ${bc})`;
              if (ab !== undefined || bb !== undefined) {
                const x = ab ?? 'transparent';
                const y = bb ?? 'transparent';
                htmlStyle['background-color'] =
                  x === y ? x : `light-dark(${x}, ${y})`;
              }
              for (const [property, value] of font) {
                htmlStyle[property] = value;
              }
            } else {
              for (let i = 0; i < themes.length; i++) {
                const [color, bgColor] = colors[i];
                const plain = themes[i].role === 'default';
                const name = `${cssVariablePrefix}${themes[i].color}`;
                htmlStyle[plain ? 'color' : name] = color ?? 'inherit';
                if (bgColor !== undefined) {
                  htmlStyle[plain ? 'background-color' : `${name}-bg`] =
                    bgColor;
                }
                for (const [property, value] of font) {
                  htmlStyle[plain ? property : `${name}-${property}`] = value;
                }
              }
            }
            style = { htmlStyle };
          }
          if (styles.size < 128) styles.set(key, style);
        }
        if (last !== undefined && lastKey === key)
          last.content += code.slice(start, end);
        else {
          last = {
            content: code.slice(start, end),
            offset: start + offsetBase,
            ...style,
          };
          lastKey = key;
          line.push(last);
        }
      } else {
        if (last !== undefined && lastKey === kind)
          last.content += code.slice(start, end);
        else {
          last = rangeToToken(
            code,
            start,
            end,
            kind,
            themes,
            cssVariablePrefix,
            offsetBase
          );
          lastKey = kind;
          line.push(last);
        }
      }
    }
    start = end;
  }
  lines.push(line);
  if (maxLineLength !== undefined && maxLineLength > 0) {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (
        line.reduce((n, token) => n + token.content.length, 0) >= maxLineLength
      ) {
        const token = rangeToToken(
          '',
          0,
          0,
          0,
          themes,
          cssVariablePrefix,
          line[0].offset
        );
        token.content = line.map((token) => token.content).join('');
        lines[i] = [token];
      }
    }
  }
  return lines;
}
