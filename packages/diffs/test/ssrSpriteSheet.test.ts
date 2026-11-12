import { afterAll, describe, expect, test } from 'bun:test';

import { File, FileDiff, parseDiffFromFile, SVGSpriteSheet } from '../src';
import { disposeHighlighter } from '../src/highlighter/shared_highlighter';
import { preloadFile, preloadFileDiff } from '../src/ssr';
import { installDom } from './domHarness';

afterAll(disposeHighlighter);

const options = { theme: 'pierre-dark' } as const;
const file = { name: 'example.ts', contents: 'const answer = 1;\n' };
const allIcons = Array.from(
  SVGSpriteSheet.matchAll(/<symbol id="([^"]+)"/g),
  ([, id]) => id
);

function spriteOf(html: string): string {
  return /<svg data-icon-sprite[^>]*>[\s\S]*?<\/svg>/.exec(html)?.[0] ?? '';
}

function iconsIn(sprite: string): string[] {
  return Array.from(sprite.matchAll(/<symbol id="([^"]+)"/g), ([, id]) => id);
}

describe('prerendered sprite sheet', () => {
  test('carries no icons when the markup uses none', async () => {
    const { prerenderedHTML } = await preloadFile({
      file,
      options: { ...options, disableFileHeader: true },
    });
    const sprite = spriteOf(prerenderedHTML);
    expect(sprite).toContain('data-icon-sprite-partial');
    expect(iconsIn(sprite)).toEqual([]);
  });

  test('carries exactly the icons the markup references', async () => {
    const oldFile = {
      name: 'example.ts',
      contents: Array.from({ length: 40 }, (_, i) => `line ${i}`).join('\n'),
    };
    const newFile = {
      ...oldFile,
      contents: oldFile.contents.replace('line 20', 'line twenty'),
    };
    const { prerenderedHTML } = await preloadFileDiff({
      fileDiff: parseDiffFromFile(oldFile, newFile),
      options,
    });
    const referenced = new Set(
      Array.from(prerenderedHTML.matchAll(/href="#([^"]+)"/g), ([, id]) => id)
    );
    expect(referenced.size).toBeGreaterThan(0);
    expect(new Set(iconsIn(spriteOf(prerenderedHTML)))).toEqual(referenced);
  });

  test('File hydration swaps in the full sheet', async () => {
    const { prerenderedHTML } = await preloadFile({
      file,
      options: { ...options, disableFileHeader: true },
    });
    const { cleanup } = installDom();
    const instance = new File({
      ...options,
      disableFileHeader: true,
      disableErrorHandling: true,
    });
    try {
      const fileContainer = document.createElement('div');
      instance.hydrate({ file, fileContainer, prerenderedHTML });
      const sprites =
        fileContainer.shadowRoot?.querySelectorAll('[data-icon-sprite]') ?? [];
      expect(sprites.length).toBe(1);
      expect(sprites[0].hasAttribute('data-icon-sprite-partial')).toBe(false);
      expect(
        Array.from(sprites[0].querySelectorAll('symbol'), (s) => s.id)
      ).toEqual(allIcons);
    } finally {
      instance.cleanUp();
      cleanup();
    }
  });

  test('FileDiff hydration swaps in the full sheet', async () => {
    const newFile = { ...file, contents: 'const answer = 2;\n' };
    const fileDiff = parseDiffFromFile(file, newFile);
    const { prerenderedHTML } = await preloadFileDiff({ fileDiff, options });
    const { cleanup } = installDom();
    const instance = new FileDiff({ ...options, disableErrorHandling: true });
    try {
      const fileContainer = document.createElement('div');
      instance.hydrate({ fileDiff, fileContainer, prerenderedHTML });
      const sprites =
        fileContainer.shadowRoot?.querySelectorAll('[data-icon-sprite]') ?? [];
      expect(sprites.length).toBe(1);
      expect(
        Array.from(sprites[0].querySelectorAll('symbol'), (s) => s.id)
      ).toEqual(allIcons);
    } finally {
      instance.cleanUp();
      cleanup();
    }
  });
});
