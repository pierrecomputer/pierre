import { afterAll, describe, expect, spyOn, test } from 'bun:test';
import { createTwoFilesPatch } from 'diff';

import {
  disposeHighlighter,
  parseDiffFromFile,
  parsePatchFiles,
  SnippetFileDiff,
  type SnippetFold,
} from '../src';
import type { DiffLineAnnotation, FileDiffMetadata } from '../src/types';
import { installDom, wait, waitFor } from './domHarness';
import {
  boundaries,
  boundaryLabel,
  boundarySummaries,
  click,
  foldLabels,
  interiorLabels,
  makeDiff,
  makeMixedDiff,
  numberedLines,
  queryAll,
  renderedLines,
  sideLines,
  STYLES,
  withSnippetDiff,
} from './snippetHarness';

afterAll(async () => {
  await disposeHighlighter();
});

// The range used with makeMixedDiff: it cuts the 40-42 -> 40-41
// modification and holds the interior gaps new 45-56 and 64-71.
const MIXED_RANGE = { start: 41, end: 78 };

describe('SnippetFileDiff layout', () => {
  test('unified and split show the same lines between two boundary folds', async () => {
    const results: unknown[] = [];
    for (const diffStyle of STYLES) {
      await withSnippetDiff(
        { diffStyle, lineRange: MIXED_RANGE },
        ({ container }) => {
          const lines = sideLines(container);
          // The modification the range cuts is shown whole on both sides.
          expect(lines.add.slice(0, 2)).toEqual([40, 41]);
          expect(lines.del).toEqual([40, 41, 42, 75]);
          expect(lines.add.some((line) => line < 40 || line > 78)).toBe(false);
          // Interior gaps 45-56 and 64-71 fold like FileDiff (parser context
          // 3); the boundary folds hide a change each, so they say so.
          expect(foldLabels(container)).toEqual([
            '40 lines, includes changes',
            '12 unmodified lines',
            '8 unmodified lines',
            '42 lines, includes changes',
          ]);
          results.push({ lines, labels: foldLabels(container) });
        },
        makeMixedDiff()
      );
    }
    expect(results[0]).toEqual(results[1]);
  });

  test('boundary separators are the first and last row of every column and carry no hunk index', async () => {
    for (const diffStyle of STYLES) {
      await withSnippetDiff(
        { diffStyle, lineRange: MIXED_RANGE },
        ({ container }) => {
          const columns = queryAll(container, '[data-code]');
          expect(columns.length).toBe(diffStyle === 'unified' ? 1 : 2);
          for (const column of columns) {
            for (const part of ['[data-gutter]', '[data-content]']) {
              const rows = [...column.querySelector(part)!.children];
              expect(rows[0].getAttribute('data-snippet-boundary')).toBe(
                'above'
              );
              expect(rows.at(-1)!.getAttribute('data-snippet-boundary')).toBe(
                'below'
              );
            }
          }
          for (const separator of queryAll(
            container,
            '[data-snippet-boundary]'
          )) {
            expect(separator.hasAttribute('data-expand-index')).toBe(false);
            // Both folds hide a change (lines 10 and 99).
            expect(separator.hasAttribute('data-snippet-changes')).toBe(true);
          }
          // Interior separators keep their hunk index.
          for (const separator of queryAll(
            container,
            '[data-separator]:not([data-snippet-boundary])'
          )) {
            expect(separator.getAttribute('data-expand-index')).toMatch(
              /^\d+$/
            );
          }
        },
        makeMixedDiff()
      );
    }
  });

  test('a boundary fold within collapsedContextThreshold is shown, not folded', async () => {
    // 40 lines, range 2-39: one line hidden on each side, threshold 1.
    await withSnippetDiff(
      { lineRange: { start: 2, end: 39 } },
      ({ container }) => {
        expect(boundaries(container, 'above')).toHaveLength(0);
        expect(boundaries(container, 'below')).toHaveLength(0);
        expect(renderedLines(container, 'additions')).toContain(1);
        expect(renderedLines(container, 'additions')).toContain(40);
      },
      makeDiff([20])
    );
    await withSnippetDiff(
      { lineRange: { start: 3, end: 38 }, collapsedContextThreshold: 1 },
      ({ container }) => {
        expect(foldLabels(container)).toEqual([
          '2 unmodified lines',
          '2 unmodified lines',
        ]);
      },
      makeDiff([20])
    );
  });

  test('a collapsed snippet renders no rows', async () => {
    await withSnippetDiff({ collapsed: true }, ({ container }) => {
      expect(renderedLines(container)).toEqual([]);
      expect(queryAll(container, '[data-snippet-boundary]')).toHaveLength(0);
    });
  });
});

