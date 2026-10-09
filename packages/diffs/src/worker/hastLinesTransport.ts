import type { ElementContent, Properties } from 'hast';

import { setDeferredArrayItem } from '../utils/setDeferredArrayItem';

const HOLE = 0;
const TEXT = 1;
const ELEMENT = 2;
const OTHER = 3;
const UNDEFINED = 0;
const NULL = 1;
const TRUE = 2;
const FALSE = 3;
const STRING = 4;
const INTEGER = 5;
const EXTRA = 6;
const PRIMITIVES = [undefined, null, true, false];

export interface EncodedHastLines {
  ops: Int32Array<ArrayBuffer>;
  offsets: Uint32Array<ArrayBuffer>;
  strings: string[];
  text: string;
  extras: unknown[];
}

export function encodeHastLines(lines: ElementContent[]): EncodedHastLines {
  let ops = new Int32Array(Math.max(32, Math.min(65536, lines.length * 32)));
  let length = 0;
  const offsets = new Uint32Array(lines.length * 2);
  const strings: string[] = [];
  const stringIds = new Map<string, number>();
  const extras: unknown[] = [];
  let text = '';

  function push(value: number): void {
    if (length === ops.length) {
      const next = new Int32Array(ops.length * 2);
      next.set(ops);
      ops = next;
    }
    ops[length++] = value;
  }

  function intern(value: string): number {
    let id = stringIds.get(value);
    if (id == null) {
      id = strings.length;
      strings.push(value);
      stringIds.set(value, id);
    }
    return id;
  }

  function encodeNode(node: ElementContent): void {
    let keys = 0;
    for (const _ in node) keys++;
    if (node?.type === 'text' && keys === 2) {
      push(TEXT);
      push(node.value.length);
      text += node.value;
    } else if (
      node?.type === 'element' &&
      keys === 4 &&
      node.properties != null &&
      Object.getPrototypeOf(node.properties) === Object.prototype
    ) {
      push(ELEMENT);
      push(intern(node.tagName));
      let count = 0;
      for (const _ in node.properties) count++;
      push(count);
      for (const key in node.properties) {
        const value = node.properties[key];
        push(intern(key));
        if (value === undefined) push(UNDEFINED);
        else if (value === null) push(NULL);
        else if (value === true) push(TRUE);
        else if (value === false) push(FALSE);
        else if (typeof value === 'string') {
          push(STRING);
          push(intern(value));
        } else if (
          typeof value === 'number' &&
          (value | 0) === value &&
          !Object.is(value, -0)
        ) {
          push(INTEGER);
          push(value);
        } else {
          push(EXTRA);
          push(extras.length);
          extras.push(value);
        }
      }
      push(node.children.length);
      for (let index = 0; index < node.children.length; index++) {
        if (index in node.children) encodeNode(node.children[index]);
        else push(HOLE);
      }
    } else {
      push(OTHER);
      push(extras.length);
      extras.push(node);
    }
  }

  for (let index = 0; index < lines.length; index++) {
    offsets[index * 2] = length;
    offsets[index * 2 + 1] = text.length;
    if (index in lines) encodeNode(lines[index]);
    else push(HOLE);
  }
  return { ops: ops.subarray(0, length), offsets, strings, text, extras };
}

export function decodeHastLines(
  encoded: EncodedHastLines | ElementContent[]
): ElementContent[] {
  if (Array.isArray(encoded)) return encoded;
  const { ops, offsets, strings, text, extras } = encoded;
  const lines: ElementContent[] = new Array(offsets.length / 2);
  let position = 0;
  let textPosition = 0;

  function decodeNodes(count: number): ElementContent[] {
    const nodes: ElementContent[] = new Array(count);
    for (let index = 0; index < count; index++) {
      const kind = ops[position++];
      if (kind === HOLE) continue;
      if (kind === TEXT) {
        const end = textPosition + ops[position++];
        nodes[index] = { type: 'text', value: text.slice(textPosition, end) };
        textPosition = end;
      } else if (kind === ELEMENT) {
        const tagName = strings[ops[position++]];
        const properties: Properties = {};
        for (let remaining = ops[position++]; remaining > 0; remaining--) {
          const key = strings[ops[position++]];
          const type = ops[position++];
          const value =
            type === STRING
              ? strings[ops[position++]]
              : type === INTEGER
                ? ops[position++]
                : type === EXTRA
                  ? (extras[ops[position++]] as Properties[string])
                  : PRIMITIVES[type];
          if (key === '__proto__') {
            Object.defineProperty(properties, key, {
              value,
              enumerable: true,
              configurable: true,
              writable: true,
            });
          } else properties[key] = value;
        }
        nodes[index] = {
          type: 'element',
          tagName,
          properties,
          children: decodeNodes(ops[position++]),
        };
      } else nodes[index] = extras[ops[position++]] as ElementContent;
    }
    return nodes;
  }

  for (let index = 0; index < lines.length; index++) {
    if (ops[offsets[index * 2]] === HOLE) continue;
    setDeferredArrayItem(lines, index, () => {
      position = offsets[index * 2];
      textPosition = offsets[index * 2 + 1];
      return decodeNodes(1)[0];
    });
  }
  return lines;
}
