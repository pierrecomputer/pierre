import { describe, expect, test } from 'bun:test';

import { computePiecewiseCSSLayout } from '../src/css-layout';
import { computeLayout } from '../src/geometry';
import {
  add,
  clamp,
  constant,
  evaluate,
  max,
  min,
  scale,
  size,
  toCSS,
} from '../src/piecewise';
import type { LayoutNode } from '../src/types';

// A small seeded generator, so that a failure repeats.
function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
}

function randomTree(
  next: () => number,
  panes: number,
  ids = { n: 0 }
): LayoutNode {
  if (panes === 1)
    return {
      type: 'pane',
      id: `p${ids.n++}`,
      minWidth: Math.round(20 + next() * 300),
      minHeight: Math.round(20 + next() * 200),
    };
  const first = 1 + Math.floor(next() * (panes - 1));
  const extreme = next() < 0.2;
  return {
    type: 'split',
    id: `s${ids.n++}`,
    direction: next() < 0.5 ? 'horizontal' : 'vertical',
    ratio: extreme ? Math.round(next()) : next(),
    first: randomTree(next, first, ids),
    second: randomTree(next, panes - first, ids),
  };
}

/** Evaluate a value that `toCSS` wrote, for a container size in pixels. */
function evaluateCSS(value: string, containerSize: number): number {
  const terms = (value.startsWith('calc(') ? value.slice(5, -1) : value).split(
    ' + '
  );
  let total = 0;
  for (const term of terms) {
    const hinge =
      /^(-?[\d.e-]+) \* max\(0px, 100cq[wh] - (-?[\d.e-]+)px\)$/.exec(term);
    const linear = /^(-?[\d.e-]+) \* 100cq[wh]$/.exec(term);
    if (hinge !== null)
      total += Number(hinge[1]) * Math.max(0, containerSize - Number(hinge[2]));
    else if (linear !== null) total += Number(linear[1]) * containerSize;
    else if (/^100cq[wh]$/.test(term)) total += containerSize;
    else if (term.endsWith('px')) total += Number(term.slice(0, -2));
    else throw new Error(`Unknown term: ${term}`);
  }
  return total;
}

describe('piecewise', () => {
  test('min, max, and clamp follow the branch that applies at each size', () => {
    const x = size();
    const f = clamp(
      constant(10),
      add(scale(x, 0.5), constant(-4)),
      add(x, constant(-20))
    );
    for (const value of [0, 5, 20, 28, 30, 36, 100, 1000])
      expect(evaluate(f, value)).toBeCloseTo(
        Math.max(10, Math.min(value * 0.5 - 4, value - 20)),
        9
      );
    expect(evaluate(min(x, constant(8)), 3)).toBe(3);
    expect(evaluate(max(constant(0), add(x, constant(-8))), 3)).toBe(0);
  });

  test('toCSS writes a hinge term only where the slope changes', () => {
    const x = size();
    expect(toCSS(x, '100cqw')).toBe('100cqw');
    expect(toCSS(constant(12), '100cqw')).toBe('12px');
    expect(toCSS(add(scale(x, 0.25), constant(-6)), '100cqw')).toBe(
      'calc(-6px + 0.25 * 100cqw)'
    );
    expect(toCSS(max(constant(0), add(x, constant(-8))), '100cqw')).toBe(
      'calc(1 * max(0px, 100cqw - 8px))'
    );
    // Without hinges, only the form for large sizes remains.
    expect(toCSS(max(constant(0), add(x, constant(-8))), '100cqw', false)).toBe(
      'calc(-8px + 100cqw)'
    );
  });

  test('the piecewise layout gives the boxes of computeLayout at every size', () => {
    const next = random(7);
    for (let tree = 0; tree < 200; tree++) {
      const root = randomTree(next, 1 + Math.floor(next() * 24));
      const gap = next() < 0.2 ? 0 : Math.round(next() * 16);
      const css = computePiecewiseCSSLayout(root, gap);
      const panes = new Map(css.panes.map(({ pane, rect }) => [pane.id, rect]));
      const separators = new Map(
        css.separators.map(({ split, rect }) => [split.id, rect])
      );
      for (let sample = 0; sample < 20; sample++) {
        const width = next() < 0.3 ? next() * 100 : next() * 4000;
        const height = next() < 0.3 ? next() * 100 : next() * 3000;
        const pixels = computeLayout(root, width, height, gap);
        const boxes = [
          ...pixels.panes.map(({ pane, rect }) => ({
            rect,
            css: panes.get(pane.id),
          })),
          ...pixels.separators.map(({ split, rect }) => ({
            rect,
            css: separators.get(split.id),
          })),
        ];
        for (const { rect, css: value } of boxes) {
          if (value === undefined) throw new Error('missing box');
          expect(
            Math.abs(evaluateCSS(value.left, width) - rect.x)
          ).toBeLessThan(0.01);
          expect(
            Math.abs(evaluateCSS(value.width, width) - rect.width)
          ).toBeLessThan(0.01);
          expect(
            Math.abs(evaluateCSS(value.top, height) - rect.y)
          ).toBeLessThan(0.01);
          expect(
            Math.abs(evaluateCSS(value.height, height) - rect.height)
          ).toBeLessThan(0.01);
        }
      }
    }
  });
});
