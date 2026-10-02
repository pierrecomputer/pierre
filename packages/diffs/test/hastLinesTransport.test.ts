import { describe, expect, test } from 'bun:test';
import type { Element, ElementContent } from 'hast';

import {
  decodeHastLines,
  encodeHastLines,
} from '../src/worker/hastLinesTransport';

describe('worker HAST transport', () => {
  test('round-trips decorations, metadata, and property value types', () => {
    const line: Element = {
      type: 'element',
      tagName: 'div',
      properties: {
        'data-line': 42,
        'data-alt-line': undefined,
        'data-line-index': '0,1',
        'data-line-type': 'change-addition',
        className: ['line', 'highlighted'],
        hidden: false,
        disabled: true,
        title: null,
        style: '',
        'data-fraction': 0.5,
        'data-large': 2147483648,
        'data-negative': -2147483648,
        'data-infinity': Infinity,
        'data-nan': NaN,
        'data-zero': -0,
      },
      children: [
        {
          type: 'element',
          tagName: 'span',
          properties: { 'data-diff-span': '', 'data-char': 2 },
          children: [
            { type: 'text', value: '\ud800🚀<&雪' },
            {
              type: 'element',
              tagName: 'span',
              properties: { style: 'color:var(--token-keyword)' },
              children: [{ type: 'text', value: '\udc00' }],
            },
          ],
        },
        { type: 'comment', value: 'metadata' },
        {
          type: 'text',
          value: 'positioned',
          position: {
            start: { line: 1, column: 1, offset: 0 },
            end: { line: 1, column: 11, offset: 10 },
          },
          data: { marker: new Date(0), nested: { value: undefined } },
        },
        {
          type: 'element',
          tagName: 'template',
          properties: {},
          children: [],
          content: { type: 'root', children: [{ type: 'text', value: 'x' }] },
        },
      ],
    };
    Object.defineProperty(line.properties, '__proto__', {
      value: 'preserved',
      enumerable: true,
    });
    const lines: ElementContent[] = [line, { type: 'text', value: '' }];
    const encoded = encodeHastLines(lines);
    const transferred = structuredClone(encoded, {
      transfer: [encoded.ops.buffer, encoded.offsets.buffer],
    });
    expect(encoded.ops.byteLength).toBe(0);
    expect(encoded.offsets.byteLength).toBe(0);
    const decoded = decodeHastLines(transferred);
    expect(structuredClone(decoded)).toEqual(structuredClone(lines));
    if (decoded[0].type !== 'element') throw new Error('Expected element');
    expect(Object.getPrototypeOf(decoded[0].properties)).toBe(Object.prototype);
    expect(Object.hasOwn(decoded[0].properties, '__proto__')).toBe(true);
    expect(decoded[0].properties.__proto__).toBe('preserved');
  });

  test('preserves sparse rows and child arrays', () => {
    const lines: ElementContent[] = new Array(4);
    const children: ElementContent[] = new Array(3);
    children[1] = { type: 'text', value: 'nested' };
    lines[2] = { type: 'element', tagName: 'span', properties: {}, children };
    const decoded = decodeHastLines(structuredClone(encodeHastLines(lines)));
    expect(decoded.length).toBe(4);
    expect(Object.keys(decoded)).toEqual(['2']);
    expect(0 in decoded).toBe(false);
    expect(structuredClone(decoded)).toEqual(lines);
    if (decoded[2].type !== 'element') throw new Error('Expected element');
    expect(Object.keys(decoded[2].children)).toEqual(['1']);
  });

  test('decodes only accessed rows and retains ordinary array mutations', () => {
    const lines: ElementContent[] = Array.from({ length: 8 }, (_, index) => ({
      type: 'element',
      tagName: 'div',
      properties: { 'data-line': index + 1 },
      children: [{ type: 'text', value: `${index}:🚀` }],
    }));
    const decoded = decodeHastLines(structuredClone(encodeHastLines(lines)));
    expect(Array.isArray(decoded)).toBe(true);
    expect(Object.getOwnPropertyDescriptor(decoded, '0')?.get).toBeDefined();
    expect(decoded[7]).toEqual(lines[7]);
    expect(decoded[2]).toEqual(lines[2]);
    expect(decoded[2]).toBe(decoded[2]);
    expect(Object.getOwnPropertyDescriptor(decoded, '0')?.get).toBeDefined();
    expect(Object.getOwnPropertyDescriptor(decoded, '2')?.get).toBeUndefined();
    expect(decoded.slice(3, 5)).toEqual(lines.slice(3, 5));
    const replacement: ElementContent = { type: 'text', value: 'replacement' };
    decoded[0] = replacement;
    lines[0] = replacement;
    expect(decoded[0]).toBe(replacement);
    decoded.splice(1, 2, replacement);
    lines.splice(1, 2, replacement);
    expect(structuredClone(decoded)).toEqual(lines);
    expect(JSON.stringify(decoded)).toBe(JSON.stringify(lines));
  });

  test('accepts legacy worker arrays and empty results', () => {
    const lines: ElementContent[] = [{ type: 'text', value: 'legacy' }];
    expect(decodeHastLines(lines)).toBe(lines);
    expect(decodeHastLines(encodeHastLines([]))).toEqual([]);
  });

  test('frozen and sealed results decode rows out of order', () => {
    const lines: ElementContent[] = [
      { type: 'text', value: 'first 🚀' },
      { type: 'text', value: 'second 雪' },
    ];
    for (const lock of [Object.freeze, Object.seal]) {
      const decoded = decodeHastLines(structuredClone(encodeHastLines(lines)));
      lock(decoded);
      const second = decoded[1];
      expect(second).toEqual(lines[1]);
      expect(decoded[0]).toEqual(lines[0]);
      expect(decoded[1]).toBe(second);
      expect(structuredClone(decoded)).toEqual(lines);
    }
  });

  test('retains custom HAST with absent or null properties', () => {
    for (const properties of [undefined, null]) {
      const line: Element = {
        type: 'element',
        tagName: 'div',
        properties: {},
        children: [],
      };
      Reflect.set(line, 'properties', properties);
      const decoded = decodeHastLines(structuredClone(encodeHastLines([line])));
      expect(structuredClone(decoded)).toEqual([line]);
    }
  });
});
