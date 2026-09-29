import { afterAll, beforeAll, describe, expect, spyOn, test } from 'bun:test';
import { toHtml } from 'hast-util-to-html';

import {
  disposeHighlighter,
  getSharedHighlighter,
} from '../src/highlighter/shared_highlighter';
import { DiffHunksRenderer } from '../src/renderers/DiffHunksRenderer';
import type { DiffsHighlighter, FileDiffMetadata } from '../src/types';
import { parseDiffFromFile } from '../src/utils/parseDiffFromFile';
import { renderDiffWithHighlighter } from '../src/utils/renderDiffWithHighlighter';

let highlighter: DiffsHighlighter;

beforeAll(async () => {
  highlighter = await getSharedHighlighter({
    themes: ['pierre-dark', 'pierre-light'],
    langs: ['typescript'],
    preferredHighlighter: 'shiki-js',
  });
});

afterAll(async () => {
  await disposeHighlighter();
});

function createDiff(): FileDiffMetadata {
  return parseDiffFromFile(
    { name: 'example.ts', contents: 'const before = 1;\n' },
    { name: 'example.ts', contents: 'const after = 2;\n' }
  );
}

function renderHtml(
  renderer: DiffHunksRenderer,
  diff: FileDiffMetadata
): string {
  const result = renderer.renderDiff(diff);
  expect(result).toBeDefined();
  return toHtml([
    ...(result?.unifiedContentAST ?? []),
    ...(result?.deletionsContentAST ?? []),
    ...(result?.additionsContentAST ?? []),
  ]);
}

// Start each case with a genuine highlighted edit session suspended without
// DOM. Only the resume is observed, so any Shiki call indicates a cache miss.
function withRecycledRenderer(
  run: (
    renderer: DiffHunksRenderer,
    diff: FileDiffMetadata,
    calls: () => number
  ) => void
): void {
  const renderer = new DiffHunksRenderer({ theme: 'pierre-dark' });
  const diff = createDiff();
  const highlight = spyOn(highlighter, 'codeToHast');
  try {
    renderer.beginEditSession(diff);
    expect(renderHtml(renderer, diff)).toContain('data-char');
    renderer.recycle();
    highlight.mockClear();
    run(renderer, diff, () => highlight.mock.calls.length);
  } finally {
    renderer.cleanUp();
    highlight.mockRestore();
  }
}

describe('recycled diff edit highlights', () => {
  test('keeps session markup across repeated suspension and remount', () => {
    withRecycledRenderer((renderer, diff, calls) => {
      renderer.recycle();
      expect(renderHtml(renderer, diff)).toContain('data-char');
      renderer.beginEditSession(diff);
      expect(renderer.editorRenderReady()).toBe(true);
      expect(calls()).toBe(0);
    });
  });

  for (const change of ['theme', 'line-diff settings'] as const) {
    test(`invalidates suspended highlights after a ${change} change`, () => {
      withRecycledRenderer((renderer, diff, calls) => {
        renderer.setOptions(
          change === 'theme'
            ? { theme: 'pierre-light' }
            : { theme: 'pierre-dark', lineDiffType: 'none' }
        );
        expect(renderHtml(renderer, diff)).toContain('after');
        expect(calls()).toBe(2);
      });
    });
  }

  for (const release of ['endEditSession', 'clearRenderCache'] as const) {
    test(`${release} releases the suspended result`, () => {
      withRecycledRenderer((renderer, diff, calls) => {
        renderer[release]();
        renderer.beginEditSession(diff);
        expect(renderHtml(renderer, diff)).toContain('after');
        expect(calls()).toBe(2);
      });
    });
  }

  test('keeps shared highlights unchanged when a resumed session is edited', () => {
    const renderer = new DiffHunksRenderer({
      theme: 'pierre-dark',
      useTokenTransformer: true,
    });
    const highlight = spyOn(highlighter, 'codeToHast');
    try {
      const external = createDiff();
      const options = {
        theme: 'pierre-dark' as const,
        useTokenTransformer: true,
        tokenizeMaxLineLength: 1000,
        lineDiffType: 'word-alt' as const,
        maxLineDiffLength: 1000,
      };
      const sharedResult = renderDiffWithHighlighter(
        external,
        highlighter,
        options
      );
      const originalResult = structuredClone(sharedResult);
      highlight.mockClear();
      renderer.hydrate(external);
      renderer.onHighlightSuccess(external, sharedResult, options);
      renderHtml(renderer, external);
      const session = {
        ...external,
        additionLines: [...external.additionLines],
      };
      renderer.beginEditSession(session, external);
      renderer.recycle();
      renderHtml(renderer, session);
      expect(highlight).not.toHaveBeenCalled();
      renderer.updateRenderCache(
        new Map([[0, [[0, '#fff', 'const edited = 3;']]]]),
        'dark'
      );
      expect(renderHtml(renderer, session)).toContain('edited');
      expect(sharedResult).toEqual(originalResult);
    } finally {
      renderer.cleanUp();
      highlight.mockRestore();
    }
  });

  test('keeps results for every active session, including more than 100', () => {
    const renderers: DiffHunksRenderer[] = [];
    const diffs: FileDiffMetadata[] = [];
    const highlight = spyOn(highlighter, 'codeToHast');
    try {
      for (let index = 0; index < 101; index++) {
        const renderer = new DiffHunksRenderer({ theme: 'pierre-dark' });
        renderers.push(renderer);
        const diff = createDiff();
        diffs.push(diff);
        renderer.beginEditSession(diff);
        renderer.renderDiff(diff);
        renderer.recycle();
      }
      highlight.mockClear();
      expect(renderHtml(renderers[100], diffs[100])).toContain('after');
      expect(highlight).not.toHaveBeenCalled();
      expect(renderHtml(renderers[0], diffs[0])).toContain('after');
      expect(highlight).not.toHaveBeenCalled();
    } finally {
      for (const renderer of renderers) renderer.cleanUp();
      highlight.mockRestore();
    }
  });
});
