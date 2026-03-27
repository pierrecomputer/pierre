import { describe, expect, test } from 'bun:test';

import { preloadFile } from '../src/ssr';
import { mockFiles } from './mocks';

describe('preloaded theme type', () => {
  test('hardcoded themes use their own light or dark mode', async () => {
    const { prerenderedHTML } = await preloadFile({
      file: mockFiles.file1,
      options: {
        theme: 'pierre-dark',
        themeType: 'light',
      },
    });

    expect(prerenderedHTML).toContain('color-scheme: dark;');
    expect(prerenderedHTML).not.toContain('color-scheme: light;');
  });

  test('paired themes still respect the requested themeType switch', async () => {
    const { prerenderedHTML } = await preloadFile({
      file: mockFiles.file1,
      options: {
        theme: { dark: 'pierre-dark', light: 'pierre-light' },
        themeType: 'light',
      },
    });

    expect(prerenderedHTML).toContain('color-scheme: light;');
    expect(prerenderedHTML).not.toContain('color-scheme: dark;');
  });
});
