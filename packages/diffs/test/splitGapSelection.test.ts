import { afterAll, describe, expect, spyOn, test } from 'bun:test';

import { FileDiff } from '../src/components/FileDiff';
import { DEFAULT_THEMES } from '../src/constants';
import { disposeHighlighter } from '../src/highlighter/shared_highlighter';
import type { SelectedLineRange } from '../src/types';
import { parseDiffFromFile } from '../src/utils/parseDiffFromFile';
import { installDom, wait, waitFor } from './domHarness';

afterAll(async () => {
  await disposeHighlighter();
});

describe('line selection over a split gap', () => {
  test('a gap is selected when the selection covers all of its rows', async () => {
    const dom = installDom();
    const consoleError = spyOn(console, 'error');
    const container = document.createElement('div');
    document.body.appendChild(container);
    const instance = new FileDiff<undefined>({
      disableFileHeader: true,
      theme: DEFAULT_THEMES,
      diffStyle: 'split',
    });
    // New lines 3 and 4 are added, so the old column shows a two-row gap
    // between old lines 2 and 3.
    const fileDiff = parseDiffFromFile(
      { name: 'gap.txt', contents: 'a\nb\nc\n' },
      { name: 'gap.txt', contents: 'a\nb\nx\ny\nc\n' }
    );
    const oldColumn = () =>
      container.shadowRoot?.querySelector('[data-deletions]') ?? undefined;
    // The old column's selected-line value on its gap's content and gutter
    // cells, or undefined when the gap is not selected.
    const gapSelection = () => {
      const column = oldColumn();
      return [
        column
          ?.querySelector('[data-content] > [data-content-buffer]')
          ?.getAttribute('data-selected-line') ?? undefined,
        column
          ?.querySelector("[data-gutter] > [data-gutter-buffer='buffer']")
          ?.getAttribute('data-selected-line') ?? undefined,
      ];
    };
    const select = async (range: SelectedLineRange) => {
      instance.setSelectedLines(range);
      await waitFor(
        () =>
          (oldColumn()?.querySelectorAll(
            '[data-content] > [data-selected-line]'
          ).length ?? 0) > 0
      );
    };
    try {
      instance.render({
        fileDiff,
        fileContainer: container,
        forceRender: true,
      });
      await waitFor(
        () =>
          oldColumn()?.querySelector(
            '[data-content] > [data-content-buffer]'
          ) != null
      );

      // From old 2 to old 3: the selection runs through the gap.
      await select({
        start: 2,
        side: 'deletions',
        end: 3,
        endSide: 'deletions',
      });
      expect(gapSelection()).toEqual(['', '']);

      // From old 2 to new 4: the selection ends on the gap's last row.
      await select({
        start: 2,
        side: 'deletions',
        end: 4,
        endSide: 'additions',
      });
      expect(gapSelection()).toEqual(['last', 'last']);

      // From old 2 to new 3: the selection covers only part of the gap.
      await select({
        start: 2,
        side: 'deletions',
        end: 3,
        endSide: 'additions',
      });
      expect(gapSelection()).toEqual([undefined, undefined]);
      expect(consoleError).not.toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
      await wait(10);
      instance.cleanUp();
      dom.cleanup();
    }
  });
});
