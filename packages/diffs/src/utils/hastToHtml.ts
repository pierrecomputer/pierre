import type { Element, Nodes, Properties, RootContent } from 'hast';
import { toHtml } from 'hast-util-to-html';

// Must match the html-void-elements list used by toHtml().
const VOID_ELEMENTS = new Set([
  'area',
  'base',
  'basefont',
  'bgsound',
  'br',
  'col',
  'command',
  'embed',
  'frame',
  'hr',
  'image',
  'img',
  'input',
  'keygen',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
]);

// These elements require schema, fragment or raw-text handling in toHtml().
const DELEGATED_TAGS = new Set(['svg', 'template', 'script', 'style']);

// Boolean and comma-separated attributes require the full HTML schema.
const ATTRIBUTE_NAMES: Record<string, string | undefined> = {
  class: 'class',
  className: 'class',
  id: 'id',
  role: 'role',
  style: 'style',
  tabIndex: 'tabindex',
  tabindex: 'tabindex',
  title: 'title',
};
const DATA_ATTRIBUTE = /^data-[\w.:-]+$/;

const TEXT_ESCAPE = /[<&]/g;
const ATTRIBUTE_ESCAPE = /[\0"&'`]/g;
// Must match stringify-entities' default hexadecimal encoding.
const CHARACTER_REFERENCES: Record<string, string> = {
  '<': '&#x3C;',
  '&': '&#x26;',
  '"': '&#x22;',
  "'": '&#x27;',
  '`': '&#x60;',
  '\0': '&#x0;',
};
const MAX_CACHED_STYLES = 256;

/**
 * Avoid schema lookups for common token spans; delegate other nodes and
 * attributes to toHtml(). Output must match its default serialization exactly.
 */
export function hastToHtml(tree: Nodes | RootContent[]): string {
  const styles = new Map<string, string>();
  return Array.isArray(tree)
    ? serializeChildren(tree, styles)
    : serializeNode(tree, styles);
}

function serializeChildren(
  children: readonly RootContent[],
  styles: Map<string, string>
): string {
  let html = '';
  for (const child of children) {
    html += serializeNode(child, styles);
  }
  return html;
}

function serializeNode(node: Nodes, styles: Map<string, string>): string {
  switch (node.type) {
    case 'text':
      return escapeText(node.value);
    case 'element':
      return serializeElement(node, styles);
    case 'root':
      return serializeChildren(node.children, styles);
    default:
      return toHtml(node);
  }
}

function serializeElement(node: Element, styles: Map<string, string>): string {
  const { tagName } = node;
  if (
    tagName === 'span' &&
    node.children.length === 1 &&
    node.children[0].type === 'text' &&
    typeof node.properties?.style === 'string'
  ) {
    let styleOnly = true;
    for (const key in node.properties) {
      if (key !== 'style' && node.properties[key] != null) {
        styleOnly = false;
        break;
      }
    }
    if (styleOnly) {
      return `<span ${serializeStyle(node.properties.style, styles)}>${escapeText(node.children[0].value)}</span>`;
    }
  }
  if (DELEGATED_TAGS.has(tagName)) {
    return toHtml(node);
  }
  const attributes = serializeAttributes(node.properties, styles);
  if (attributes == null) {
    return toHtml(node);
  }
  const open =
    attributes === '' ? `<${tagName}>` : `<${tagName} ${attributes}>`;
  const content = serializeChildren(node.children, styles);
  if (content === '' && VOID_ELEMENTS.has(tagName.toLowerCase())) {
    return open;
  }
  return `${open}${content}</${tagName}>`;
}

// Cap the per-render cache because custom styles may be unique per token.
function serializeStyle(value: string, styles: Map<string, string>): string {
  let attribute = styles.get(value);
  if (attribute == null) {
    attribute = `style="${escapeAttribute(value)}"`;
    if (styles.size < MAX_CACHED_STYLES) styles.set(value, attribute);
  }
  return attribute;
}

// Returns undefined when a property needs the HTML schema to serialize.
function serializeAttributes(
  properties: Properties | undefined,
  styles: Map<string, string>
): string | undefined {
  let attributes = '';
  for (const key in properties) {
    const value = properties[key];
    if (value == null) {
      continue;
    }
    const name =
      ATTRIBUTE_NAMES[key] ?? (DATA_ATTRIBUTE.test(key) ? key : undefined);
    if (name == null) {
      return undefined;
    }
    if (value === false || (typeof value === 'number' && Number.isNaN(value))) {
      continue;
    }
    const attribute =
      key === 'style' && typeof value === 'string'
        ? serializeStyle(value, styles)
        : value === true
          ? name
          : `${name}="${escapeAttribute(
              Array.isArray(value) ? value.join(' ').trim() : String(value)
            )}"`;
    attributes += attributes === '' ? attribute : ` ${attribute}`;
  }
  return attributes;
}

function escapeText(value: string): string {
  return value.indexOf('<') < 0 && value.indexOf('&') < 0
    ? value
    : value.replace(TEXT_ESCAPE, toCharacterReference);
}

function escapeAttribute(value: string): string {
  return value.replace(ATTRIBUTE_ESCAPE, toCharacterReference);
}

function toCharacterReference(character: string): string {
  return CHARACTER_REFERENCES[character];
}
