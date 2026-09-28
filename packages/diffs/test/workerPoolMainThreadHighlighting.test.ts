import { afterAll, beforeAll, describe, expect, spyOn, test } from 'bun:test';
import type { Nodes } from 'hast';

import { disposeHighlighter } from '../src/highlighter/shared_highlighter';
import { DiffHunksRenderer } from '../src/renderers/DiffHunksRenderer';
import { FileRenderer } from '../src/renderers/FileRenderer';
import type { FileContents } from '../src/types';
import { parseDiffFromFile } from '../src/utils/parseDiffFromFile';
import { wait } from './domHarness';
import {
  createInitializedManager,
  installAnimationFramePolyfill,
} from './workerPoolHarness';

// A Highlights pool leaves highlighting to the renderers: the worker round
// trip costs as much as highlighting itself and would paint plain text first.

let restoreAnimationFrame: (() => void) | undefined;

beforeAll(() => {
  restoreAnimationFrame = installAnimationFramePolyfill();
});

afterAll(async () => {
  restoreAnimationFrame?.();
  await disposeHighlighter();
});

const oldFile: FileContents = {
  name: 'pool.ts',
  contents: 'const answer = 42;\nexport default function read() {}\n',
  cacheKey: 'pool:old',
};
const newFile: FileContents = {
  name: 'pool.ts',
  contents: 'const answer = 43;\nexport default function read() {}\n',
  cacheKey: 'pool:new',
};

// Plain text renders every row with one token style; highlighting uses
// several. Only spans inside `data-line` rows count.
function countTokenStyles(node: Nodes): number {
  const styles = new Set<unknown>();
  const visit = (current: Nodes, insideLine: boolean): void => {
    if (current.type !== 'element' && current.type !== 'root') return;
    if (current.type === 'element') {
      if (insideLine && current.tagName === 'span')
        styles.add(current.properties.style);
      insideLine ||= current.properties['data-line'] != null;
    }
    for (const child of current.children) visit(child, insideLine);
  };
  visit(node, false);
  return styles.size;
}

describe('worker pools that highlight on the main thread', () => {
  test('a Highlights pool renders highlighted files and diffs without worker requests', async () => {
    const { manager, worker } = await createInitializedManager({
      preferredHighlighter: 'highlights',
      theme: 'pierre-dark',
    });
    const fileRenderer = new FileRenderer(
      { theme: 'pierre-dark' },
      undefined,
      undefined,
      manager
    );
    const diffRenderer = new DiffHunksRenderer(
      { theme: 'pierre-dark' },
      undefined,
      undefined,
      manager
    );
    try {
      expect(manager.highlightsOnMainThread).toBe(true);

      const fileResult = fileRenderer.renderFile(oldFile);
      if (fileResult == null) throw new Error('expected a file render');
      expect(
        countTokenStyles(fileRenderer.renderFullAST(fileResult))
      ).toBeGreaterThan(2);

      const diffResult = diffRenderer.renderDiff(
        parseDiffFromFile(oldFile, newFile)
      );
      if (diffResult == null) throw new Error('expected a diff render');
      expect(
        countTokenStyles(diffRenderer.renderFullAST(diffResult))
      ).toBeGreaterThan(2);

      // Queued worker tasks drain on a microtask; give them a chance to run.
      await wait(10);
      expect(worker.fileRequestCount).toBe(0);
      expect(worker.diffRequestCount).toBe(0);
    } finally {
      fileRenderer.cleanUp();
      diffRenderer.cleanUp();
      manager.terminate();
    }
  });

  test('a Shiki pool still highlights in its workers', async () => {
    const { manager, worker } = await createInitializedManager({
      preferredHighlighter: 'shiki-js',
      theme: 'pierre-dark',
    });
    const fileRenderer = new FileRenderer(
      { theme: 'pierre-dark' },
      undefined,
      undefined,
      manager
    );
    try {
      expect(manager.highlightsOnMainThread).toBe(false);
      fileRenderer.renderFile(oldFile);
      await wait(10);
      expect(worker.fileRequestCount).toBe(1);
    } finally {
      fileRenderer.cleanUp();
      manager.terminate();
    }
  });

  for (const [name, tokenizeMaxLength] of [
    ['large.txt', 100_000],
    ['large.ts', 1000],
  ] as const) {
    test(`a Highlights pool only renders visible plain-text file lines (${name})`, async () => {
      const { manager, worker } = await createInitializedManager({
        preferredHighlighter: 'highlights',
        theme: 'pierre-dark',
      });
      const renderer = new FileRenderer(
        { theme: 'pierre-dark', tokenizeMaxLength },
        undefined,
        undefined,
        manager
      );
      const highlighter = await renderer.initializeHighlighter();
      const tokenize = spyOn(highlighter, 'codeToTokens');
      const lines = Array.from(
        { length: 1500 },
        (_, i) => `const line_${i} = "old";\n`
      );
      const file = { name, contents: lines.join(''), cacheKey: name };
      try {
        for (const startingLine of [0, 50, 100]) {
          tokenize.mockClear();
          const range = {
            startingLine,
            totalLines: 50,
            bufferBefore: 0,
            bufferAfter: 0,
          };
          expect(renderer.renderFile(file, range)).toBeDefined();
          expect(tokenize).toHaveBeenCalledTimes(1);
          expect(tokenize.mock.calls[0][0]).toBe(
            lines.slice(startingLine, startingLine + 50).join('')
          );
          expect(renderer.renderFile(file, range)).toBeDefined();
          expect(tokenize).toHaveBeenCalledTimes(1);
        }
        await wait(10);
        expect(worker.fileRequestCount).toBe(0);
      } finally {
        tokenize.mockRestore();
        renderer.cleanUp();
        manager.terminate();
      }
    });

    test(`a Highlights pool preserves inline differences in plain-text viewports (${name})`, async () => {
      const { manager, worker } = await createInitializedManager({
        preferredHighlighter: 'highlights',
        theme: 'pierre-dark',
        lineDiffType: 'word-alt',
      });
      const renderer = new DiffHunksRenderer(
        { theme: 'pierre-dark', tokenizeMaxLength },
        undefined,
        undefined,
        manager
      );
      const highlighter = await renderer.initializeHighlighter();
      const tokenize = spyOn(highlighter, 'codeToTokens');
      const contents = Array.from(
        { length: 1500 },
        (_, i) => `const line_${i} = "old";\n`
      ).join('');
      const diff = parseDiffFromFile(
        { name, contents, cacheKey: `${name}:old` },
        {
          name,
          contents: contents.replaceAll('"old"', '"new"'),
          cacheKey: `${name}:new`,
        }
      );
      try {
        for (const startingLine of [0, 50, 100]) {
          tokenize.mockClear();
          const range = {
            startingLine,
            totalLines: 50,
            bufferBefore: 0,
            bufferAfter: 0,
          };
          const result = renderer.renderDiff(diff, range);
          if (result == null) throw new Error('expected a diff render');
          expect(tokenize).toHaveBeenCalledTimes(2);
          for (const [code] of tokenize.mock.calls) {
            expect(code.split('\n')).toHaveLength(50);
          }
          expect(
            renderer.renderFullHTML(result).match(/data-diff-span/g)
          ).toHaveLength(100);
          expect(renderer.renderDiff(diff, range)).toBeDefined();
          expect(tokenize).toHaveBeenCalledTimes(2);
        }
        await wait(10);
        expect(worker.diffRequestCount).toBe(0);
      } finally {
        tokenize.mockRestore();
        renderer.cleanUp();
        manager.terminate();
      }
    });
  }
});
