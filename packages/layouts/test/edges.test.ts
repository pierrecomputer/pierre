import { describe, expect, test } from 'bun:test';

import { computeCSSLayout } from '../src/css-layout';
import type { LayoutNode } from '../src/types';

const edgesOf = (root: LayoutNode): Record<string, string> =>
  Object.fromEntries(
    computeCSSLayout(root).panes.map(({ pane, edges }) => [
      pane.id,
      (['top', 'right', 'bottom', 'left'] as const)
        .filter((edge) => edges[edge])
        .join(' '),
    ])
  );

describe('pane edges', () => {
  test('a lone root pane touches every edge', () => {
    expect(edgesOf({ type: 'pane', id: 'only' })).toEqual({
      only: 'top right bottom left',
    });
  });

  test('nested splits give each pane the edges it touches', () => {
    const root: LayoutNode = {
      type: 'split',
      id: 'outer',
      direction: 'horizontal',
      sizes: [1, 1],
      children: [
        { type: 'pane', id: 'files' },
        {
          type: 'split',
          id: 'inner',
          direction: 'vertical',
          sizes: [1, 1, 1],
          children: [
            { type: 'pane', id: 'editor' },
            { type: 'pane', id: 'preview' },
            { type: 'pane', id: 'terminal' },
          ],
        },
      ],
    };
    expect(edgesOf(root)).toEqual({
      files: 'top bottom left',
      editor: 'top right',
      preview: 'right',
      terminal: 'right bottom',
    });
  });

  test('a hidden pane gives its edges to the next shown pane', () => {
    const root: LayoutNode = {
      type: 'split',
      id: 'column',
      direction: 'vertical',
      sizes: [1, 1, 1],
      children: [
        { type: 'pane', id: 'first', hidden: true },
        { type: 'pane', id: 'second' },
        { type: 'pane', id: 'third' },
      ],
    };
    expect(edgesOf(root)).toEqual({
      first: '',
      second: 'top right left',
      third: 'right bottom left',
    });
  });

  test('only the shown tab of a stack has edges', () => {
    const root: LayoutNode = {
      type: 'split',
      id: 'row',
      direction: 'horizontal',
      sizes: [1, 1],
      children: [
        {
          type: 'stack',
          id: 'tabs',
          active: 'b',
          children: [
            { type: 'pane', id: 'a' },
            { type: 'pane', id: 'b' },
          ],
        },
        { type: 'pane', id: 'c' },
      ],
    };
    expect(edgesOf(root)).toEqual({
      a: '',
      b: 'top bottom left',
      c: 'top right bottom',
    });
  });
});
