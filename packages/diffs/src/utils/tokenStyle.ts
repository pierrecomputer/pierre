import type { ThemedToken } from '../types';

/** Convert a backend token's colors and font flags to inline CSS. */
export function tokenStyle(token: ThemedToken): string {
  if (token.htmlStyle != null) {
    return Object.entries(token.htmlStyle)
      .map(([name, value]) => `${name}:${value}`)
      .join(';');
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