describe('SnippetFileDiff boundary folds', () => {
  test('a click calls onSnippetExpand with the fold, then opens one step', async () => {
    for (const diffStyle of STYLES) {
      const calls: [SnippetFold, number, boolean, boolean][] = [];
      await withSnippetDiff(
        {
          diffStyle,
          lineRange: MIXED_RANGE,
          expansionLineCount: 5,
          onSnippetExpand: (event) => {
            calls.push([
              event.fold,
              event.lineCount,
              event.event instanceof window.MouseEvent,
              event.defaultPrevented,
            ]);
          },
        },
        async ({ instance, container }) => {
          const expandHunk = spyOn(instance, 'expandHunk');
          click(boundaryLabel(container, 'above'));
          await waitFor(() => sideLines(container).add.includes(35));
          expect(calls).toEqual([
            [
              {
                boundary: 'above',
                hiddenLines: 40,
                hiddenAdditions: 1,
                hiddenDeletions: 1,
                containsChanges: true,
                lineRange: { start: 1, end: 39 },
              },
              5,
              true,
              false,
            ],
          ]);
          expect(sideLines(container).add.slice(0, 7)).toEqual([
            35, 36, 37, 38, 39, 40, 41,
          ]);
          expect(foldLabels(container)[0]).toBe('35 lines, includes changes');
          // A boundary click never reaches the hunk expansion path.
          expect(expandHunk).not.toHaveBeenCalled();
        },
        makeMixedDiff()
      );
    }
  });

  test('shift-click and "Expand all" open the whole fold', async () => {
    await withSnippetDiff(
      { lineRange: MIXED_RANGE, expansionLineCount: 5 },
      async ({ container }) => {
        click(boundaryLabel(container, 'above'), { shiftKey: true });
        await waitFor(() => sideLines(container).add.includes(1));
        expect(boundaries(container, 'above')).toHaveLength(0);
        const expandAll = queryAll(
          container,
          '[data-content] [data-snippet-boundary="below"] [data-expand-all-button]'
        )[0];
        expect(expandAll?.textContent).toBe('Expand all');
        click(expandAll);
        await waitFor(() => sideLines(container).add.includes(119));
        expect(boundaries(container, 'below')).toHaveLength(0);
      },
      makeMixedDiff()
    );
  });

  test('onSnippetExpand calling preventDefault keeps the fold closed; returning true does not', async () => {
    const seen: boolean[] = [];
    await withSnippetDiff(
      {
        onSnippetExpand: (event) => {
          event.preventDefault();
          seen.push(event.defaultPrevented);
        },
      },
      async ({ container }) => {
        const before = renderedLines(container);
        click(boundaryLabel(container, 'below'));
        await wait(20);
        expect(renderedLines(container)).toEqual(before);
        expect(seen).toEqual([true]);
      }
    );
    await withSnippetDiff(
      { onSnippetExpand: () => true },
      async ({ container }) => {
        const before = renderedLines(container);
        click(boundaryLabel(container, 'below'));
        await waitFor(() => renderedLines(container).length > before.length);
      }
    );
  });

  test('expandSnippet widens past a change; nothing re-folds; hunk expansion is untouched', async () => {
    for (const diffStyle of STYLES) {
      await withSnippetDiff(
        { diffStyle, lineRange: MIXED_RANGE },
        async ({ instance, container }) => {
          const interiorText = interiorLabels(container).map(
            (node) => node.textContent
          );
          expect(instance.expandSnippet('below', 30)).toBe(true);
          await waitFor(() => sideLines(container).add.includes(99));
          const lines = sideLines(container);
          // Past the line-99 modification: both its sides are shown.
          expect(lines.add).toContain(99);
          expect(lines.del).toContain(100);
          // Contiguous new lines 72-107: 30 source lines past 78, the
          // modification at 99 counting 2.
          expect(lines.add.filter((line) => line >= 72)).toEqual(
            numberedLines(36).map((_, i) => i + 72)
          );
          // Hunk expansion is untouched: the interior folds read the same.
          expect(
            interiorLabels(container).map((node) => node.textContent)
          ).toEqual(interiorText);
          expect(instance.expandSnippet('above', Infinity)).toBe(true);
          await waitFor(() => sideLines(container).add.includes(1));
          expect(boundaries(container, 'above')).toHaveLength(0);
          expect(instance.expandSnippet('above')).toBe(false);
        },
        makeMixedDiff()
      );
    }
  });

  test('expandSnippet rejects a bad count and works before the first render', () => {
    const { cleanup } = installDom();
    try {
      const instance = new SnippetFileDiff({ lineRange: { start: 5, end: 6 } });
      expect(instance.expandSnippet('above')).toBe(false);
      expect(() => instance.expandSnippet('above', 0)).toThrow(
        'SnippetFileDiff.expandSnippet: lineCount must be a whole number'
      );
      expect(() => instance.expandSnippet('below', 1.5)).toThrow(RangeError);
      instance.cleanUp();
    } finally {
      cleanup();
    }
  });
});

