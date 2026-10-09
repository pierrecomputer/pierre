import type { ThemedToken } from '../types';

// Warning: cache only tokens from Highlights, which reuses htmlStyle objects.
// Shiki creates one per token, so caching them adds a WeakMap entry per token.
const htmlStyleCache = new WeakMap<Record<string, string>, string>();

export function tokenStyle(
  token: ThemedToken,
  cacheHtmlStyle: boolean
): string {
  const { htmlStyle } = token;
  if (htmlStyle != null) {
    let style = cacheHtmlStyle ? htmlStyleCache.get(htmlStyle) : undefined;
    if (style == null) {
      style = '';
      for (const name in htmlStyle) {
        style += `${style === '' ? '' : ';'}${name}:${htmlStyle[name]}`;
      }
      if (cacheHtmlStyle) htmlStyleCache.set(htmlStyle, style);
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
