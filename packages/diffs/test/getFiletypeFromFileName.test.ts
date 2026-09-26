import { afterEach, describe, expect, test } from 'bun:test';

import {
  getCustomExtensionsVersion,
  getFiletypeFromFileName,
  replaceCustomExtensions,
  setCustomExtension,
} from '../src/utils/getFiletypeFromFileName';

describe('getFiletypeFromFileName', () => {
  test('detects languages from simple and compound extensions', () => {
    expect(getFiletypeFromFileName('foo.ts')).toBe('typescript');
    expect(getFiletypeFromFileName('src/nested/foo.py')).toBe('python');
    expect(getFiletypeFromFileName('src/app.component.ts')).toBe('angular-ts');
  });

  test('matches exact filenames at the top level', () => {
    expect(getFiletypeFromFileName('Dockerfile')).toBe('dockerfile');
    expect(getFiletypeFromFileName('Makefile')).toBe('makefile');
    expect(getFiletypeFromFileName('CMakeLists.txt')).toBe('cmake');
  });

  test('matches exact filenames nested in a path', () => {
    expect(getFiletypeFromFileName('docker/Dockerfile')).toBe('dockerfile');
    expect(getFiletypeFromFileName('build/tools/Makefile')).toBe('makefile');
    expect(getFiletypeFromFileName('project/CMakeLists.txt')).toBe('cmake');
    expect(getFiletypeFromFileName('project\\win\\Dockerfile')).toBe(
      'dockerfile'
    );
  });

  test('prefers a real extension over the basename retry', () => {
    // The retry only runs once the full path has matched nothing, so an extension still wins.
    expect(getFiletypeFromFileName('docker/Dockerfile.ts')).toBe('typescript');
  });

  test('falls back to plain text for unknown files', () => {
    expect(getFiletypeFromFileName('notes')).toBe('text');
    expect(getFiletypeFromFileName('path/to/notes')).toBe('text');
    expect(getFiletypeFromFileName('')).toBe('text');
  });

  test('does not read inherited properties of the extension map', () => {
    expect(getFiletypeFromFileName('constructor')).toBe('text');
    expect(getFiletypeFromFileName('toString')).toBe('text');
    expect(getFiletypeFromFileName('src/constructor')).toBe('text');
    expect(getFiletypeFromFileName('src/toString')).toBe('text');
    expect(getFiletypeFromFileName('src/__proto__')).toBe('text');
    expect(getFiletypeFromFileName('foo.constructor')).toBe('text');
    expect(getFiletypeFromFileName('foo.valueOf')).toBe('text');
  });

  test('honors an explicit plain-text override on a full path', () => {
    setCustomExtension('src/example.ts', 'text');
    expect(getFiletypeFromFileName('src/example.ts')).toBe('text');
  });

  afterEach(() => {
    // setCustomExtension has no removal API; reset the map for other suites.
    replaceCustomExtensions(getCustomExtensionsVersion() + 1, {});
  });
});
