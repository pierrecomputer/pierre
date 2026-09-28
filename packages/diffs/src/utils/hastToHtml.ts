import type { Element, Nodes, Properties, RootContent } from 'hast';
import { toHtml } from 'hast-util-to-html';

// `html-void-elements`, the list `toHtml()` closes without an end tag.
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

// Elements `toHtml()` serializes with special rules: SVG switches schema,
// template renders its content fragment, and script/style text is unescaped.
const DELEGATED_TAGS = new Set(['svg', 'template', 'script', 'style']);

// Properties whose HTML schema entry is neither boolean nor comma-separated,
// mapped to their attribute names. `data-*` names map to themselves.
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

/**
 * Serialize HAST to exactly what `toHtml()` from `hast-util-to-html` returns
 * with default options, several times faster. Rendered files carry tens of
 * thousands of token spans, and the generic serializer resolves each
 * attribute through the HTML schema and escapes with per-call regexes. The
 * elements, attributes and text the renderers create are written directly;
 * anything else (SVG, script, style, template, comments, raw nodes, other
 * attributes) is handed to `toHtml()` so the output never differs.
 */
export function hastToHtml(tree: Nodes | RootContent[]): string {
  return Array.isArray(tree) ? serializeChildren(tree) : serializeNode(tree);
}

function serializeChildren(children: readonly RootContent[]): string {
  let html = '';
  for (const child of children) {
    html += serializeNode(child);
  }
  return html;
}

function serializeNode(node: Nodes): string {
  switch (node.type) {
    case 'text':
      return escapeText(node.value);
    case 'element':
      return serializeElement(node);
    case 'root':
      return serializeChildren(node.children);
    default:
      return toHtml(node);
  }
}

function serializeElement(node: Element): string {
  const { tagName } = node;
  if (DELEGATED_TAGS.has(tagName)) {
    return toHtml(node);
  }
  const attributes = serializeAttributes(node.properties);
  if (attributes == null) {
    return toHtml(node);
  }
  const open =
    attributes === '' ? `<${tagName}>` : `<${tagName} ${attributes}>`;
  const content = serializeChildren(node.children);
  if (content === '' && VOID_ELEMENTS.has(tagName.toLowerCase())) {
    return open;
  }
  return `${open}${content}</${tagName}>`;
}

// Returns undefined when a property needs the HTML schema to serialize.
function serializeAttributes(
  properties: Properties | undefined
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
      value === true
        ? name
        : `${name}="${escapeAttribute(
            Array.isArray(value) ? value.join(' ').trim() : String(value)
          )}"`;
    attributes += attributes === '' ? attribute : ` ${attribute}`;
  }
  return attributes;
}

function escapeText(value: string): string {
  return value.replace(TEXT_ESCAPE, toCharacterReference);
}

function escapeAttribute(value: string): string {
  return value.replace(ATTRIBUTE_ESCAPE, toCharacterReference);
}

// The hexadecimal reference `stringify-entities` writes by default.
function toCharacterReference(character: string): string {
  return `&#x${character.charCodeAt(0).toString(16).toUpperCase()};`;
}
