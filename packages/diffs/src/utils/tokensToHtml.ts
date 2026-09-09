import type { ThemedToken } from '../types';
import { attributesToHTML, escapeHTML } from './html';

/** Only token hooks run; Shiki's tree hooks and highlighter context are absent. */
export interface TokenTransformer {
  name?: string;
  enforce?: 'pre' | 'post';
  tokens?(lines: ThemedToken[][]): ThemedToken[][] | void;
}

export interface TokensToHtmlOptions {
  transformers?: TokenTransformer[];
}

export function tokenStyle(token: ThemedToken): string {
  if (token.htmlStyle != null) {
    return typeof token.htmlStyle === 'string'
      ? token.htmlStyle
      : Object.entries(token.htmlStyle)
          .map(([key, value]) => `${key}:${value}`)
          .join(';');
  }
  const styles: string[] = [];
  if (token.color != null) styles.push(`color:${token.color}`);
  if (token.bgColor != null) styles.push(`background-color:${token.bgColor}`);
  const flags = token.fontStyle ?? 0;
  if ((flags & 1) !== 0) styles.push('font-style:italic');
  if ((flags & 2) !== 0) styles.push('font-weight:bold');
  const decorations: string[] = [];
  if ((flags & 4) !== 0) decorations.push('underline');
  if ((flags & 8) !== 0) decorations.push('line-through');
  if (decorations.length > 0)
    styles.push(`text-decoration:${decorations.join(' ')}`);
  return styles.join(';');
}

/** Merge token styles with custom attributes for both HTML and DOM rendering. */
export function tokenAttributes(token: ThemedToken): Record<string, string> {
  const style = tokenStyle(token);
  return style === '' ? (token.htmlAttrs ?? {}) : { ...token.htmlAttrs, style };
}

/** Render token spans separated by newlines, without code or pre wrappers. */
export function tokensToHtml(
  tokens: ThemedToken[][],
  { transformers = [] }: TokensToHtmlOptions = {}
): string {
  for (const tier of ['pre', undefined, 'post'] as const) {
    for (const transformer of transformers) {
      if (transformer.enforce === tier) {
        tokens = transformer.tokens?.(tokens) ?? tokens;
      }
    }
  }
  let html = '';
  for (let lineIndex = 0; lineIndex < tokens.length; lineIndex++) {
    if (lineIndex > 0) html += '\n';
    for (const token of tokens[lineIndex]) {
      html += `<span${attributesToHTML(tokenAttributes(token))}>${escapeHTML(token.content)}</span>`;
    }
  }
  return html;
}
