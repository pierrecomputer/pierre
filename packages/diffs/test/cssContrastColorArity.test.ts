import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// CSS files that ship with the package. The tests below check every
// `contrast-color()` call in them.
const STYLESHEETS = ['../src/style.css', '../src/editor/editor.css'];

// Splits a `contrast-color()` argument list into its top-level arguments. A
// comma inside `var()`, `light-dark()`, or `color-mix()` does not split.
function splitTopLevelArgs(args: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const char of args) {
    if (char === '(') {
      depth += 1;
    } else if (char === ')') {
      depth -= 1;
    } else if (char === ',' && depth === 0) {
      parts.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }
  parts.push(current.trim());
  return parts;
}

// Returns the argument list of every `contrast-color()` call in `css`. It counts
// nested parens to find the closing paren of each call.
function findContrastColorArgs(css: string): string[] {
  const calls: string[] = [];
  const marker = 'contrast-color(';
  let index = css.indexOf(marker);
  while (index !== -1) {
    let depth = 1;
    let cursor = index + marker.length;
    while (cursor < css.length && depth > 0) {
      if (css[cursor] === '(') {
        depth += 1;
      } else if (css[cursor] === ')') {
        depth -= 1;
      }
      cursor += 1;
    }
    calls.push(css.slice(index + marker.length, cursor - 1));
    index = css.indexOf(marker, cursor);
  }
  return calls;
}

// Regression test for white text on the yellow warning popover.
// `contrast-color()` takes one argument. A call with two arguments still parses,
// because `var()` defers the grammar check to substitution. The declaration is
// then invalid at computed-value time, so `color` inherits its value and ignores
// the `--diffs-marker-contrast` declaration. No browser test catches this:
// Playwright bundles an old Chromium without `contrast-color()`, so it runs the
// fallback branch only.
describe('contrast-color() arity in shipped CSS', () => {
  for (const stylesheet of STYLESHEETS) {
    test(`${stylesheet} passes one argument per call`, () => {
      const css = readFileSync(resolve(__dirname, stylesheet), 'utf-8');
      for (const args of findContrastColorArgs(css)) {
        expect(
          splitTopLevelArgs(args),
          `contrast-color(${args}) must take exactly one argument`
        ).toHaveLength(1);
      }
    });
  }

  test('detects a two-argument call', () => {
    expect(
      splitTopLevelArgs(
        findContrastColorArgs(
          'a { color: contrast-color(var(--a), light-dark(#000, #fff)); }'
        )[0]
      )
    ).toHaveLength(2);
  });
});