describe('SnippetFileDiff interior folds', () => {
  test('a click expands the hunk separator; boundaries and the callback stay put', async () => {
    for (const diffStyle of STYLES) {
      const calls: unknown[] = [];
      await withSnippetDiff(
        {
          diffStyle,
          lineRange: MIXED_RANGE,
          expansionLineCount: 5,
          onSnippetExpand: (fold) => void calls.push(fold),
        },
        async ({ instance, container }) => {
          const labels = foldLabels(container);
          const expandHunk = spyOn(instance, 'expandHunk');
          click(interiorLabels(container)[0]);
          await waitFor(() => sideLines(container).add.includes(45));
          expect(expandHunk).toHaveBeenCalledTimes(1);
          expect(calls).toEqual([]);
          const after = foldLabels(container);
          expect(after[0]).toBe(labels[0]);
          expect(after.at(-1)).toBe(labels.at(-1));
          // 5 lines from each edge of the 12-line gap: 2 left folded.
          expect(after[1]).toBe('2 unmodified lines');
          expect(sideLines(container).add.some((l) => l < 40 || l > 78)).toBe(
            false
          );
        },
        makeMixedDiff()
      );
    }
  });

  test('expandHunk keeps its FileDiff meaning and does not throw', async () => {
    await withSnippetDiff(
      { lineRange: MIXED_RANGE },
      async ({ instance, container }) => {
        // Gap 45-56 sits before hunk 2.
        instance.expandHunk(2, 'up', 3);
        await waitFor(() => sideLines(container).add.includes(47));
        expect(sideLines(container).add).toEqual(
          expect.arrayContaining([45, 46, 47])
        );
        expect(sideLines(container).add).not.toContain(48);
        // A gap outside the range is clipped, so expanding it changes
        // nothing that is drawn.
        const before = sideLines(container);
        instance.expandHunk(0, 'both', 50);
        await wait(20);
        expect(sideLines(container)).toEqual(before);
      },
      makeMixedDiff()
    );
  });

  test('every hunkSeparators mode draws boundaries that open', async () => {
    const modes = [
      'line-info',
      'line-info-basic',
      'metadata',
      'simple',
      () => {
        const element = document.createElement('div');
        element.textContent = 'custom';
        return element;
      },
    ] as const;
    for (const hunkSeparators of modes) {
      await withSnippetDiff(
        { lineRange: MIXED_RANGE, hunkSeparators },
        async ({ container }) => {
          const above = boundaries(container, 'above')[0];
          expect(above.getAttribute('data-separator')).toBe(
            hunkSeparators === 'line-info-basic'
              ? 'line-info-basic'
              : 'line-info'
          );
          click(boundaryLabel(container, 'above'));
          await waitFor(() => boundaries(container, 'above').length === 0);
          expect(sideLines(container).add[0]).toBe(1);
        },
        makeMixedDiff()
      );
    }
  });

  test('only gaps strictly between two changes in the range fold; requested lines elsewhere are shown', async () => {
    // 300 lines, changes at 5 and 200: an 186-line gap between their hunks.
    const diff = makeDiff([5, 200], 300);
    // Both changes in the range: the gap between them folds.
    await withSnippetDiff(
      { lineRange: { start: 8, end: 250 } },
      ({ container }) => {
        expect(foldLabels(container)).toContain('186 unmodified lines');
      },
      diff
    );
    // The range starts inside the gap: its lines are shown, nothing folds.
    await withSnippetDiff(
      { lineRange: { start: 50, end: 210 } },
      ({ container }) => {
        expect(interiorLabels(container)).toHaveLength(0);
        expect(renderedLines(container, 'additions')[0]).toBe(50);
      },
      diff
    );
  });

  test('expandUnchanged shows every line inside the range; boundaries remain', async () => {
    await withSnippetDiff(
      { lineRange: MIXED_RANGE, expandUnchanged: true },
      ({ container }) => {
        expect(interiorLabels(container)).toHaveLength(0);
        expect(sideLines(container).add).toEqual(
          numberedLines(39).map((_, i) => i + 40)
        );
        expect(boundaries(container, 'above').length).toBeGreaterThan(0);
        expect(boundaries(container, 'below').length).toBeGreaterThan(0);
      },
      makeMixedDiff()
    );
  });
});

describe('SnippetFileDiff line queries', () => {
  test('revealLine opens to the line plus one step, at a boundary or an interior fold, like FileDiff', async () => {
    await withSnippetDiff(
      { lineRange: MIXED_RANGE, expansionLineCount: 5 },
      async ({ instance, container }) => {
        expect(instance.revealLine(30)).toBe(true);
        await waitFor(() => sideLines(container).add.includes(30));
        expect(sideLines(container).add[0]).toBe(25);
        expect(instance.revealLine(30)).toBe(false);
        expect(instance.revealLine(1000)).toBe(false);
        // Line 50 sits in the interior gap 45-56: the base reveal opens to
        // it plus one step.
        expect(instance.revealLine(50)).toBe(true);
        await waitFor(() => sideLines(container).add.includes(50));
        expect(instance.isLineRenderable(50)).toBe(true);
      },
      makeMixedDiff()
    );
  });

  test('revealLine is false for a line a whole modification already shows', async () => {
    await withSnippetDiff(
      { lineRange: { start: 43, end: 78 } },
      ({ instance, container }) => {
        expect(instance.expandSnippet('above', 2)).toBe(true);
        // Two source lines land inside the 40-41 modification: shown whole.
        expect(sideLines(container).add[0]).toBe(40);
        expect(instance.isLineRenderable(40)).toBe(true);
        expect(instance.revealLine(40)).toBe(false);
        expect(sideLines(container).add[0]).toBe(40);
      },
      makeMixedDiff()
    );
  });

  test('isLineRenderable and getNearestRenderableLine answer inside the clip', async () => {
    await withSnippetDiff(
      { lineRange: MIXED_RANGE },
      ({ instance }) => {
        expect(instance.isLineRenderable(41)).toBe(true);
        expect(instance.isLineRenderable(20)).toBe(false);
        expect(instance.isLineRenderable(50)).toBe(false);
        expect(instance.getNearestRenderableLine(50, 'down')).toBe(57);
        expect(instance.getNearestRenderableLine(50, 'up')).toBe(44);
        expect(instance.getNearestRenderableLine(20, 'down')).toBe(40);
        expect(instance.getNearestRenderableLine(20, 'up')).toBeUndefined();
        expect(instance.getNearestRenderableLine(90, 'up')).toBe(78);
        expect(instance.getNearestRenderableLine(90, 'down')).toBeUndefined();
      },
      makeMixedDiff()
    );
  });
});

