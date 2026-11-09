import { afterAll, describe, expect, test } from 'bun:test';

import { disposeHighlighter, SnippetFile, type SnippetFold } from '../src';
import type { LineAnnotation } from '../src/types';
import { installDom, wait, waitFor } from './domHarness';
import {
  boundaries,
  boundaryLabel,
  click,
  FIFTY_LINES,
  foldLabels,
  numberedLines,
  queryAll,
  renderedLines,
  withSnippetFile,
} from './snippetHarness';

afterAll(async () => {
  await disposeHighlighter();
});

describe('SnippetFile', () => {
  test('shows the range between two boundary folds with no hunk index', async () => {
    await withSnippetFile({}, ({ container }) => {
      expect(renderedLines(container)).toEqual([20, 21, 22, 23, 24, 25]);
      expect(foldLabels(container)).toEqual([
        '19 unmodified lines',
        '25 unmodified lines',
      ]);
      for (const separator of queryAll(container, '[data-snippet-boundary]')) {
        expect(separator.getAttribute('data-separator')).toBe('line-info');
        expect(separator.hasAttribute('data-expand-index')).toBe(false);
        // A plain file has no changes: never pills or a changes marker.
        expect(
          separator.querySelector('[data-snippet-change-counts]')
        ).toBeNull();
        expect(separator.hasAttribute('data-snippet-changes')).toBe(false);
      }
    });
  });

  test('a click uses the FileDiff default step and calls onSnippetExpand', async () => {
    const calls: [SnippetFold, number, boolean][] = [];
    await withSnippetFile(
      {
        onSnippetExpand: ({ fold, lineCount, event }) => {
          calls.push([fold, lineCount, event instanceof window.MouseEvent]);
        },
      },
      async ({ container }) => {
        click(boundaryLabel(container, 'below'));
        await waitFor(() => renderedLines(container).at(-1) === 50);
        expect(calls).toEqual([
          [
            {
              boundary: 'below',
              hiddenLines: 25,
              hiddenAdditions: 0,
              hiddenDeletions: 0,
              containsChanges: false,
              lineRange: { start: 26, end: 50 },
            },
            100,
            true,
          ],
        ]);
        expect(boundaries(container, 'below')).toHaveLength(0);
      }
    );
  });

  test('onSnippetExpand calling preventDefault keeps the fold closed', async () => {
    await withSnippetFile(
      { onSnippetExpand: (event) => event.preventDefault() },
      async ({ container }) => {
        click(boundaryLabel(container, 'above'));
        await wait(20);
        expect(renderedLines(container)[0]).toBe(20);
      }
    );
  });

  test('expandSnippet and revealLine open in place', async () => {
    await withSnippetFile(
      { expansionLineCount: 3 },
      ({ instance, container }) => {
        expect(instance.expandSnippet('above')).toBe(true);
        expect(renderedLines(container)[0]).toBe(17);
        // revealLine opens to the line plus one step, as FileDiff does.
        expect(instance.revealLine(12)).toBe(true);
        expect(renderedLines(container)[0]).toBe(9);
        expect(instance.revealLine(12)).toBe(false);
        expect(instance.revealLine(99)).toBe(false);
        expect(instance.revealLine(30)).toBe(true);
        expect(renderedLines(container).at(-1)).toBe(33);
        expect(() => instance.expandSnippet('below', -1)).toThrow(
          'SnippetFile.expandSnippet: lineCount must be a whole number'
        );
      }
    );
  });

  test('a one-line fold is shown, as the base threshold does for gaps', async () => {
    await withSnippetFile(
      { lineRange: { start: 2, end: 49 } },
      ({ container }) => {
        expect(queryAll(container, '[data-snippet-boundary]')).toHaveLength(0);
        expect(renderedLines(container)).toEqual(
          numberedLines(50).map((_, i) => i + 1)
        );
      }
    );
  });

  test('new contents and a new range reset reveals; an equal file keeps them', async () => {
    await withSnippetFile({}, async ({ instance, container }) => {
      expect(instance.expandSnippet('below', 2)).toBe(true);
      expect(renderedLines(container).at(-1)).toBe(27);
      instance.render({ file: { ...FIFTY_LINES } });
      expect(renderedLines(container).at(-1)).toBe(27);
      instance.render({
        file: { name: 'f.txt', contents: numberedLines(60).join('\n') },
      });
      await waitFor(() => renderedLines(container).at(-1) === 25);
      expect(renderedLines(container).at(-1)).toBe(25);
      instance.setOptions({
        ...instance.options,
        lineRange: { start: 5, end: 6 },
      });
      instance.rerender();
      expect(renderedLines(container)).toEqual([5, 6]);
    });
  });

  test('an equal file object (forced render) keeps reveals and the next click still opens', async () => {
    await withSnippetFile(
      { expansionLineCount: 3 },
      async ({ instance, container }) => {
        click(boundaryLabel(container, 'above'));
        await waitFor(() => renderedLines(container)[0] === 17);
        instance.render({ file: { ...FIFTY_LINES }, forceRender: true });
        expect(renderedLines(container)[0]).toBe(17);
        click(boundaryLabel(container, 'above'));
        await waitFor(() => renderedLines(container)[0] === 14);
        expect(renderedLines(container)[0]).toBe(14);
      }
    );
  });

  test('revealLine is false for a line the threshold already shows', async () => {
    await withSnippetFile(
      { lineRange: { start: 2, end: 25 } },
      ({ instance, container }) => {
        expect(renderedLines(container)[0]).toBe(1);
        expect(instance.revealLine(1)).toBe(false);
      }
    );
  });

  test('file-level annotations render only while the first line is shown', async () => {
    const lineAnnotations: LineAnnotation<string>[] = [
      { lineNumber: 0, metadata: 'file' },
      { lineNumber: 22, metadata: 'inside' },
    ];
    const slots = (container: HTMLElement) =>
      queryAll(container, '[data-line-annotation] slot')
        .map((slot) => slot.getAttribute('name') ?? '')
        .sort((a, b) => a.localeCompare(b));
    const { cleanup } = installDom();
    const instance = new SnippetFile<string>({
      disableFileHeader: true,
      lineRange: { start: 20, end: 25 },
    });
    try {
      const container = document.createElement('div');
      document.body.append(container);
      instance.render({
        fileContainer: container,
        file: FIFTY_LINES,
        lineAnnotations,
      });
      await waitFor(() => slots(container).length > 0);
      expect(slots(container)).toEqual(['annotation-22']);
      expect(instance.expandSnippet('above', Infinity)).toBe(true);
      expect(slots(container)).toEqual(['annotation-0', 'annotation-22']);
    } finally {
      instance.cleanUp();
      cleanup();
    }
  });

  test('is read-only and validates its options', async () => {
    expect(() => new SnippetFile({ lineRange: { start: 3, end: 2 } })).toThrow(
      'SnippetFile: lineRange must be'
    );
    expect(
      () =>
        new SnippetFile({
          lineRange: { start: 1, end: 2 },
          expansionLineCount: Number.NaN,
        })
    ).toThrow(RangeError);
    await withSnippetFile({}, ({ instance }) => {
      expect(() => instance.__attachEditor(undefined as never)).toThrow(
        'read-only'
      );
    });
  });
});

