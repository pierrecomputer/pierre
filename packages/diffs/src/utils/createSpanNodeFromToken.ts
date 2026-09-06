import type { ThemedToken } from 'shiki/core';

// Local equivalents of shiki's getTokenStyleObject/stringifyTokenStyle, so
// the streaming path works without shiki in the module graph (custom
// highlighters emit the same token shape).
function getTokenStyleObject(token: ThemedToken): Record<string, string> {
  const style: Record<string, string> = {};
  if (token.color != null) style.color = token.color;
  if (token.bgColor != null) style['background-color'] = token.bgColor;
  const fontStyle = token.fontStyle ?? 0;
  // FontStyle is a bitmask: 1 = italic, 2 = bold, 4 = underline,
  // 8 = strikethrough (underline and strikethrough share text-decoration)
  if ((fontStyle & 1) !== 0) style['font-style'] = 'italic';
  if ((fontStyle & 2) !== 0) style['font-weight'] = 'bold';
  const decorations: string[] = [];
  if ((fontStyle & 4) !== 0) decorations.push('underline');
  if ((fontStyle & 8) !== 0) decorations.push('line-through');
  if (decorations.length > 0) style['text-decoration'] = decorations.join(' ');
  return style;
}

function stringifyTokenStyle(style: Record<string, string>): string {
  return Object.entries(style)
    .map(([key, value]) => `${key}:${value}`)
    .join(';');
}

export function createSpanFromToken(token: ThemedToken): HTMLSpanElement {
  const element = document.createElement('span');
  const style = token.htmlStyle ?? getTokenStyleObject(token);
  element.style = stringifyTokenStyle(style);
  element.textContent = token.content;
  return element;
}