describe('SnippetFileDiff layout lifetime', () => {
  test('a new lineRange resets boundary reveals and every hunk expansion', async () => {
    await withSnippetDiff(
      { lineRange: MIXED_RANGE, expansionLineCount: 5 },
      async ({ instance, container }) => {
        click(interiorLabels(container)[0]);
        await waitFor(() => sideLines(container).add.includes(45));
        expect(instance.expandSnippet('above', 3)).toBe(true);
        // The same range (a new object) keeps both.
        instance.setOptions({
          ...instance.options,
          lineRange: { ...MIXED_RANGE },
        });
        instance.rerender();
        expect(sideLines(container).add).toContain(45);
        expect(sideLines(container).add[0]).toBe(37);
        // A new range: everything starts over.
        instance.setOptions({
          ...instance.options,
          lineRange: { start: 42, end: 78 },
        });
        instance.rerender();
        await waitFor(() => !sideLines(container).add.includes(45));
        expect(sideLines(container).add[0]).toBe(42);
        // The reader's interior expansion is gone: the gap folds whole again.
        expect(foldLabels(container)[1]).toBe('12 unmodified lines');
      },
      makeMixedDiff()
    );
  });

  test('an equal diff object keeps the layout; new contents reset it', async () => {
    await withSnippetDiff(
      { lineRange: { start: 25, end: 35 } },
      async ({ instance, container }) => {
        expect(instance.expandSnippet('below', 2)).toBe(true);
        expect(renderedLines(container).at(-1)).toBe(37);
        // A host re-parsing the same files on every render.
        instance.render({ fileDiff: makeDiff([5, 30]) });
        expect(renderedLines(container).at(-1)).toBe(37);
        instance.render({ fileDiff: makeDiff([5, 31]) });
        await waitFor(() => renderedLines(container).at(-1) === 35);
        expect(renderedLines(container).at(-1)).toBe(35);
      }
    );
  });
});

describe('SnippetFileDiff content kinds', () => {
  function fileDiffOf(
    oldLines: string[] | undefined,
    newLines: string[] | undefined,
    names: [string, string] = ['f.ts', 'f.ts']
  ): FileDiffMetadata {
    return parseDiffFromFile(
      {
        name: names[0],
        contents: oldLines != null ? oldLines.join('\n') + '\n' : '',
      },
      {
        name: names[1],
        contents: newLines != null ? newLines.join('\n') + '\n' : '',
      }
    );
  }

  test('a new file shows its range of added lines', async () => {
    const diff = fileDiffOf(undefined, numberedLines(30));
    expect(diff.type).toBe('new');
    await withSnippetDiff(
      { lineRange: { start: 10, end: 12 } },
      ({ instance, container }) => {
        expect(renderedLines(container)).toEqual([10, 11, 12]);
        // Every hidden line of a new file is an added line.
        expect(
          boundarySummaries(container).map(({ label, pills }) => [label, pills])
        ).toEqual([
          ['9 lines, includes changes', ['+9']],
          ['18 lines, includes changes', ['+18']],
        ]);
        expect(instance.expandSnippet('above', 2)).toBe(true);
        expect(renderedLines(container)).toEqual([8, 9, 10, 11, 12]);
      },
      diff
    );
  });

  test('a deleted file addresses old-file lines', async () => {
    const diff = fileDiffOf(numberedLines(30), undefined);
    expect(diff.type).toBe('deleted');
    for (const diffStyle of STYLES) {
      await withSnippetDiff(
        { diffStyle, lineRange: { start: 10, end: 12 } },
        ({ instance, container }) => {
          expect(renderedLines(container)).toEqual([10, 11, 12]);
          // Every hidden line of a deleted file is a removed line.
          expect(
            boundarySummaries(container).map(({ label, pills }) => [
              label,
              pills,
            ])
          ).toEqual([
            ['9 lines, includes changes', ['-9']],
            ['18 lines, includes changes', ['-18']],
          ]);
          expect(instance.isLineRenderable(11)).toBe(true);
          expect(instance.isLineRenderable(13)).toBe(false);
          // 14 plus the default 100-line step: the rest of the file.
          expect(instance.revealLine(14)).toBe(true);
          expect(renderedLines(container)).toEqual(
            numberedLines(21).map((_, i) => i + 10)
          );
        },
        diff
      );
    }
  });

  test('a renamed file with a change snippets the new side', async () => {
    const next = numberedLines(30);
    next[19] = 'line 20 CHANGED';
    const diff = fileDiffOf(numberedLines(30), next, ['old.ts', 'new.ts']);
    expect(diff.type).toBe('rename-changed');
    await withSnippetDiff(
      { lineRange: { start: 18, end: 22 } },
      ({ container }) => {
        expect(sideLines(container)).toEqual({
          add: [18, 19, 20, 21, 22],
          del: [20],
        });
      },
      diff
    );
  });
});

