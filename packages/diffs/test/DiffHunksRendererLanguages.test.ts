import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';

import {
  DiffHunksRenderer,
  disposeHighlighter,
  getHighlighterIfLoaded,
  getSharedHighlighter,
  parseDiffFromFile,
} from '../src';
import { assertDefined, createDeferred } from './testUtils';

beforeEach(disposeHighlighter);
afterEach(disposeHighlighter);

const python = {
  name: 'example.py',
  contents: 'print("python")\n',
  language: 'python',
} as const;
const javascript = {
  name: 'example.js',
  contents: 'console.log("javascript");\n',
  language: 'javascript',
} as const;
const renames = [
  [python, javascript],
  [javascript, python],
] as const;
const options = { theme: 'pierre-dark', diffStyle: 'split' } as const;

describe('DiffHunksRenderer language loading without workers', () => {
  test('the bundled Terraform loader renders an ordinary .tf edit and provides its aliases', async () => {
    const renderer = new DiffHunksRenderer(options);
    try {
      const diff = parseDiffFromFile(
        { name: 'example.tf', contents: 'locals {\n  label = "before"\n}\n' },
        { name: 'example.tf', contents: 'locals {\n  label = "after"\n}\n' }
      );
      expect(await renderer.asyncRender(diff)).toBeDefined();
      const highlighter = getHighlighterIfLoaded();
      assertDefined(highlighter, 'expected the highlighter to be loaded');
      for (const lang of ['terraform', 'tf', 'tfvars']) {
        expect(highlighter.getLoadedLanguages()).toContain(lang);
        expect(
          highlighter.codeToTokens('locals { label = "after" }', {
            lang,
            theme: options.theme,
          }).tokens.length
        ).toBeGreaterThan(0);
      }
    } finally {
      renderer.cleanUp();
    }
  });

  const cases = [
    [python, { ...python, contents: 'print("changed")\n' }],
    [javascript, { ...javascript, contents: 'console.log("changed");\n' }],
    ...renames,
  ] as const;

  for (const [oldFile, newFile] of cases) {
    for (const preloadDestination of [false, true]) {
      test(`asyncRender ${oldFile.language} -> ${newFile.language}, ${preloadDestination ? 'destination loaded' : 'cold'}`, async () => {
        if (preloadDestination) {
          const highlighter = await getSharedHighlighter({
            themes: [options.theme],
            langs: [newFile.language],
          });
          if (oldFile.language !== newFile.language) {
            expect(highlighter.getLoadedLanguages()).not.toContain(
              oldFile.language
            );
          }
        } else {
          expect(getHighlighterIfLoaded()).toBeUndefined();
        }

        const renderer = new DiffHunksRenderer(options);
        try {
          const diff = parseDiffFromFile(oldFile, newFile);
          if (oldFile.name === newFile.name) {
            expect(diff.prevName).toBeUndefined();
          }
          await renderer.asyncRender(diff);
          const highlighter = getHighlighterIfLoaded();
          assertDefined(highlighter, 'expected the highlighter to be loaded');
          expect(highlighter.getLoadedLanguages()).toContain(oldFile.language);
          expect(highlighter.getLoadedLanguages()).toContain(newFile.language);
        } finally {
          renderer.cleanUp();
        }
      });
    }
  }

  for (const [oldFile, newFile] of renames) {
    test(`renderDiff ${oldFile.language} -> ${newFile.language} loads the missing source grammar`, async () => {
      const highlighter = await getSharedHighlighter({
        themes: [options.theme],
        langs: [newFile.language],
      });
      expect(highlighter.getLoadedLanguages()).not.toContain(oldFile.language);
      const updated = createDeferred<void>();
      const renderer = new DiffHunksRenderer(options, undefined, () => {
        updated.resolve();
      });
      try {
        const diff = parseDiffFromFile(oldFile, newFile);
        const initial = renderer.renderDiff(diff);
        // Wait for the background render before assertions or cleanup can
        // dispose a highlighter that is still loading the missing grammar.
        await updated.promise;
        expect(initial).toBeDefined();
        expect(highlighter.getLoadedLanguages()).toContain(oldFile.language);
        expect(highlighter.getLoadedLanguages()).toContain(newFile.language);
        expect(renderer.renderDiff(diff)).toBeDefined();
      } finally {
        renderer.cleanUp();
      }
    });

    test(`hydrate preloads both grammars for ${oldFile.language} -> ${newFile.language}`, async () => {
      const renderer = new DiffHunksRenderer(options);
      const initialize = spyOn(renderer, 'initializeHighlighter');
      try {
        const diff = parseDiffFromFile(oldFile, newFile);
        renderer.hydrate(diff);
        await initialize.mock.results[0]?.value;
        expect(initialize).toHaveBeenCalledTimes(1);
        const highlighter = getHighlighterIfLoaded();
        assertDefined(highlighter, 'expected the highlighter to be loaded');
        expect(highlighter.getLoadedLanguages()).toContain(oldFile.language);
        expect(highlighter.getLoadedLanguages()).toContain(newFile.language);
      } finally {
        initialize.mockRestore();
        renderer.cleanUp();
      }
    });
  }

  for (const lang of ['json', 'text'] as const) {
    test(`an explicit ${lang} override takes precedence over both filenames`, async () => {
      const renderer = new DiffHunksRenderer(options);
      try {
        const diff = { ...parseDiffFromFile(python, javascript), lang };
        await renderer.asyncRender(diff);
        const highlighter = getHighlighterIfLoaded();
        assertDefined(highlighter, 'expected the highlighter to be loaded');
        const languages = highlighter.getLoadedLanguages();
        expect(languages).not.toContain('python');
        expect(languages).not.toContain('javascript');
        if (lang !== 'text') {
          expect(languages).toContain(lang);
        }
      } finally {
        renderer.cleanUp();
      }
    });
  }

  test('a rename above the size threshold does not load either grammar', async () => {
    const renderer = new DiffHunksRenderer({
      ...options,
      tokenizeMaxLength: 0,
    });
    try {
      await renderer.asyncRender(parseDiffFromFile(python, javascript));
      const highlighter = getHighlighterIfLoaded();
      assertDefined(highlighter, 'expected the highlighter to be loaded');
      const languages = highlighter.getLoadedLanguages();
      expect(languages).not.toContain('python');
      expect(languages).not.toContain('javascript');
    } finally {
      renderer.cleanUp();
    }
  });
});
