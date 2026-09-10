import type { Theme, ThemeSyntaxSettings } from './index';
import tokenTypes from './token-types';

const colorReg = /^#([a-f0-9]{3,4}|[a-f0-9]{6}|[a-f0-9]{8})$/i;

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
  const foreground =
    style['editor.foreground'] ?? style.text ?? style.foreground;
  const syntax = style.syntax ?? {};
  const bytes = new Uint8Array(tokenTypes.length * 5);
  for (let i = 0; i < tokenTypes.length; i++) {
    const name = tokenTypes[i];
    let color: string | undefined;
    let font_style: string | undefined;
    let font_weight: number | undefined;
    if (name === 'none') continue;
    else if (name === 'background')
      color = style['editor.background'] ?? style.background;
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