describe('SnippetFileDiff annotations and selection', () => {
  test('annotations render only inside the clip; file-level ones only with the top row', async () => {
    const lineAnnotations: DiffLineAnnotation<string>[] = [
      { side: 'additions', lineNumber: 0, metadata: 'file' },
      { side: 'additions', lineNumber: 20, metadata: 'outside' },
      { side: 'additions', lineNumber: 43, metadata: 'inside' },
    ];
    const slots = (container: HTMLElement) =>
      queryAll(container, '[data-line-annotation] slot')
        .map((slot) => slot.getAttribute('name') ?? '')
        .sort((a, b) => a.localeCompare(b));
    const { cleanup } = installDom();
    const instance = new SnippetFileDiff<string>({
      disableFileHeader: true,
      diffStyle: 'unified',
      lineRange: MIXED_RANGE,
    });
    try {
      const container = document.createElement('div');
      document.body.append(container);
      instance.render({
        fileContainer: container,
        fileDiff: makeMixedDiff(),
        lineAnnotations,
      });
      await waitFor(() => slots(container).length > 0);
      expect(slots(container)).toEqual(['annotation-additions-43']);
      expect(instance.expandSnippet('above', 25)).toBe(true);
      expect(slots(container)).toEqual([
        'annotation-additions-20',
        'annotation-additions-43',
      ]);
      expect(instance.expandSnippet('above', Infinity)).toBe(true);
      expect(slots(container)).toEqual([
        'annotation-additions-0',
        'annotation-additions-20',
        'annotation-additions-43',
      ]);
    } finally {
      instance.cleanUp();
      cleanup();
    }
  });

  test('a selection across an interior fold covers the lines it reveals', async () => {
    await withSnippetDiff(
      { lineRange: MIXED_RANGE, expansionLineCount: 5 },
      async ({ instance, container }) => {
        instance.setSelectedLines({ start: 43, end: 58 });
        const selected = () =>
          queryAll(container, '[data-content] [data-line][data-selected-line]')
            .map((node) => Number(node.getAttribute('data-line')))
            .sort((a, b) => a - b);
        await waitFor(() => selected().length > 0);
        expect(selected()).toEqual([43, 44, 57, 58]);
        click(interiorLabels(container)[0]);
        await waitFor(() => selected().includes(45));
        expect(selected()).toEqual([
          43, 44, 45, 46, 47, 48, 49, 52, 53, 54, 55, 56, 57, 58,
        ]);
      },
      makeMixedDiff()
    );
  });
});

describe('SnippetFileDiff input checks', () => {
  test('rejects bad options and partial diffs synchronously', () => {
    expect(
      () => new SnippetFileDiff({ lineRange: { start: 0, end: 3 } })
    ).toThrow('SnippetFileDiff: lineRange must be');
    expect(
      () => new SnippetFileDiff({ lineRange: { start: 4, end: 3 } })
    ).toThrow(RangeError);
    expect(
      () =>
        new SnippetFileDiff({
          lineRange: { start: 1, end: 3 },
          expansionLineCount: 0,
        })
    ).toThrow('expansionLineCount must be a whole number');
    const old = numberedLines(20).join('\n') + '\n';
    const partial = parsePatchFiles(
      createTwoFilesPatch('f.txt', 'f.txt', old, old.replace('line 9\n', 'x\n'))
    )[0].files[0];
    const { cleanup } = installDom();
    const instance = new SnippetFileDiff({ lineRange: { start: 1, end: 3 } });
    try {
      expect(() =>
        instance.render({
          fileContainer: document.createElement('div'),
          fileDiff: partial,
        })
      ).toThrow('a partial diff');
      expect(() =>
        instance.setOptions({ lineRange: { start: 2, end: 1 } })
      ).toThrow(RangeError);
    } finally {
      instance.cleanUp();
      cleanup();
    }
  });

  test('is read-only', async () => {
    await withSnippetDiff({}, async ({ instance }) => {
      const error = await instance
        .prepareForEditing()
        .catch((caught: unknown) => caught);
      expect(String(error)).toContain('read-only');
      expect(() => instance.__attachEditor(undefined as never)).toThrow(
        'read-only'
      );
      expect(instance.__canAttachEditor()).toBe(false);
    });
  });
});

describe('SnippetFileDiff on a large file', () => {
  test('a 20-line snippet of a 50,000-line diff renders and widens quickly', async () => {
    const old = numberedLines(50_000);
    const next = [...old];
    for (const line of [100, 10_000, 25_010, 40_000]) {
      next[line - 1] = `line ${line} CHANGED`;
    }
    const diff = parseDiffFromFile(
      { name: 'big.txt', contents: old.join('\n') + '\n', cacheKey: 'big:a' },
      { name: 'big.txt', contents: next.join('\n') + '\n', cacheKey: 'big:b' }
    );
    const started = performance.now();
    await withSnippetDiff(
      { lineRange: { start: 25_000, end: 25_020 }, expansionLineCount: 20 },
      ({ instance, container }) => {
        expect(renderedLines(container, 'additions')[0]).toBe(25_000);
        for (let i = 0; i < 10; i++) {
          expect(instance.expandSnippet(i % 2 === 0 ? 'above' : 'below')).toBe(
            true
          );
        }
        expect(renderedLines(container, 'additions')[0]).toBe(24_900);
        expect(renderedLines(container, 'additions').at(-1)).toBe(25_120);
      },
      diff
    );
    // Generous: catches a per-render whole-file walk regression on slow CI,
    // not small slowdowns.
    expect(performance.now() - started).toBeLessThan(15_000);
  });
});

