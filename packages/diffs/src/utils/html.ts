import type { SVGSpriteNames } from '../sprite';
import type {
  ElementContent,
  HElement,
  HProperties,
  HText,
  LineTypes,
} from '../types';

export function createTextNode(value: string): HText {
  return { type: 'text', value };
}

interface CreateHtmlElementProps {
  tagName:
    | 'span'
    | 'div'
    | 'button'
    | 'code'
    | 'pre'
    | 'slot'
    | 'svg'
    | 'use'
    | 'style'
    | 'template'
    | 'bdi';
  children?: ElementContent[];
  properties?: HProperties;
}

export function createHtmlElement({
  tagName,
  children = [],
  properties = {},
}: CreateHtmlElementProps): HElement {
  return {
    type: 'element',
    tagName,
    properties,
    children,
  };
}

interface CreateIconProps {
  name: SVGSpriteNames;
  width?: number;
  height?: number;
  properties?: HProperties;
}

export function createIconElement({
  name,
  width = 16,
  height = 16,
  properties,
}: CreateIconProps): HElement {
  return createHtmlElement({
    tagName: 'svg',
    properties: { width, height, viewBox: '0 0 16 16', ...properties },
    children: [
      createHtmlElement({
        tagName: 'use',
        properties: { href: `#${name.replace(/^#/, '')}` },
      }),
    ],
  });
}

export function createGutterWrapper(children?: ElementContent[]): HElement {
  return createHtmlElement({
    tagName: 'div',
    properties: { 'data-gutter': '' },
    children,
  });
}

export function createGutterItem(
  lineType: LineTypes | 'buffer' | 'separator' | 'annotation',
  lineNumber: number,
  lineIndex: string,
  properties: HProperties = {}
): HElement {
  return createHtmlElement({
    tagName: 'div',
    properties: {
      'data-line-type': lineType,
      'data-column-number': lineNumber,
      'data-line-index': lineIndex,
      ...properties,
    },
    children:
      lineNumber != null
        ? [
            createHtmlElement({
              tagName: 'span',
              properties: { 'data-line-number-content': '' },
              children: [createTextNode(`${lineNumber}`)],
            }),
          ]
        : undefined,
  });
}

export function createGutterGap(
  type: LineTypes | undefined,
  bufferType: 'annotation' | 'buffer' | 'metadata',
  size: number
): HElement {
  return createHtmlElement({
    tagName: 'div',
    properties: {
      'data-gutter-buffer': bufferType,
      'data-buffer-size': size,
      'data-line-type': bufferType === 'annotation' ? undefined : type,
      style:
        bufferType === 'annotation'
          ? `grid-row: span ${size};`
          : `grid-row: span ${size};min-height:calc(${size} * 1lh);`,
    },
  });
}

const VOID_ELEMENTS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
]);

const BOOLEAN_ATTRIBUTES = new Set([
  'allowfullscreen',
  'async',
  'autofocus',
  'autoplay',
  'checked',
  'controls',
  'default',
  'defer',
  'disabled',
  'inert',
  'ismap',
  'itemscope',
  'loop',
  'multiple',
  'muted',
  'nomodule',
  'novalidate',
  'open',
  'playsinline',
  'readonly',
  'required',
  'reversed',
  'selected',
]);

const ATTRIBUTE_NAMES: Record<string, string> = {
  className: 'class',
  tabIndex: 'tabindex',
  htmlFor: 'for',
  xLinkHref: 'xlink:href',
  xmlLang: 'xml:lang',
  xmlSpace: 'xml:space',
  strokeWidth: 'stroke-width',
  strokeLinecap: 'stroke-linecap',
  strokeLinejoin: 'stroke-linejoin',
  strokeDasharray: 'stroke-dasharray',
  strokeDashoffset: 'stroke-dashoffset',
  strokeMiterlimit: 'stroke-miterlimit',
  strokeOpacity: 'stroke-opacity',
  fillRule: 'fill-rule',
  fillOpacity: 'fill-opacity',
  clipRule: 'clip-rule',
  clipPath: 'clip-path',
  shapeRendering: 'shape-rendering',
  vectorEffect: 'vector-effect',
};

// Serialize the render tree with escaped source text and attribute values.
export function toHtml(nodes: ElementContent | ElementContent[]): string {
  if (Array.isArray(nodes)) {
    let html = '';
    for (const node of nodes) html += toHtml(node);
    return html;
  }
  if (nodes.type === 'text') return escapeHTML(nodes.value);
  if (nodes.type === 'comment') {
    return `<!--${nodes.value.replace(/^>|^->|<!--|-->|--!>|<!-$/g, escapeHTML)}-->`;
  }
  const { tagName, properties, children } = nodes;
  if (!/^[a-z][\w:.-]*$/i.test(tagName)) return toHtml(children);

  let html = `<${tagName}`;
  for (const [key, value] of Object.entries(properties)) {
    if (value == null) continue;
    const name = Object.hasOwn(ATTRIBUTE_NAMES, key)
      ? ATTRIBUTE_NAMES[key]
      : /^aria[A-Z]/.test(key)
        ? `aria-${key.slice(4).toLowerCase()}`
        : /^data[A-Z]/.test(key)
          ? key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)
          : key;
    // Attribute names cannot use value escaping: HTML does not decode entities
    // in names, so omit malformed keys before they can create extra attributes.
    if (!/^[a-zA-Z0-9_:@-]+$/.test(name)) continue;
    if (name.toLowerCase() === 'hidden') {
      if (value !== false) {
        html += value === 'until-found' ? ` ${name}="until-found"` : ` ${name}`;
      }
      continue;
    }
    if (BOOLEAN_ATTRIBUTES.has(name.toLowerCase())) {
      if (value !== false) html += ` ${name}`;
    } else {
      html += ` ${name}="${escapeHTML(Array.isArray(value) ? value.join(' ') : String(value))}"`;
    }
  }
  html += '>';
  if (VOID_ELEMENTS.has(tagName)) return html;
  for (const child of children) {
    // CSS is raw text in HTML; escape closing tags without changing CSS strings.
    html +=
      tagName === 'style' && child.type === 'text'
        ? child.value.replace(/<\/style/gi, '\\3c /style')
        : toHtml(child);
  }
  return `${html}</${tagName}>`;
}

const regexpHtmlSafe = /["'&<>]/;

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
export function escapeHTML(str: string): string {
  const match = regexpHtmlSafe.exec(str);
  if (match === null) return str;
  // @ts-ignore use bun's built-in `escapeHTML` function if available
  if (typeof Bun === 'object' && 'escapeHTML' in Bun)
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
    if (lastIndex !== index) html += str.slice(lastIndex, index);
    lastIndex = index + 1;
    html += escape;
  }
  return lastIndex !== index ? html + str.slice(lastIndex, index) : html;
}
