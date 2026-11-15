import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';

import { generateStylesheet, STYLE_SHEETS } from '../scripts/generate-styles';

const read = (path: string): string =>
  readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8');

const SHEETS = readdirSync(new URL('../src/css', import.meta.url)).filter(
  (name) => name.endsWith('.css')
);

describe('stylesheets', () => {
  test('styles.css holds every sheet, as the script writes it', () => {
    expect([...STYLE_SHEETS].sort()).toEqual(
      SHEETS.map((name) => name.replace(/\.css$/, '')).sort()
    );
    expect(read('styles.css')).toBe(generateStylesheet());
  });

  test('every rule of a sheet is in the pierre-layouts layer', () => {
    for (const path of SHEETS.map((name) => `css/${name}`)) {
      const text = read(path)
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .trim();
      expect(text.startsWith('@layer pierre-layouts {')).toBe(true);
      // The block of the layer closes at the end of the file, so no rule is
      // outside it.
      let depth = 0;
      let closed = -1;
      for (let index = 0; index < text.length; index++) {
        if (text[index] === '{') depth++;
        if (text[index] === '}' && --depth === 0) {
          closed = index;
          break;
        }
      }
      expect(closed).toBe(text.length - 1);
    }
  });
});