// The maintainer-review probes: a boundary fold that hides changes says so,
// with "-D" / "+A" pills (removed first, like the file header), and its
// label, SnippetFold.hiddenLines, the "Expand all" (chunked) choice and the
// click step all count the same source lines.
describe('SnippetFileDiff boundary fold labels', () => {
  const SEPARATORS = ['line-info', 'line-info-basic'] as const;

  test('lines 1-10 modified, range 11-20: the fold above reads "20 lines, includes changes -10 +10"', async () => {
    const changed = numberedLines(10).map((_, i) => i + 1);
    for (const diffStyle of STYLES) {
      for (const hunkSeparators of SEPARATORS) {
        const folds: SnippetFold[] = [];
        await withSnippetDiff(
          {
            diffStyle,
            hunkSeparators,
            lineRange: { start: 11, end: 20 },
            onSnippetExpand: (event) => {
              folds.push(event.fold);
              event.preventDefault();
            },
          },
          ({ container }) => {
            expect(boundarySummaries(container)).toEqual([
              {
                boundary: 'above',
                label: '20 lines, includes changes',
                pills: ['-10', '+10'],
                kinds: ['deletions', 'additions'],
                name: '10 removed, 10 added',
              },
              {
                boundary: 'below',
                label: '20 unmodified lines',
                pills: [],
                kinds: [],
                name: null,
              },
            ]);
            // What a screen reader announces for the fold, in reading order:
            // the label text, then the pill group's accessible name.
            const content = queryAll(
              container,
              '[data-gutter] [data-snippet-boundary="above"] [data-separator-content]'
            )[0];
            expect(
              Array.from(content.children)
                .map(
                  (node) => node.getAttribute('aria-label') ?? node.textContent
                )
                .join(', ')
            ).toBe('20 lines, includes changes, 10 removed, 10 added');
            click(boundaryLabel(container, 'above'));
            click(boundaryLabel(container, 'below'));
            expect(folds).toEqual([
              {
                boundary: 'above',
                hiddenLines: 20,
                hiddenAdditions: 10,
                hiddenDeletions: 10,
                containsChanges: true,
                lineRange: { start: 1, end: 10 },
              },
              {
                boundary: 'below',
                hiddenLines: 20,
                hiddenAdditions: 0,
                hiddenDeletions: 0,
                containsChanges: false,
                lineRange: { start: 21, end: 40 },
              },
            ]);
          },
          makeDiff(changed)
        );
      }
    }
  });

  test('changes at 5 and 30, range 25-35: label, pills, hiddenLines, chunking and the step share one unit', async () => {
    for (const diffStyle of STYLES) {
      const folds: SnippetFold[] = [];
      await withSnippetDiff(
        {
          diffStyle,
          lineRange: { start: 25, end: 35 },
          expansionLineCount: 24,
          onSnippetExpand: (event) => folds.push(event.fold),
        },
        async ({ container }) => {
          // Lines 1-24 with the line-5 modification: 23 unchanged lines plus
          // one removed and one added line.
          expect(boundarySummaries(container)).toEqual([
            {
              boundary: 'above',
              label: '25 lines, includes changes',
              pills: ['-1', '+1'],
              kinds: ['deletions', 'additions'],
              name: '1 removed, 1 added',
            },
            {
              boundary: 'below',
              label: '5 unmodified lines',
              pills: [],
              kinds: [],
              name: null,
            },
          ]);
          const above = queryAll(
            container,
            '[data-content] [data-snippet-boundary="above"]'
          )[0];
          // 25 > 24: the fold is chunked, so it offers "Expand all", and the
          // pills sit beside the label in the same separator content.
          expect(above.querySelector('[data-expand-all-button]')).not.toBe(
            null
          );
          expect(
            above.querySelector(
              '[data-separator-content] > [data-snippet-change-counts]'
            )
          ).not.toBe(null);
          click(boundaryLabel(container, 'above'));
          await waitFor(() => foldLabels(container)[0] === '1 unmodified line');
          expect(folds[0]).toEqual({
            boundary: 'above',
            hiddenLines: 25,
            hiddenAdditions: 1,
            hiddenDeletions: 1,
            containsChanges: true,
            lineRange: { start: 1, end: 24 },
          });
          // The opened step showed the modification: no pills are left.
          expect(boundarySummaries(container)[0].pills).toEqual([]);
        },
        makeDiff([5, 30])
      );
    }
    await withSnippetDiff(
      { lineRange: { start: 25, end: 35 }, expansionLineCount: 25 },
      ({ container }) => {
        expect(
          queryAll(
            container,
            '[data-content] [data-snippet-boundary="above"] [data-expand-all-button]'
          )
        ).toHaveLength(0);
      },
      makeDiff([5, 30])
    );
  });

  test('a fold hiding only additions shows just "+A"; only deletions just "-D"', async () => {
    const old = numberedLines(30);
    const inserted = [...old];
    inserted.splice(5, 0, 'NEW a', 'NEW b', 'NEW c');
    const removed = [...old];
    removed.splice(5, 2);
    const cases = [
      {
        next: inserted,
        // New lines 1-19: 16 unchanged lines and the 3 inserted ones.
        summary: {
          label: '19 lines, includes changes',
          pills: ['+3'],
          kinds: ['additions'],
          name: '3 added',
        },
        fold: { hiddenLines: 19, hiddenAdditions: 3, hiddenDeletions: 0 },
      },
      {
        next: removed,
        // New lines 1-19 (old 1-5, 8-21) and the 2 removed old lines.
        summary: {
          label: '21 lines, includes changes',
          pills: ['-2'],
          kinds: ['deletions'],
          name: '2 removed',
        },
        fold: { hiddenLines: 21, hiddenAdditions: 0, hiddenDeletions: 2 },
      },
    ];
    for (const { next, summary, fold } of cases) {
      const diff = parseDiffFromFile(
        { name: 'f.txt', contents: old.join('\n') + '\n' },
        { name: 'f.txt', contents: next.join('\n') + '\n' }
      );
      for (const diffStyle of STYLES) {
        const folds: SnippetFold[] = [];
        await withSnippetDiff(
          {
            diffStyle,
            lineRange: { start: 20, end: 22 },
            onSnippetExpand: (event) => {
              folds.push(event.fold);
              event.preventDefault();
            },
          },
          ({ container }) => {
            expect(boundarySummaries(container)[0]).toEqual({
              boundary: 'above',
              ...summary,
            });
            click(boundaryLabel(container, 'above'));
            expect(folds[0]).toMatchObject({
              ...fold,
              containsChanges: true,
            });
          },
          diff
        );
      }
    }
  });

  test('a click on a pill opens the fold like a click on the label', async () => {
    for (const diffStyle of STYLES) {
      await withSnippetDiff(
        { diffStyle, lineRange: { start: 25, end: 35 }, expansionLineCount: 5 },
        async ({ container }) => {
          const pill = queryAll(
            container,
            '[data-gutter] [data-snippet-boundary="above"] [data-snippet-additions-count]'
          )[0];
          click(pill);
          await waitFor(() => sideLines(container).add.includes(20));
        },
        makeDiff([5, 30])
      );
    }
  });

  test('interior separators and folds without changes carry no pills', async () => {
    for (const diffStyle of STYLES) {
      await withSnippetDiff(
        { diffStyle, lineRange: MIXED_RANGE },
        ({ container }) => {
          expect(
            queryAll(
              container,
              '[data-separator]:not([data-snippet-boundary]) [data-snippet-change-counts]'
            )
          ).toHaveLength(0);
          expect(
            boundarySummaries(container).map(({ label, pills }) => [
              label,
              pills,
            ])
          ).toEqual([
            ['40 lines, includes changes', ['-1', '+1']],
            ['42 lines, includes changes', ['-1', '+1']],
          ]);
        },
        makeMixedDiff()
      );
    }
  });
});

