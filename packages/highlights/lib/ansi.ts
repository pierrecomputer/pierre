import type { ThemedToken } from './index';
import { rangeToToken, type ResolvedTheme } from './tokens';

const BOLD = 1;
const DIM = 2;
const ITALIC = 4;
const UNDERLINE = 8;
const REVERSE = 16;
const STRIKE = 32;
// Flags that SGR codes 1–9 set. Codes 21–29 clear the flag of code n - 20.
const sgrFlags = [0, BOLD, DIM, ITALIC, UNDERLINE, 0, 0, REVERSE, 0, STRIKE];
const cubeLevels = [0, 95, 135, 175, 215, 255];
// CSI with its parameters and final byte, OSC ending in BEL or ST, or a
// short escape such as `ESC(B`. None of them crosses a line break.
const escapeReg =
  // oxlint-disable-next-line no-control-regex
  /\x1b(?:\[([0-?]*)[ -/]*([@-~])|\][^\x07\x1b\n]*(?:\x07|\x1b\\)|[ -/]*[0-~])/y;

type AnsiStyle = Pick<
  ThemedToken,
  'color' | 'bgColor' | 'fontStyle' | 'htmlStyle'
>;

/**
 * SGR state that carries across lines and stream chunks. Colors are -1 for
 * the theme default, 0–255 for palette indexes, or `0x1000000 | rgb`.
 * `styles` caches token fields by state for one theme set and prefix.
 */
export class AnsiState {
  fg = -1;
  bg = -1;
  flags = 0;
  styles: Map<string, AnsiStyle> = new Map();
}

/** Check for Shiki's special `ansi` language, which the host tokenizes. */
export function isAnsi(lang: string): boolean {
  return String(lang).toLowerCase() === 'ansi';
}

/** A CSS color for an SGR color, using the theme for palette indexes 0–15. */
function paletteColor(theme: ResolvedTheme, color: number): string {
  if (color < 16) return theme.ansi[color];
  let rgb = color & 0xffffff;
  if (color < 232) {
    const i = color - 16;
    rgb =
      (cubeLevels[(i / 36) | 0] << 16) |
      (cubeLevels[((i / 6) | 0) % 6] << 8) |
      cubeLevels[i % 6];
  } else if (color < 256) {
    rgb = (8 + (color - 232) * 10) * 0x10101;
  }
  return `#${rgb.toString(16).padStart(6, '0')}`;
}

/**
 * Split text with ANSI escape sequences into token lines, as Shiki does for
 * `ansi`. Tokens omit the sequences: `content` is visible text, and `offset`
 * is the input offset of its first character. SGR codes select colors from
 * the theme's `terminal.ansi.*` keys and font styles. Other sequences are
 * removed.
 */
export function ansiTokens(
  code: string,
  themes: ResolvedTheme[],
  cssVariablePrefix: string,
  maxLineLength?: number,
  state: AnsiState = new AnsiState(),
  offsetBase = 0
): ThemedToken[][] {
  const lines: ThemedToken[][] = [];
  const max = maxLineLength ?? 0;
  let line: ThemedToken[] = [];
  // The fields for the current state; undefined after an SGR sequence.
  let style: AnsiStyle | undefined;
  let last: ThemedToken | undefined;
  let lastStyle: AnsiStyle | undefined;
  let esc = code.indexOf('\x1b');
  let pos = 0;
  for (;;) {
    const lf = code.indexOf('\n', pos);
    let end = lf < 0 ? code.length : lf;
    if (lf > pos && code.charCodeAt(lf - 1) === 13) end--;
    const unstyled = max > 0 && end - pos >= max;
    while (pos < end) {
      if (esc >= 0 && esc < pos) esc = code.indexOf('\x1b', pos);
      let textEnd = esc >= 0 && esc < end ? esc : end;
      let next = textEnd;
      let params: string | undefined;
      if (textEnd < end) {
        escapeReg.lastIndex = textEnd;
        const match = escapeReg.exec(code);
        if (match === null) {
          // Warning: keep an escape that starts no sequence as text.
          next = ++textEnd;
        } else {
          next = escapeReg.lastIndex;
          // Private parameters such as `ESC[>4;2m` are not SGR.
          if (match[2] === 'm' && !(match[1].charCodeAt(0) >= 0x3c)) {
            params = match[1];
          }
        }
      }
      if (textEnd > pos && unstyled) {
        if (last === undefined) {
          last = rangeToToken(
            code,
            pos,
            textEnd,
            0,
            themes,
            cssVariablePrefix,
            offsetBase
          );
          line.push(last);
        } else last.content += code.slice(pos, textEnd);
      } else if (textEnd > pos) {
        if (style === undefined) {
          const { fg, bg, flags } = state;
          const key = `${fg},${bg},${flags}`;
          style = state.styles.get(key);
          if (style === undefined) {
            const fontStyle =
              ((flags & ITALIC) !== 0 ? 1 : 0) |
              ((flags & BOLD) !== 0 ? 2 : 0) |
              ((flags & UNDERLINE) !== 0 ? 4 : 0) |
              ((flags & STRIKE) !== 0 ? 8 : 0);
            const colors = themes.map((theme) => {
              let color = fg < 0 ? theme.fg : paletteColor(theme, fg);
              let bgColor = bg < 0 ? undefined : paletteColor(theme, bg);
              if ((flags & REVERSE) !== 0) {
                bgColor = color;
                color = bg < 0 ? theme.bg : paletteColor(theme, bg);
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
            state.styles.set(key, style);
          }
        }
        if (last !== undefined && lastStyle === style) {
          last.content += code.slice(pos, textEnd);
        } else {
          last = {
            content: code.slice(pos, textEnd),
            offset: pos + offsetBase,
            ...style,
          };
          lastStyle = style;
          line.push(last);
        }
      }
      if (params !== undefined) {
        const codes = params.split(';');
        for (let i = 0; i < codes.length; i++) {
          // An empty parameter is 0, which resets every attribute.
          const n = Number(codes[i]);
          if (n === 0) {
            state.fg = -1;
            state.bg = -1;
            state.flags = 0;
          } else if (n < 10) state.flags |= sgrFlags[n] ?? 0;
          else if (n > 20 && n < 30) {
            state.flags &= ~((sgrFlags[n - 20] ?? 0) | (n === 22 ? BOLD : 0));
          } else if (n >= 30 && n < 38) state.fg = n - 30;
          else if (n === 39) state.fg = -1;
          else if (n >= 40 && n < 48) state.bg = n - 40;
          else if (n === 49) state.bg = -1;
          else if (n >= 90 && n < 98) state.fg = n - 82;
          else if (n >= 100 && n < 108) state.bg = n - 92;
          else if (n === 38 || n === 48) {
            const mode = codes[++i];
            let color = -1;
            if (mode === '5') {
              const index = Number(codes[++i]);
              if (Number.isInteger(index) && index < 256) color = index;
            } else if (mode === '2') {
              const r = Number(codes[i + 1]);
              const g = Number(codes[i + 2]);
              const b = Number(codes[i + 3]);
              i += 3;
              if (r >= 0 && g >= 0 && b >= 0) {
                color =
                  0x1000000 |
                  (Math.min(r, 255) << 16) |
                  (Math.min(g, 255) << 8) |
                  Math.min(b, 255);
              }
            }
            if (color >= 0) {
              if (n === 38) state.fg = color;
              else state.bg = color;
            }
          }
        }
        style = undefined;
      }
      pos = next;
    }
    lines.push(line);
    if (lf < 0) return lines;
    pos = lf + 1;
    line = [];
    last = undefined;
  }
}
