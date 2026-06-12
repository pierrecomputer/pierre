import { afterAll, describe, expect, test } from 'bun:test';
import type { Element as HASTElement } from 'hast';

import {
  areSpanDecorationsEqual,
  DiffHunksRenderer,
  disposeHighlighter,
  FileRenderer,
  parseDiffFromFile,
} from '../src';
import type { DiffSpanDecoration, SpanDecoration } from '../src/types';
import { assertDefined, collectAllElements, isHastElement } from './testUtils';

afterAll(async () => {
  await disposeHighlighter();
});

function getElementClasses(el: HASTElement): string[] {
  const value = el.properties?.['className'] ?? el.properties?.['class'];
  if (Array.isArray(value)) {
    return value.map(String);
  }
  return typeof value === 'string' ? value.split(/\s+/) : [];
}

function isSpanDecorationElement(el: HASTElement): boolean {
  return el.properties?.['data-span-decoration'] != null;
}

function flattenText(el: HASTElement): string {
  let text = '';
  for (const child of el.children) {
    if (child.type === 'text') {
      text += child.value;
    } else if (isHastElement(child)) {
      text += flattenText(child);
    }
  }
  return text;
}

describe('Span Decorations', () => {
  describe('FileRenderer', () => {
    const file = {
      name: 'example.ts',
      contents: 'const alpha = 1;\nconst beta = 2;\nconst gamma = 3;\n',
    };

    test('wraps the addressed character range with the consumer class', async () => {
      const decorations: SpanDecoration[] = [
        { lineNumber: 2, spanStart: 6, spanLength: 4, className: 'hl-risk' },
      ];
      const renderer = new FileRenderer();
      renderer.setSpanDecorations(decorations);
      const result = await renderer.asyncRender(file);
      const ast = renderer.renderCodeAST(result);
      const decorated = collectAllElements(ast).filter(isSpanDecorationElement);
      expect(decorated.length).toBe(1);
      expect(getElementClasses(decorated[0])).toContain('hl-risk');
      expect(flattenText(decorated[0])).toBe('beta');
    });

    test('drops zero/negative-length spans and out-of-range lines', async () => {
      const decorations: SpanDecoration[] = [
        { lineNumber: 1, spanStart: 0, spanLength: 0, className: 'noop' },
        { lineNumber: 99, spanStart: 0, spanLength: 1, className: 'noop' },
      ];
      const renderer = new FileRenderer();
      renderer.setSpanDecorations(decorations);
      const result = await renderer.asyncRender(file);
      const ast = renderer.renderCodeAST(result);
      const decorated = collectAllElements(ast).filter(isSpanDecorationElement);
      expect(decorated.length).toBe(0);
    });
  });

  describe('DiffHunksRenderer', () => {
    const oldFile = {
      name: 'example.ts',
      contents: 'const a = one;\nconst b = two;\nconst c = three;\n',
    };
    const newFile = {
      name: 'example.ts',
      contents: 'const a = one;\nconst b = TWO;\nconst c = three;\n',
    };
    const diff = parseDiffFromFile(oldFile, newFile);

    test('wraps the addressed range on the addressed side and coexists with intra-line diff spans', async () => {
      const decorations: DiffSpanDecoration[] = [
        {
          side: 'additions',
          lineNumber: 2,
          spanStart: 6,
          spanLength: 1,
          className: 'hl-add',
        },
        {
          side: 'deletions',
          lineNumber: 2,
          spanStart: 6,
          spanLength: 1,
          className: 'hl-del',
        },
      ];
      const renderer = new DiffHunksRenderer({
        diffStyle: 'unified',
        expandUnchanged: true,
      });
      renderer.setSpanDecorations(decorations);
      const { unifiedContentAST } = await renderer.asyncRender(diff);
      assertDefined(unifiedContentAST, 'unifiedContentAST should be defined');
      const all = collectAllElements(unifiedContentAST);

      const decorated = all.filter(isSpanDecorationElement);
      expect(decorated.length).toBe(2);
      const byClass = new Map(
        decorated.map((el) => [getElementClasses(el).join(' '), el])
      );
      const add = byClass.get('hl-add');
      const del = byClass.get('hl-del');
      assertDefined(add, 'addition decoration should render');
      assertDefined(del, 'deletion decoration should render');
      expect(flattenText(add)).toBe('b');
      expect(flattenText(del)).toBe('b');

      // The engine's own intra-line diff highlight (data-diff-span) must still
      // be present on the same change line — consumer spans compose, not
      // replace.
      const diffSpans = all.filter(
        (el) => el.properties?.['data-diff-span'] != null
      );
      expect(diffSpans.length).toBeGreaterThan(0);
      const diffSpanTexts = diffSpans.map(flattenText);
      expect(diffSpanTexts).toContain('TWO');
    });

    test('decorations on lines outside the rendered diff are dropped', async () => {
      const decorations: DiffSpanDecoration[] = [
        {
          side: 'additions',
          lineNumber: 999,
          spanStart: 0,
          spanLength: 1,
          className: 'noop',
        },
      ];
      const renderer = new DiffHunksRenderer({ diffStyle: 'unified' });
      renderer.setSpanDecorations(decorations);
      const { unifiedContentAST } = await renderer.asyncRender(diff);
      assertDefined(unifiedContentAST, 'unifiedContentAST should be defined');
      const decorated = collectAllElements(unifiedContentAST).filter(
        isSpanDecorationElement
      );
      expect(decorated.length).toBe(0);
    });

    test('decorations participate in render-options equality', () => {
      const a: DiffSpanDecoration[] = [
        {
          side: 'additions',
          lineNumber: 1,
          spanStart: 0,
          spanLength: 1,
          className: 'x',
        },
      ];
      const b: DiffSpanDecoration[] = [
        {
          side: 'additions',
          lineNumber: 1,
          spanStart: 0,
          spanLength: 1,
          className: 'x',
        },
      ];
      expect(areSpanDecorationsEqual(a, b)).toBe(true);
      expect(areSpanDecorationsEqual(a, undefined)).toBe(false);
      expect(areSpanDecorationsEqual(undefined, undefined)).toBe(true);
      expect(areSpanDecorationsEqual([], undefined)).toBe(true);
      expect(areSpanDecorationsEqual(a, [{ ...a[0], className: 'y' }])).toBe(
        false
      );
    });
  });
});