describe('SnippetFileDiff identical files and clamped ranges', () => {
  const same = numberedLines(40);
  const file = { name: 'f.ts', contents: same.join('\n') + '\n' };

  test('a diff with no hunks shows its range as plain lines between folds', async () => {
    const diff = parseDiffFromFile(file, { ...file });
    expect(diff.hunks).toHaveLength(0);
    for (const diffStyle of STYLES) {
      await withSnippetDiff(
        { diffStyle, lineRange: { start: 11, end: 20 } },
        async ({ instance, container }) => {
          expect(renderedLines(container)).toEqual(
            numberedLines(10).map((_, i) => i + 11)
          );
          expect(foldLabels(container)).toEqual([
            '10 unmodified lines',
            '20 unmodified lines',
          ]);
          expect(instance.isLineRenderable(15)).toBe(true);
          expect(instance.expandSnippet('below', 5)).toBe(true);
          await waitFor(() => renderedLines(container).at(-1) === 25);
        },
        diff
      );
    }
  });

  test('an identical oldFile/newFile pair renders the same way', async () => {
    const { cleanup } = installDom();
    const instance = new SnippetFileDiff({
      disableFileHeader: true,
      lineRange: { start: 11, end: 20 },
    });
    try {
      const container = document.createElement('div');
      document.body.append(container);
      instance.render({
        fileContainer: container,
        oldFile: file,
        newFile: file,
      });
      await waitFor(() => renderedLines(container).length > 0);
      expect(renderedLines(container)[0]).toBe(11);
      expect(foldLabels(container)[0]).toBe('10 unmodified lines');
    } finally {
      instance.cleanUp();
      cleanup();
    }
  });

  test('a range past the end warns once and shows the last line', async () => {
    const warn = spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await withSnippetDiff(
        { lineRange: { start: 90, end: 100 } },
        ({ instance, container }) => {
          expect(renderedLines(container)).toEqual([40]);
          instance.rerender();
          const calls = warn.mock.calls.filter((call) =>
            String(call[0]).startsWith('SnippetFileDiff: lineRange 90-100')
          );
          expect(calls).toHaveLength(1);
          expect(String(calls[0][0])).toContain('past the last line (40)');
        }
      );
    } finally {
      warn.mockRestore();
    }
  });
});

