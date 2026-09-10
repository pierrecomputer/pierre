import type { SVGSpriteNames } from '../sprite';
import type {
  HTMLAttributes,
  LineTypes,
  RenderedColumn,
  RenderedLine,
  RenderedRow,
  ThemedToken,
} from '../types';

export const regexpHtmlSafe: RegExp = /["'&<>]/;

/**
 * Escapes special characters and HTML entities in a given html string.
 * Based on https://github.com/component/escape-html
 * Use `Bun.escapeHTML` preferentially if available.
 *
 * Copyright(c) 2012-2013 TJ Holowaychuk
 * Copyright(c) 2015 Andreas Lubbe
 * Copyright(c) 2015 Tiancheng "Timothy" Gu
 * MIT License
 */
export const escapeHTML = (str: string): string => {
  const match = regexpHtmlSafe.exec(str);
  if (match === null) {
    return str;
  }

  if (typeof Bun !== 'undefined' && typeof Bun.escapeHTML === 'function')
    return Bun.escapeHTML(str);

  let escape: string;
  let index: number;
  let lastIndex = 0;
  let html = '';

  for (index = match.index; index < str.length; index++) {
    switch (str.charCodeAt(index)) {
      case 34: // "
        escape = '&quot;';
        break;
      case 38: // &
        escape = '&amp;';
        break;
      case 39: // '
        escape = '&#x27;'; // modified from escape-html; used to be '&#39'
        break;
      case 60: // <
        escape = '&lt;';
        break;
      case 62: // >
        escape = '&gt;';
        break;
      default:
        continue;
    }

    if (lastIndex !== index) {
      html += str.slice(lastIndex, index);
    }

    lastIndex = index + 1;
    html += escape;
  }

  return lastIndex !== index ? html + str.slice(lastIndex, index) : html;
};

export function attributesToHTML(attributes: HTMLAttributes): string {
  let html = '';
  for (const [key, value] of Object.entries(attributes)) {
    if (value == null || value === false) continue;
    const name =
      key === 'className' ? 'class' : key === 'tabIndex' ? 'tabindex' : key;
    if (name.includes('\0') || !/^[^\s"'<>/=]+$/.test(name)) {
      throw new Error(`Invalid HTML attribute: ${name}`);
    }
    html += ` ${name}`;
    if (value !== true) {
      html += `="${escapeHTML(Array.isArray(value) ? value.join(' ') : String(value))}"`;
    }
  }
  return html;
}

/** Compose already-rendered children; plain text must go through escapeHTML. */
export function createHTMLElement(
  tag: keyof HTMLElementTagNameMap | keyof SVGElementTagNameMap,
  props?: null | HTMLAttributes,
  ...children: string[]
): string {
  const opening = `<${tag}${props == null ? '' : attributesToHTML(props)}>`;
  return tag === 'br' ? opening : `${opening}${children.join('')}</${tag}>`;
}

export function renderRows(rows: RenderedRow[]): string {
  let html = '';
  for (const row of rows) {
    html +=
      typeof row === 'string'
        ? row
        : `<div${attributesToHTML(row.properties)}>${row.html}</div>`;
  }
  return html;
}

export function renderColumn(column: RenderedColumn): string {
  const style = `grid-row: span ${column.rowCount}`;
  return `<div data-gutter="" style="${style}">${renderRows(column.gutter)}</div><div data-content="" style="${style}">${renderRows(column.content)}</div>`;
}

export function createIconElement({
  name,
  width = 16,
  height = 16,
  properties,
}: {
  name: SVGSpriteNames;
  width?: number;
  height?: number;
  properties?: HTMLAttributes;
}): string {
  return createHTMLElement(
    'svg',
    { width, height, viewBox: '0 0 16 16', ...properties },
    createHTMLElement('use', { href: `#${name.replace(/^#/, '')}` })
  );
}

export function createGutterItem(
  lineType: LineTypes | 'buffer' | 'separator' | 'annotation',
  lineNumber: number,
  lineIndex: string,
  properties: HTMLAttributes = {}
): RenderedLine {
  return {
    properties: {
      'data-line-type': lineType,
      'data-column-number': lineNumber,
      'data-line-index': lineIndex,
      ...properties,
    },
    html: `<span data-line-number-content="">${lineNumber}</span>`,
  };
}

export function createGutterGap(
  type: LineTypes | undefined,
  bufferType: 'annotation' | 'buffer' | 'metadata',
  size: number
): RenderedLine {
  return {
    html: '',
    properties: {
      'data-gutter-buffer': bufferType,
      'data-buffer-size': size,
      'data-line-type': bufferType === 'annotation' ? undefined : type,
      style:
        bufferType === 'annotation'
          ? `grid-row: span ${size};`
          : `grid-row: span ${size};min-height:calc(${size} * 1lh);`,
    },
  };
}

/** Only token hooks run; Shiki's tree hooks and highlighter context are absent. */
export interface TokenTransformer {
  name?: string;
  enforce?: 'pre' | 'post';
  tokens?(lines: ThemedToken[][]): ThemedToken[][] | void;
}

export interface ToHtmlOptions {
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
export function toHtml(
  tokens: ThemedToken[][],
  { transformers = [] }: ToHtmlOptions = {}
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
