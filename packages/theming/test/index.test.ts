import { describe, expect, test } from 'bun:test';

import * as core from '../src/index';

describe('core entry surface', () => {
  test('exposes the catalog / collection / controller / resolver primitives', () => {
    expect(typeof core.createThemeCatalog).toBe('function');
    expect(typeof core.createThemeCollection).toBe('function');
    expect(typeof core.createThemeController).toBe('function');
    expect(typeof core.createThemeResolver).toBe('function');
    expect(typeof core.DuplicateThemeError).toBe('function');
  });
});