describe('SnippetFileDiff getSnippetFolds', () => {
  // makeDiff([5, 30]), range 25-35: the fold above hides lines 1-24 with
  // the line-5 modification (25 source lines); the fold below hides 36-40.
  const ABOVE: SnippetFold = {
    boundary: 'above',
    hiddenLines: 25,
    hiddenAdditions: 1,
    hiddenDeletions: 1,
    containsChanges: true,
    lineRange: { start: 1, end: 24 },
  };
  const BELOW: SnippetFold = {
    boundary: 'below',
    hiddenLines: 5,
    hiddenAdditions: 0,
    hiddenDeletions: 0,
    containsChanges: false,
    lineRange: { start: 36, end: 40 },
  };

  test('is empty without content and answers right after render, before any click', () => {
    for (const diffStyle of STYLES) {
      const { cleanup } = installDom();
      const instance = new SnippetFileDiff({
        diffStyle,
        disableFileHeader: true,
        lineRange: { start: 25, end: 35 },
      });
      try {
        expect(instance.getSnippetFolds()).toEqual({});
        const container = document.createElement('div');
        document.body.append(container);
        instance.render({
          fileContainer: container,
          fileDiff: makeDiff([5, 30]),
        });
        // Synchronously after render(): no highlight wait, no click.
        expect(instance.getSnippetFolds()).toEqual({
          above: ABOVE,
          below: BELOW,
        });
      } finally {
        instance.cleanUp();
        cleanup();
      }
    }
  });

  test('matches the boundary labels and the onSnippetExpand fold in both styles', async () => {
    for (const diffStyle of STYLES) {
      const seen: SnippetFold[] = [];
      await withSnippetDiff(
        {
          diffStyle,
          lineRange: MIXED_RANGE,
          expansionLineCount: 5,
          onSnippetExpand: ({ fold }) => {
            seen.push(fold);
          },
        },
        async ({ instance, container }) => {
          const before = instance.getSnippetFolds();
          expect(foldLabels(container)[0]).toBe(
            `${before.above?.hiddenLines} lines, includes changes`
          );
          click(boundaryLabel(container, 'above'));
          await waitFor(() => sideLines(container).add.includes(35));
          expect(seen).toEqual([before.above!]);
          // After the click: one 5-line step fewer, the change still hidden.
          expect(instance.getSnippetFolds().above).toEqual({
            boundary: 'above',
            hiddenLines: 35,
            hiddenAdditions: 1,
            hiddenDeletions: 1,
            containsChanges: true,
            lineRange: { start: 1, end: 34 },
          });
          expect(instance.getSnippetFolds().below).toEqual(before.below);
        },
        makeMixedDiff()
      );
    }
  });

  test('reflects expandSnippet and omits a fully opened boundary', async () => {
    for (const diffStyle of STYLES) {
      await withSnippetDiff({ diffStyle }, async ({ instance, container }) => {
        expect(instance.getSnippetFolds()).toEqual({
          above: ABOVE,
          below: BELOW,
        });
        instance.expandSnippet('above', 10);
        // Read straight away: the folds follow the reveal, not the paint.
        expect(instance.getSnippetFolds().above).toEqual({
          ...ABOVE,
          hiddenLines: 15,
          lineRange: { start: 1, end: 14 },
        });
        instance.expandSnippet('below', Infinity);
        await waitFor(() => renderedLines(container).includes(40));
        const folds = instance.getSnippetFolds();
        expect(folds.below).toBeUndefined();
        expect('below' in folds).toBe(false);
        // Opening past the change: the fold above has no changes left.
        instance.expandSnippet('above', 20);
        expect(instance.getSnippetFolds()).toEqual({});
      });
    }
  });

  test('reflects a lineRange change and new contents', async () => {
    await withSnippetDiff({}, async ({ instance, container }) => {
      instance.expandSnippet('above', 10);
      instance.setOptions({
        ...instance.options,
        lineRange: { start: 3, end: 8 },
      });
      // A new range is a fresh layout: the reveal is gone.
      expect(instance.getSnippetFolds()).toEqual({
        above: {
          boundary: 'above',
          hiddenLines: 2,
          hiddenAdditions: 0,
          hiddenDeletions: 0,
          containsChanges: false,
          lineRange: { start: 1, end: 2 },
        },
        below: {
          boundary: 'below',
          hiddenLines: 33,
          hiddenAdditions: 1,
          hiddenDeletions: 1,
          containsChanges: true,
          lineRange: { start: 9, end: 40 },
        },
      });
      instance.render({ fileContainer: container, fileDiff: makeDiff([]) });
      await waitFor(
        () => foldLabels(container).at(-1) === '32 unmodified lines'
      );
      expect(instance.getSnippetFolds().below).toEqual({
        boundary: 'below',
        hiddenLines: 32,
        hiddenAdditions: 0,
        hiddenDeletions: 0,
        containsChanges: false,
        lineRange: { start: 9, end: 40 },
      });
    });
  });

  test('returns copies the caller cannot use to change the snippet', async () => {
    await withSnippetDiff({}, ({ instance, container }) => {
      const first = instance.getSnippetFolds();
      first.above!.hiddenLines = 0;
      first.above!.lineRange!.start = 99;
      delete first.below;
      expect(instance.getSnippetFolds()).toEqual({
        above: ABOVE,
        below: BELOW,
      });
      expect(instance.getSnippetFolds().above).not.toBe(
        instance.getSnippetFolds().above
      );
      expect(foldLabels(container)[0]).toBe('25 lines, includes changes');
    });
  });
});

describe('SnippetFileDiff getSnippetFolds edge cases', () => {
  // The snippet's private layout state, read to prove a teardown dropped it.
  const layoutState = (instance: SnippetFileDiff) => {
    const { snippet } = (
      instance as unknown as {
        snippetRenderer: {
          snippet: { layoutDiff: unknown; unitCache: { units: unknown[] } };
        };
      }
    ).snippetRenderer;
    return {
      layoutDiff: snippet.layoutDiff,
      units: snippet.unitCache.units.length,
    };
  };

  test('a read from the unmount onPostRender does not keep row data after cleanUp', async () => {
    const { cleanup } = installDom();
    const phases: string[] = [];
    const instance = new SnippetFileDiff({
      disableFileHeader: true,
      lineRange: { start: 25, end: 35 },
      onPostRender: (_node, snippet, phase) => {
        phases.push(phase);
        snippet.getSnippetFolds();
      },
    });
    try {
      const container = document.createElement('div');
      document.body.append(container);
      instance.render({
        fileContainer: container,
        fileDiff: makeDiff([5, 30]),
      });
      await waitFor(() => container.shadowRoot?.querySelector('code') != null);
      instance.cleanUp();
      expect(phases).toContain('unmount');
      expect(layoutState(instance)).toEqual({
        layoutDiff: undefined,
        units: 0,
      });
    } finally {
      cleanup();
    }
  });

  test('a collapsed snippet reports no folds, as it draws none', async () => {
    await withSnippetDiff({ collapsed: true }, ({ instance }) => {
      expect(instance.getSnippetFolds()).toEqual({});
      instance.setOptions({ ...instance.options, collapsed: false });
      expect(instance.getSnippetFolds().below?.hiddenLines).toBe(5);
    });
  });

  test('follows revealLine', async () => {
    await withSnippetDiff(
      { expansionLineCount: 2 },
      async ({ instance, container }) => {
        expect(instance.revealLine(20)).toBe(true);
        expect(instance.getSnippetFolds().above).toEqual({
          boundary: 'above',
          hiddenLines: 18,
          hiddenAdditions: 1,
          hiddenDeletions: 1,
          containsChanges: true,
          lineRange: { start: 1, end: 17 },
        });
        await waitFor(() => renderedLines(container).includes(18));
        expect(foldLabels(container)[0]).toBe('18 lines, includes changes');
      }
    );
  });
});
