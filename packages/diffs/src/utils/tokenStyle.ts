import type { ThemedToken } from '../types';

// Highlights hands every token of one style the same `htmlStyle` object, so
// the serialized CSS is cached per object instead of rebuilt for each token.
const htmlStyleCache = new WeakMap<Record<string, string>, string>();

/** Convert a backend token's colors and font flags to inline CSS. */
export function tokenStyle(token: ThemedToken): string {
  const { htmlStyle } = token;
  if (htmlStyle != null) {
    let style = htmlStyleCache.get(htmlStyle);
    if (style == null) {
      style = Object.entries(htmlStyle)
        .map(([name, value]) => `${name}:${value}`)
        .join(';');
      htmlStyleCache.set(htmlStyle, style);
    }
    return style;
  }
  let style = token.color != null ? `color:${token.color}` : '';
  if (token.bgColor != null) style += `;background-color:${token.bgColor}`;
  if (token.fontStyle != null) {
    if ((token.fontStyle & 1) !== 0) style += ';font-style:italic';
    if ((token.fontStyle & 2) !== 0) style += ';font-weight:bold';
    const underline = (token.fontStyle & 4) !== 0;
    const strikethrough = (token.fontStyle & 8) !== 0;
    if (underline || strikethrough)
      style += `;text-decoration:${underline ? 'underline' : ''}${underline && strikethrough ? ' ' : ''}${strikethrough ? 'line-through' : ''}`;
  }
  return style.replace(/^;/, '');
}
