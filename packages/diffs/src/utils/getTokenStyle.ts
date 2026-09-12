import type { ThemedToken } from '@pierre/highlights';

// Both DOM updates and rendered rows use the same token styles.
export function getTokenStyle(token: ThemedToken): string {
  if (token.htmlStyle != null) {
    let style = '';
    for (const [name, value] of Object.entries(token.htmlStyle)) {
      if (style !== '') style += ';';
      style += `${name}:${value}`;
    }
    return style;
  }
  const styles: string[] = [];
  if (token.color != null) styles.push(`color:${token.color}`);
  if (token.bgColor != null) styles.push(`background-color:${token.bgColor}`);
  const fontStyle = token.fontStyle ?? 0;
  if ((fontStyle & 1) !== 0) styles.push('font-style:italic');
  if ((fontStyle & 2) !== 0) styles.push('font-weight:bold');
  const decorations: string[] = [];
  if ((fontStyle & 4) !== 0) decorations.push('underline');
  if ((fontStyle & 8) !== 0) decorations.push('line-through');
  if (decorations.length > 0)
    styles.push(`text-decoration:${decorations.join(' ')}`);
  return styles.join(';');
}
