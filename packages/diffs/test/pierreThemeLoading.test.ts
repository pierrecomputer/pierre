import { afterEach, describe, expect, test } from 'bun:test';
import { execSync } from 'child_process';
import { resolve } from 'path';

import {
  disposeHighlighter,
  getSharedHighlighter,
} from '../src/highlighter/shared_highlighter';
import { preloadDiffHTML } from '../src/ssr';
import { parseDiffFromFile } from '../src/utils/parseDiffFromFile';
import { mockFiles } from './mocks';

afterEach(async () => {
  await disposeHighlighter();
});

const packageRoot = resolve(__dirname, '..');

describe('pierre theme loading', () => {
  // Node.js 22+ requires `with { type: 'json' }` on dynamic import() of
  // .json files. Without it, Node throws ERR_IMPORT_ATTRIBUTE_MISSING.

  test('Node rejects dynamic import of .json without { type: "json" }', () => {
    // This test documents the Node 22+ behavior that motivates the fix.
    // A bare `import('...json')` without the attribute must fail.
    const script = `
      try {
        await import('@pierre/theme/themes/pierre-dark.json');
        console.log('no-error');
      } catch (e) {
        console.log(e.code);
      }
    `;

    const result = execSync(`node --input-type=module -e "${script}"`, {
      cwd: packageRoot,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    expect(result.trim()).toBe('ERR_IMPORT_ATTRIBUTE_MISSING');
  });

  test('Node accepts dynamic import of .json with { type: "json" }', () => {
    const script = `
      const m = await import('@pierre/theme/themes/pierre-dark.json', { with: { type: 'json' } });
      const theme = m.default ?? m;
      if (!theme.name && !theme.colors) throw new Error('invalid theme data');
      console.log('ok');
    `;

    const result = execSync(`node --input-type=module -e "${script}"`, {
      cwd: packageRoot,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    expect(result.trim()).toBe('ok');
  });

  test('published diffs package loads pierre-dark on Node without ERR_IMPORT_ATTRIBUTE_MISSING', () => {
    // This is the end-to-end test: build the package, then load the
    // pierre-dark theme through the actual shared_highlighter entry point
    // under Node. If the import attribute is missing in the built output,
    // Node 22+ will throw ERR_IMPORT_ATTRIBUTE_MISSING.
    const script = `
      const { getSharedHighlighter } = await import('@pierre/diffs');
      try {
        const h = await getSharedHighlighter({
          themes: ['pierre-dark'],
          langs: ['text'],
          preferredHighlighter: 'shiki-js',
        });
        const loaded = h.getLoadedThemes();
        if (!loaded.includes('pierre-dark')) throw new Error('theme not loaded');
        console.log('ok');
      } catch (e) {
        console.log(e.code ?? e.message);
      }
    `;

    // Build first so dist/ reflects current source
    execSync('bun run build', { cwd: packageRoot, stdio: 'pipe' });

    const result = execSync(`node --input-type=module -e "${script}"`, {
      cwd: packageRoot,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    expect(result.trim()).toBe('ok');
  });

  test('loads pierre-dark theme and renders a diff', async () => {
    const highlighter = await getSharedHighlighter({
      themes: ['pierre-dark'],
      langs: ['typescript'],
      preferredHighlighter: 'shiki-js',
    });

    expect(highlighter.getLoadedThemes()).toContain('pierre-dark');

    const fileDiff = parseDiffFromFile(mockFiles.file1, {
      ...mockFiles.file1,
      contents: mockFiles.file1.contents + '\n// added line\n',
    });

    const html = await preloadDiffHTML({
      fileDiff,
      options: { theme: 'pierre-dark' },
    });

    expect(html.length).toBeGreaterThan(0);
    expect(html).toContain('color-scheme: dark');
  });
});
