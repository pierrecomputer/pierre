import { afterAll, describe, expect, spyOn, test } from 'bun:test';

import { FileDiff } from '../src/components/FileDiff';
import { DEFAULT_THEMES } from '../src/constants';
import { disposeHighlighter } from '../src/highlighter/shared_highlighter';
import { parseDiffFromFile } from '../src/utils/parseDiffFromFile';
import { installDom, wait, waitFor } from './domHarness';
import { inlinedFunctionDiff } from './mocks';

afterAll(async () => {
  await disposeHighlighter();
});

// The gutter line numbers in one split column that carry the selected-lines
// attribute.
function selectedGutterNumbers(
  container: HTMLElement,
  side: 'additions' | 'deletions'
): number[] {
  const code = container.shadowRoot?.querySelector(`[data-code][data-${side}]`);
  return [
    ...(code?.querySelectorAll('[data-column-number][data-selected-line]') ??
      []),
  ]
    .map((element) => Number(element.getAttribute('data-column-number')))
    .sort((a, b) => a - b);
}

const ROW_HEIGHT = 20;

// jsdom does no layout. Give the connector column a size and stack each row by
// its split line index, so the connector layer draws and its selection band
// can be compared with the selected rows. Returns a function that restores
// jsdom's zero rects.
function installRowGeometry(): () => void {
  const prototype = window.HTMLElement.prototype;
  Object.defineProperty(prototype, 'getBoundingClientRect', {
    configurable: true,
    value(this: HTMLElement): DOMRect {
      if (this.hasAttribute('data-semantic-connectors')) {
        return new window.DOMRect(0, 0, 40, 1000);
      }
      const splitIndex = Number(
        this.getAttribute('data-line-index')?.split(',')[1] ?? Number.NaN
      );
      return Number.isNaN(splitIndex)
        ? new window.DOMRect()
        : new window.DOMRect(0, splitIndex * ROW_HEIGHT, 400, ROW_HEIGHT);
    },
  });
  return () => {
    Reflect.deleteProperty(prototype, 'getBoundingClientRect');
  };
}

// The connector column's selection band as [y, height], or 'hidden'.
function selectionBand(container: HTMLElement): unknown {
  const rect = container.shadowRoot?.querySelector(
    '[data-connector-selection]'
  );
  if (rect == null) return undefined;
  return rect.getAttribute('display') === 'none'
    ? 'hidden'
    : [Number(rect.getAttribute('y')), Number(rect.getAttribute('height'))];
}

// The split line indexes of one column's selected content rows.
function selectedSplitIndexes(
  container: HTMLElement,
  side: 'additions' | 'deletions'
): number[] {
  const code = container.shadowRoot?.querySelector(`[data-code][data-${side}]`);
  return [
    ...(code?.querySelectorAll('[data-content] > [data-selected-line]') ?? []),
  ].map((row) =>
    Number(row.getAttribute('data-line-index')?.split(',')[1] ?? Number.NaN)
  );
}

function renderInlinedFunctionSplit(
  container: HTMLElement
): FileDiff<undefined> {
  const { oldContents, newContents, operation } = inlinedFunctionDiff;
  const fileDiff = parseDiffFromFile(
    { name: 'ops.go', contents: oldContents },
    { name: 'ops.go', contents: newContents }
  );
  fileDiff.semanticOperations = [operation];
  const instance = new FileDiff<undefined>({
    disableFileHeader: true,
    theme: DEFAULT_THEMES,
    diffStyle: 'split',
  });
  instance.render({ fileDiff, fileContainer: container, forceRender: true });
  return instance;
}

describe('line selection in a semantic diff', () => {
  test('split view selects rows next to the connector column', async () => {
    const dom = installDom();
    // Errors thrown while rendering the selection are reported through
    // console.error by the render queue rather than thrown to the caller.
    const consoleError = spyOn(console, 'error');
    const container = document.createElement('div');
    document.body.appendChild(container);
    const instance = renderInlinedFunctionSplit(container);
    try {
      await waitFor(
        () =>
          container.shadowRoot?.querySelector('[data-semantic-connectors]') !=
          null
      );

      instance.setSelectedLines({ start: 13, end: 14, side: 'additions' });
      await waitFor(
        () => selectedGutterNumbers(container, 'additions').length > 0
      );

      expect(selectedGutterNumbers(container, 'additions')).toEqual([13, 14]);
      expect(consoleError).not.toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
      await wait(10);
      instance.cleanUp();
      dom.cleanup();
    }
  });

  test('the connector column draws a band across the selected rows', async () => {
    const dom = installDom();
    const restoreGeometry = installRowGeometry();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const instance = renderInlinedFunctionSplit(container);
    try {
      await waitFor(() => selectionBand(container) === 'hidden');

      instance.setSelectedLines({ start: 13, end: 14, side: 'additions' });
      await waitFor(() => Array.isArray(selectionBand(container)));
      const rows = selectedSplitIndexes(container, 'additions');
      expect(rows.length).toBe(2);
      expect(selectionBand(container)).toEqual([
        Math.min(...rows) * ROW_HEIGHT,
        rows.length * ROW_HEIGHT,
      ]);

      instance.setSelectedLines(null);
      await waitFor(() => selectionBand(container) === 'hidden');
    } finally {
      await wait(10);
      instance.cleanUp();
      restoreGeometry();
      dom.cleanup();
    }
  });
});
