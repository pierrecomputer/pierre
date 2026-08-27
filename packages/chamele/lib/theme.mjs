import tokenTypes from './token-types.mjs';

const colorReg = /^#([a-f0-9]{6})([a-f0-9]{2})?$/i;

function resolve(syntax, name) {
  for (let k = name; k; ) {
    const v = syntax[k];
    if (typeof v === 'string') return { color: v };
    if (v && typeof v === 'object' && v.color != null) return v;
    const dot = k.lastIndexOf('.');
    k = dot < 0 ? '' : k.slice(0, dot);
  }
}

/**
 * Compile a Zed theme, or the first theme in a family, to its binary table.
 * @param {import("./index.d.ts").Theme} theme
 * @returns {Uint8Array}
 */
export function compileTheme(theme) {
  const style = theme.style ?? {};
  const syntax = style.syntax ?? {};
  const bytes = new Uint8Array(tokenTypes.length * 5);
  for (let i = 0; i < tokenTypes.length; i++) {
    const name = tokenTypes[i];
    let color, font_style, font_weight;
    if (name === 'none') continue;
    else if (name === 'background')
      color = style['editor.background'] ?? style.background;
    else if (name === 'foreground')
      color = style['editor.foreground'] ?? style.text ?? style.foreground;
    else ({ color, font_style, font_weight } = resolve(syntax, name) ?? {});
    if (typeof color !== 'string') continue;
    const m = colorReg.exec(color.trim());
    if (!m) continue;
    const o = i * 5;
    const rgb = parseInt(m[1], 16);
    bytes[o] = rgb >> 16;
    bytes[o + 1] = (rgb >> 8) & 0xff;
    bytes[o + 2] = rgb & 0xff;
    bytes[o + 3] = m[2] ? parseInt(m[2], 16) : 0xff;
    let s = font_style === 'italic' ? 0x10 : 0;
    if (font_weight >= 100 && font_weight <= 900)
      s |= Math.round(font_weight / 100);
    bytes[o + 4] = s;
  }
  return bytes;
}
