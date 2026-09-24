import { preloadFile, type PreloadFileOptions } from '@pierre/diffs/ssr';
import { describe, expect, test } from 'bun:test';

import { preloadCodeExample } from '../lib/preloadCodeExample';

describe('code example hydration data', () => {
  test('reconstructs the original HTML and preserves per-example data', async () => {
    const input: PreloadFileOptions<string, undefined> = {
      file: { name: 'example.ts', contents: 'const answer = 42;\n' },
      options: {
        theme: { dark: 'pierre-dark', light: 'pierre-light' },
        unsafeCSS: ':host { --diffs-font-size: 14px; }',
      },
      annotations: [{ lineNumber: 1, metadata: 'annotation' }],
    };
    const original = await preloadFile(input);
    const compact = await preloadCodeExample(input);
    const { shared, content } = compact.prerenderedHTML;

    expect({ ...compact, prerenderedHTML: shared.html + content }).toEqual(
      original
    );
    expect(shared.html).toContain('data-icon-sprite');
    expect(shared.html).toContain('data-core-css');
    expect(shared.html).not.toContain('data-theme-css');
    expect(content).not.toContain('data-core-css');
    expect(content).toContain('data-theme-css');
    expect(content).toContain('data-unsafe-css');
  });

  test('different snippets and themes have identical shared markup', async () => {
    const [light, dark] = await Promise.all([
      preloadCodeExample({
        file: { name: 'first.ts', contents: 'const first = 1;' },
        options: { theme: 'pierre-light', disableFileHeader: true },
      }),
      preloadCodeExample({
        file: { name: 'second.ts', contents: 'const second = 2;' },
        options: { theme: 'pierre-dark' },
      }),
    ]);

    expect(light.prerenderedHTML.shared.html).toBe(
      dark.prerenderedHTML.shared.html
    );
    expect(light.prerenderedHTML.content).not.toBe(
      dark.prerenderedHTML.content
    );
  });
});
