import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { ThemedToken } from 'shiki/core';

import { createSpanFromToken } from '../src/utils/createSpanNodeFromToken';
import { type DomHandle, installDom } from './domHarness';

let dom: DomHandle;
beforeAll(() => {
  dom = installDom();
});
afterAll(() => {
  dom.cleanup();
});

function token(fontStyle: number): ThemedToken {
  return { content: 'x', offset: 0, color: '#ffffff', fontStyle };
}

describe('createSpanFromToken', () => {
  test('preserves custom attributes and applies token style precedence', () => {
    for (const [fields, color] of [
      [{}, 'green'],
      [{ color: 'red' }, 'red'],
      [{ color: 'red', htmlStyle: { color: 'blue' } }, 'blue'],
      [{ color: 'red', htmlStyle: {} }, 'green'],
    ] as const) {
      const element = createSpanFromToken({
        content: '<&',
        offset: 0,
        htmlAttrs: { style: 'color:green', class: 'custom', 'data-token': '' },
        ...fields,
      });
      expect(element.style.color).toBe(color);
      expect(element.className).toBe('custom');
      expect(element.hasAttribute('data-token')).toBe(true);
      expect(element.textContent).toBe('<&');
      expect(element.childElementCount).toBe(0);
    }
  });

  test('renders each FontStyle bit', () => {
    expect(createSpanFromToken(token(1)).style.fontStyle).toBe('italic');
    expect(createSpanFromToken(token(2)).style.fontWeight).toBe('bold');
    expect(createSpanFromToken(token(4)).style.textDecoration).toBe(
      'underline'
    );
    expect(createSpanFromToken(token(8)).style.textDecoration).toBe(
      'line-through'
    );
  });

  test('combines underline and strikethrough like shiki', () => {
    expect(createSpanFromToken(token(4 | 8)).style.textDecoration).toBe(
      'underline line-through'
    );
  });
});