describe('SnippetFile getSnippetFolds', () => {
  test('reports unchanged folds before a click, after expandSnippet, a click and a new range', async () => {
    const { cleanup } = installDom();
    const bare = new SnippetFile({ lineRange: { start: 20, end: 25 } });
    expect(bare.getSnippetFolds()).toEqual({});
    bare.cleanUp();
    cleanup();
    await withSnippetFile(
      { expansionLineCount: 4 },
      async ({ instance, container }) => {
        const unchanged = {
          hiddenAdditions: 0,
          hiddenDeletions: 0,
          containsChanges: false,
        };
        expect(instance.getSnippetFolds()).toEqual({
          above: {
            boundary: 'above',
            hiddenLines: 19,
            ...unchanged,
            lineRange: { start: 1, end: 19 },
          },
          below: {
            boundary: 'below',
            hiddenLines: 25,
            ...unchanged,
            lineRange: { start: 26, end: 50 },
          },
        });
        instance.expandSnippet('above', 9);
        expect(instance.getSnippetFolds().above).toEqual({
          boundary: 'above',
          hiddenLines: 10,
          ...unchanged,
          lineRange: { start: 1, end: 10 },
        });
        click(boundaryLabel(container, 'below'));
        await waitFor(() => renderedLines(container).includes(29));
        expect(instance.getSnippetFolds().below).toEqual({
          boundary: 'below',
          hiddenLines: 21,
          ...unchanged,
          lineRange: { start: 30, end: 50 },
        });
        instance.setOptions({
          ...instance.options,
          lineRange: { start: 1, end: 48 },
        });
        expect(instance.getSnippetFolds()).toEqual({
          below: {
            boundary: 'below',
            hiddenLines: 2,
            ...unchanged,
            lineRange: { start: 49, end: 50 },
          },
        });
        const copy = instance.getSnippetFolds();
        copy.below!.lineRange!.end = 1;
        expect(instance.getSnippetFolds().below?.lineRange).toEqual({
          start: 49,
          end: 50,
        });
      }
    );
  });
});

describe('SnippetFile getSnippetFolds edge cases', () => {
  test('a read from the unmount onPostRender does not keep row data after cleanUp; collapsed reports none', async () => {
    const { cleanup } = installDom();
    const instance = new SnippetFile({
      lineRange: { start: 20, end: 25 },
      onPostRender: (_node, snippet) => {
        snippet.getSnippetFolds();
      },
    });
    try {
      const container = document.createElement('div');
      document.body.append(container);
      instance.render({ fileContainer: container, file: FIFTY_LINES });
      await waitFor(() => container.shadowRoot?.querySelector('code') != null);
      instance.cleanUp();
      const { snippet } = (
        instance as unknown as {
          snippetRenderer: {
            snippet: { layoutFile: unknown; unitCache: { units: unknown[] } };
          };
        }
      ).snippetRenderer;
      expect(snippet.layoutFile).toBeUndefined();
      expect(snippet.unitCache.units).toHaveLength(0);
    } finally {
      cleanup();
    }
    await withSnippetFile({ collapsed: true }, ({ instance: collapsed }) => {
      expect(collapsed.getSnippetFolds()).toEqual({});
    });
  });
});
