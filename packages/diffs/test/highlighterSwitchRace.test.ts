import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test';
import { toHtml } from 'hast-util-to-html';

import {
  disposeHighlighter,
  getSharedHighlighter,
} from '../src/highlighter/shared_highlighter';
import { DiffHunksRenderer } from '../src/renderers/DiffHunksRenderer';
import { FileRenderer } from '../src/renderers/FileRenderer';
import { parseDiffFromFile } from '../src/utils/parseDiffFromFile';
import { createDeferred } from './testUtils';

beforeEach(disposeHighlighter);
afterEach(disposeHighlighter);

test('diff discards a pending refresh after switching backends', async () => {
  for (const preferredHighlighter of ['shiki-js', 'highlights'] as const) {
    await getSharedHighlighter({
      themes: ['pierre-dark'],
      langs: ['typescript'],
      preferredHighlighter,
    });
  }
  const diff = parseDiffFromFile(
    { name: 'race.ts', contents: 'const before = "old";\n' },
    { name: 'race.ts', contents: 'const after = "new";\n' }
  );
  const options = {
    theme: 'pierre-dark',
    preferredHighlighter: 'shiki-js',
  } as const;
  const renderer = new DiffHunksRenderer(options);
  try {
    const initial = renderer.renderDiff(diff);
    const refresh = renderer.refreshHighlightedResult();
    renderer.setOptions({ ...options, preferredHighlighter: 'highlights' });
    const switched = renderer.renderDiff(diff);
    const switchedHTML = toHtml(switched?.additionsContentAST ?? []);
    expect(switchedHTML).toContain('after');
    expect(switchedHTML).not.toBe(toHtml(initial?.additionsContentAST ?? []));

    await refresh;
    const refreshed = renderer.renderDiff(diff);
    expect(toHtml(refreshed?.additionsContentAST ?? [])).toBe(switchedHTML);
  } finally {
    renderer.cleanUp();
  }
});

for (const kind of ['file', 'diff'] as const) {
  test(`${kind} discards background tokens from a previous backend`, async () => {
    const highlighter = await getSharedHighlighter({
      themes: ['pierre-dark'],
      langs: ['text'],
    });
    const file = { name: 'race.ts', contents: 'const after = "new";\n' };
    const diff = parseDiffFromFile(
      { ...file, contents: 'const before = "old";\n' },
      file
    );
    const options = {
      theme: 'pierre-dark',
      preferredHighlighter: 'shiki-js',
    } as const;
    const switched = createDeferred<void>();
    let html = '';
    const renderer =
      kind === 'file'
        ? new FileRenderer(options, undefined, update)
        : new DiffHunksRenderer(options, undefined, update);
    function update() {
      if (renderer instanceof FileRenderer) {
        const result = renderer.renderFile(file);
        if (result != null) html = toHtml(result.contentAST);
      } else {
        const result = renderer.renderDiff(diff);
        if (result != null)
          html = toHtml(
            result.additionsContentAST ?? result.unifiedContentAST ?? []
          );
      }
    }
    const original = highlighter.codeToTokens;
    let switchQueued = false;
    const tokenize = spyOn(highlighter, 'codeToTokens').mockImplementation(
      (code, tokenOptions) => {
        const result = original(code, tokenOptions);
        if (tokenOptions.lang !== 'typescript') return result;
        if (!switchQueued) {
          switchQueued = true;
          // Deliver the host's option update after tokenization but before its promise callback.
          queueMicrotask(() => {
            renderer.setOptions({
              ...options,
              preferredHighlighter: 'highlights',
            });
            update();
            switched.resolve();
          });
        }
        return {
          ...result,
          tokens: result.tokens.map((line) =>
            line.map((token) => ({ ...token, color: '#123abc' }))
          ),
        };
      }
    );
    try {
      update();
      await switched.promise;
      await renderer.initializeHighlighter();
      await Bun.sleep(0);
      expect(html).toContain('after');
      expect(html).not.toContain('#123abc');
    } finally {
      tokenize.mockRestore();
      renderer.cleanUp();
    }
  });
}
