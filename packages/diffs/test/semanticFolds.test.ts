import { afterAll, describe, expect, spyOn, test } from 'bun:test';
import type { ElementContent, Element as HASTElement } from 'hast';

import { FileDiff } from '../src/components/FileDiff';
import { DEFAULT_THEMES } from '../src/constants';
import { disposeHighlighter } from '../src/highlighter/shared_highlighter';
import {
  DiffHunksRenderer,
  type HunksRenderResult,
} from '../src/renderers/DiffHunksRenderer';
import { preloadFileDiff } from '../src/ssr';
import type {
  DiffLineAnnotation,
  FileDiffMetadata,
  SemanticDiffFold,
} from '../src/types';
import { formatSemanticFoldSummary } from '../src/utils/createSemanticFoldRow';
import { parseDiffFromFile } from '../src/utils/parseDiffFromFile';
import { installDom, wait, waitFor } from './domHarness';
import {
  assertDefined,
  collectAllElements,
  contentAST,
  gutterAST,
  hastTextContent,
} from './testUtils';

afterAll(async () => {
  await disposeHighlighter();
});

// Lines 3-5 of the old file move to the end: the old side shows them as
// deleted rows beside a gap, and the new side as added rows beside a gap.
const OLD = 'a\nb\nmoved one\nmoved two\nmoved three\nc\nd\ne\nf\n';
const NEW = 'a\nb\nc\nd\ne\nf\nmoved one\nmoved two\nmoved three\n';

const FOLD: SemanticDiffFold = {
  old: { start: 3, end: 5 },
  operations: [0],
  counts: { moved: 3, edited: 0, removed: 0 },
};

function movedDiff(folds: SemanticDiffFold[] = [FOLD]): FileDiffMetadata {
  const fileDiff = parseDiffFromFile(
    { name: 'moves.txt', contents: OLD },
    { name: 'moves.txt', contents: NEW }
  );
  fileDiff.semanticOperations = [
    {
      type: 'moved',
      spans: [
        {
          role: 'root',
          relation: 'moved',
          old: [
            {
              start: { line: 3, character: 0 },
              end: { line: 6, character: 0 },
            },
          ],
          new: [
            {
              start: { line: 7, character: 0 },
              end: { line: 10, character: 0 },
            },
          ],
          linePairs: [{ old: { start: 3, end: 5 }, new: { start: 7, end: 9 } }],
        },
      ],
      lines: {
        old: [{ start: 3, end: 5, spanIndex: 0 }],
        new: [{ start: 7, end: 9, spanIndex: 0 }],
      },
    },
  ];
  fileDiff.semanticFolds = folds;
  return fileDiff;
}

// One summary per content row of a column, in row order: a line number, a
// gap with its height in rows, a closed fold's row, or a "No newline at
// end of file" marker.
function columnRows(content: ElementContent[] | undefined): string[] {
  assertDefined(content, 'content AST should be defined');
  return content.flatMap((node) => {
    if (node.type !== 'element') return [];
    const { properties } = node;
    if (properties['data-line'] != null) {
      return [String(properties['data-line'])];
    }
    if ('data-content-buffer' in properties) {
      return [`gap×${String(properties['data-buffer-size'])}`];
    }
    if ('data-no-newline' in properties) return ['no newline'];
    if ('data-semantic-fold' in properties) {
      return [
        `fold ${String(properties['data-semantic-fold-start'])}-${String(properties['data-semantic-fold-end'])}`,
      ];
    }
    return [];
  });
}

// The sprite symbol of the first icon inside an element.
function iconHref(element: HASTElement): unknown {
  return collectAllElements([element]).find((node) => node.tagName === 'use')
    ?.properties.href;
}

// The old line numbers a FileDiff's deletions column renders, in row order.
function renderedOldLines(container: HTMLElement): (string | null)[] {
  return [
    ...(container.shadowRoot?.querySelectorAll(
      '[data-deletions] [data-content] > [data-line]'
    ) ?? []),
  ].map((row) => row.getAttribute('data-line'));
}

// Click the closed fold's button, or the open fold's first-line icon.
function clickSemanticFoldToggle(container: HTMLElement): void {
  const toggle = container.shadowRoot?.querySelector(
    '[data-semantic-fold-toggle]'
  );
  assertDefined(toggle, 'toggle should be rendered');
  toggle.dispatchEvent(
    new window.MouseEvent('click', { bubbles: true, composed: true })
  );
}

describe('semantic folds', () => {
  test('a closed fold shows one row beside a one-row gap', async () => {
    const result = await new DiffHunksRenderer({
      diffStyle: 'split',
    }).asyncRender(movedDiff());

    expect(columnRows(contentAST(result, 'deletions'))).toEqual([
      '1',
      '2',
      'fold 3-5',
      '6',
      '7',
      '8',
      '9',
      'gap×3',
    ]);
    expect(columnRows(contentAST(result, 'additions'))).toEqual([
      '1',
      '2',
      'gap×1',
      '3',
      '4',
      '5',
      '6',
      '7',
      '8',
      '9',
    ]);

    const gutter = collectAllElements(gutterAST(result, 'deletions'));
    const cell = gutter.find(
      (node) => node.properties['data-gutter-buffer'] === 'semantic-fold'
    );
    assertDefined(cell, "the fold row's gutter cell should be rendered");
    expect(cell.properties['data-line-type']).toBe('change-moved');
    expect(hastTextContent(cell)).toBe('Moved 3 lines');
    const toggle = collectAllElements(cell.children).find(
      (node) => 'data-semantic-fold-toggle' in node.properties
    );
    expect(toggle?.properties['data-semantic-fold-toggle']).toBe(3);
    expect(toggle?.properties['aria-expanded']).toBe('false');
    // The row shows the icon its first line shows when open.
    expect(iconHref(cell)).toBe('#diffs-icon-symbol-moved-duo');
  });

  test('an open fold shows its lines, and its first icon closes it', async () => {
    const renderer = new DiffHunksRenderer({ diffStyle: 'split' });
    const fileDiff = movedDiff();
    await renderer.asyncRender(fileDiff);
    renderer.toggleSemanticFold(3);
    const result = await renderer.asyncRender(fileDiff);

    expect(columnRows(contentAST(result, 'deletions'))).toEqual([
      '1',
      '2',
      '3',
      '4',
      '5',
      '6',
      '7',
      '8',
      '9',
      'gap×3',
    ]);
    expect(columnRows(contentAST(result, 'additions'))).toEqual([
      '1',
      '2',
      'gap×3',
      '3',
      '4',
      '5',
      '6',
      '7',
      '8',
      '9',
    ]);
    assertDefined(
      gutterAST(result, 'deletions'),
      'gutter AST should be defined'
    );
    const toggles = collectAllElements(gutterAST(result, 'deletions')).filter(
      (node) => 'data-semantic-fold-toggle' in node.properties
    );
    expect(toggles.map(iconHref)).toEqual(['#diffs-icon-symbol-moved-duo']);
    expect(toggles.map((node) => node.properties)).toEqual([
      expect.objectContaining({
        type: 'button',
        'data-semantic-icon-button': '',
        'data-semantic-fold-toggle': 3,
        'aria-expanded': 'true',
      }),
    ]);
  });

  test('a windowed render keeps folds closed wherever the window starts', async () => {
    const renderer = new DiffHunksRenderer({ diffStyle: 'split' });
    const fileDiff = movedDiff();
    const renderWindow = (startingLine: number, totalLines: number) =>
      renderer.asyncRender(fileDiff, {
        startingLine,
        totalLines,
        bufferBefore: 0,
        bufferAfter: 0,
      });

    // The fold's row is the window's third row.
    const fromTop = await renderWindow(0, 4);
    expect(columnRows(contentAST(fromTop, 'deletions'))).toEqual([
      '1',
      '2',
      'fold 3-5',
      '6',
    ]);
    expect(columnRows(contentAST(fromTop, 'additions'))).toEqual([
      '1',
      '2',
      'gap×1',
      '3',
    ]);

    // The window starts on the fold's row.
    const fromFold = await renderWindow(2, 2);
    expect(columnRows(contentAST(fromFold, 'deletions'))).toEqual([
      'fold 3-5',
      '6',
    ]);

    // The window starts on the row after it: the lines the fold hides take
    // up no rows.
    const afterFold = await renderWindow(3, 3);
    expect(columnRows(contentAST(afterFold, 'deletions'))).toEqual([
      '6',
      '7',
      '8',
    ]);
    expect(columnRows(contentAST(afterFold, 'additions'))).toEqual([
      '3',
      '4',
      '5',
    ]);
  });

  test("a closed fold on a hunk's last rows keeps the new side's no-newline marker", async () => {
    // Neither file ends with a newline, and the old file's last two lines are
    // gone from the new one. The hunk's last row is one the fold hides.
    const fileDiff = parseDiffFromFile(
      { name: 'eof.txt', contents: 'a\nb\nc\nd\nmoved one\nmoved two' },
      { name: 'eof.txt', contents: 'a\nb\nc\nd' }
    );
    fileDiff.semanticOperations = [];
    fileDiff.semanticFolds = [
      {
        old: { start: 5, end: 6 },
        operations: [0],
        counts: { moved: 2, edited: 0, removed: 0 },
      },
    ];
    const result = await new DiffHunksRenderer({
      diffStyle: 'split',
    }).asyncRender(fileDiff);
    expect(columnRows(contentAST(result, 'deletions'))).toEqual([
      '1',
      '2',
      '3',
      '4',
      'fold 5-6',
      'gap×1',
    ]);
    expect(columnRows(contentAST(result, 'additions'))).toEqual([
      '1',
      '2',
      '3',
      '4',
      'gap×1',
      'no newline',
    ]);
  });

  test('a fold closes and opens in the unified view', async () => {
    const renderer = new DiffHunksRenderer({ diffStyle: 'unified' });
    const fileDiff = movedDiff();
    const closed = await renderer.asyncRender(fileDiff);
    // Old lines 3-5 are one row; the unchanged lines after them show their
    // new line numbers.
    expect(columnRows(contentAST(closed, 'unified'))).toEqual([
      '1',
      '2',
      'fold 3-5',
      '3',
      '4',
      '5',
      '6',
      '7',
      '8',
      '9',
    ]);
    const cell = collectAllElements(gutterAST(closed, 'unified')).find(
      (node) => node.properties['data-gutter-buffer'] === 'semantic-fold'
    );
    assertDefined(cell, "the fold row's gutter cell should be rendered");
    expect(hastTextContent(cell)).toBe('Moved 3 lines');

    renderer.toggleSemanticFold(3);
    const open = await renderer.asyncRender(fileDiff);
    expect(columnRows(contentAST(open, 'unified'))).toEqual([
      '1',
      '2',
      '3',
      '4',
      '5',
      '3',
      '4',
      '5',
      '6',
      '7',
      '8',
      '9',
    ]);
    const toggles = collectAllElements(gutterAST(open, 'unified')).filter(
      (node) => 'data-semantic-fold-toggle' in node.properties
    );
    expect(toggles.map((node) => node.properties)).toEqual([
      expect.objectContaining({
        'data-semantic-fold-toggle': 3,
        'aria-expanded': 'true',
      }),
    ]);
  });

  test('an annotation inside a fold shows only while the fold is open', async () => {
    const renderer = new DiffHunksRenderer<string>({ diffStyle: 'split' });
    const annotations: DiffLineAnnotation<string>[] = [
      { side: 'deletions', lineNumber: 4, metadata: 'note' },
    ];
    renderer.setLineAnnotations(annotations);
    const fileDiff = movedDiff();
    const hasAnnotation = (result: HunksRenderResult) =>
      collectAllElements(contentAST(result, 'deletions') ?? []).some(
        (node) => 'data-line-annotation' in node.properties
      );

    const closed = await renderer.asyncRender(fileDiff);
    expect(columnRows(contentAST(closed, 'deletions'))).toContain('fold 3-5');
    expect(hasAnnotation(closed)).toBe(false);

    renderer.toggleSemanticFold(3);
    const open = await renderer.asyncRender(fileDiff);
    expect(columnRows(contentAST(open, 'deletions'))).toContain('4');
    expect(hasAnnotation(open)).toBe(true);
  });

  test('each fold opens or closes on its own', async () => {
    // The same moved lines, split into two adjacent folds.
    const twoFolds: SemanticDiffFold[] = [
      {
        old: { start: 3, end: 3 },
        operations: [0],
        counts: { moved: 1, edited: 0, removed: 0 },
      },
      {
        old: { start: 4, end: 5 },
        operations: [0],
        counts: { moved: 2, edited: 0, removed: 0 },
      },
    ];
    const renderer = new DiffHunksRenderer({ diffStyle: 'split' });
    const fileDiff = movedDiff(twoFolds);
    const closed = await renderer.asyncRender(fileDiff);
    expect(columnRows(contentAST(closed, 'deletions')).slice(0, 5)).toEqual([
      '1',
      '2',
      'fold 3-3',
      'fold 4-5',
      '6',
    ]);

    renderer.toggleSemanticFold(3);
    const firstOpen = await renderer.asyncRender(fileDiff);
    expect(columnRows(contentAST(firstOpen, 'deletions')).slice(0, 5)).toEqual([
      '1',
      '2',
      '3',
      'fold 4-5',
      '6',
    ]);
  });

  test('the toggle opens and closes the fold in a FileDiff', async () => {
    const dom = installDom();
    const consoleError = spyOn(console, 'error');
    const container = document.createElement('div');
    document.body.appendChild(container);
    const instance = new FileDiff<undefined>({
      disableFileHeader: true,
      theme: DEFAULT_THEMES,
      diffStyle: 'split',
    });
    const oldLines = () => renderedOldLines(container);
    const clickToggle = () => clickSemanticFoldToggle(container);
    try {
      instance.render({
        fileDiff: movedDiff(),
        fileContainer: container,
        forceRender: true,
      });
      await waitFor(() => oldLines().length > 0);
      expect(oldLines()).toEqual(['1', '2', '6', '7', '8', '9']);

      clickToggle();
      await waitFor(() => oldLines().length === 9);
      expect(oldLines()).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9']);

      clickToggle();
      await waitFor(() => oldLines().length === 6);
      expect(oldLines()).toEqual(['1', '2', '6', '7', '8', '9']);
      expect(consoleError).not.toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
      await wait(10);
      instance.cleanUp();
      dom.cleanup();
    }
  });

  test("a selection over any hidden line selects the closed fold's row", async () => {
    const dom = installDom();
    const consoleError = spyOn(console, 'error');
    const container = document.createElement('div');
    document.body.appendChild(container);
    const instance = new FileDiff<undefined>({
      disableFileHeader: true,
      theme: DEFAULT_THEMES,
      diffStyle: 'split',
    });
    // The selected-line value of each deletions-side content row, keyed by
    // its line number or 'fold' for the closed fold's row; unselected rows are
    // left out.
    const selectedRows = () =>
      Object.fromEntries(
        [
          ...(container.shadowRoot?.querySelectorAll(
            '[data-deletions] [data-content] > [data-selected-line]'
          ) ?? []),
        ].map((row) => [
          row.getAttribute('data-line') ?? 'fold',
          row.getAttribute('data-selected-line'),
        ])
      );
    const foldGutterSelection = () =>
      container.shadowRoot
        ?.querySelector("[data-gutter-buffer='semantic-fold']")
        ?.getAttribute('data-selected-line');
    try {
      instance.render({
        fileDiff: movedDiff(),
        fileContainer: container,
        forceRender: true,
      });
      await waitFor(() => renderedOldLines(container).length > 0);

      // A hidden line alone.
      instance.setSelectedLines({ start: 4, end: 4, side: 'deletions' });
      await waitFor(() => 'fold' in selectedRows());
      expect(selectedRows()).toEqual({ fold: 'single' });
      expect(foldGutterSelection()).toBe('single');

      // A range that starts above the fold and ends below it.
      instance.setSelectedLines({ start: 2, end: 6, side: 'deletions' });
      await waitFor(() => '6' in selectedRows());
      expect(selectedRows()).toEqual({ '2': 'first', fold: '', '6': 'last' });
      expect(foldGutterSelection()).toBe('');

      // A range that ends inside the fold.
      instance.setSelectedLines({ start: 1, end: 3, side: 'deletions' });
      await waitFor(() => '1' in selectedRows());
      expect(selectedRows()).toEqual({ '1': 'first', '2': '', fold: 'last' });

      // A range that misses the fold.
      instance.setSelectedLines({ start: 7, end: 8, side: 'deletions' });
      await waitFor(() => '7' in selectedRows());
      expect(selectedRows()).toEqual({ '7': 'first', '8': 'last' });
      expect(foldGutterSelection()).toBeNull();
      expect(consoleError).not.toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
      await wait(10);
      instance.cleanUp();
      dom.cleanup();
    }
  });

  test('the unified view toggles a fold and selects its row in a FileDiff', async () => {
    const dom = installDom();
    const consoleError = spyOn(console, 'error');
    const container = document.createElement('div');
    document.body.appendChild(container);
    const instance = new FileDiff<undefined>({
      disableFileHeader: true,
      theme: DEFAULT_THEMES,
      diffStyle: 'unified',
    });
    // The unified column's content rows: a line number, or 'fold' for the
    // closed fold's row.
    const rows = () =>
      [
        ...(container.shadowRoot?.querySelectorAll(
          '[data-unified] [data-content] > :is([data-line], [data-semantic-fold])'
        ) ?? []),
      ].map((row) => row.getAttribute('data-line') ?? 'fold');
    const foldSelection = () =>
      container.shadowRoot
        ?.querySelector('[data-semantic-fold]')
        ?.getAttribute('data-selected-line');
    try {
      instance.render({
        fileDiff: movedDiff(),
        fileContainer: container,
        forceRender: true,
      });
      await waitFor(() => rows().length > 0);
      expect(rows()).toEqual([
        '1',
        '2',
        'fold',
        '3',
        '4',
        '5',
        '6',
        '7',
        '8',
        '9',
      ]);

      // A hidden line selects the fold's row.
      instance.setSelectedLines({ start: 4, end: 4, side: 'deletions' });
      await waitFor(() => foldSelection() != null);
      expect(foldSelection()).toBe('single');
      instance.setSelectedLines(null);

      clickSemanticFoldToggle(container);
      await waitFor(() => rows().length === 12);
      expect(rows()).not.toContain('fold');

      clickSemanticFoldToggle(container);
      await waitFor(() => rows().length === 10);
      expect(rows()).toContain('fold');
      expect(consoleError).not.toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
      await wait(10);
      instance.cleanUp();
      dom.cleanup();
    }
  });

  test('focus stays on the toggle when a button opens or closes the fold', async () => {
    const dom = installDom();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const instance = new FileDiff<undefined>({
      disableFileHeader: true,
      theme: DEFAULT_THEMES,
      diffStyle: 'split',
    });
    const root = () => {
      const { shadowRoot } = container;
      assertDefined(shadowRoot, 'FileDiff should render into a shadow root');
      return shadowRoot;
    };
    // The focused button, which a keyboard press activates with a click.
    const pressFocused = () => {
      const { activeElement } = root();
      if (!(activeElement instanceof HTMLButtonElement)) {
        throw new Error('expected a focused button');
      }
      activeElement.click();
    };
    try {
      instance.render({
        fileDiff: movedDiff(),
        fileContainer: container,
        forceRender: true,
      });
      await waitFor(() => renderedOldLines(container).length > 0);

      const openButton = root().querySelector<HTMLButtonElement>(
        'button[data-semantic-fold-button]'
      );
      assertDefined(openButton, "the fold's open button should be rendered");
      openButton.focus();
      pressFocused();
      await waitFor(() => renderedOldLines(container).length === 9);
      expect(
        root().activeElement?.matches(
          'button[data-semantic-icon-button][data-semantic-fold-toggle="3"]'
        )
      ).toBe(true);

      pressFocused();
      await waitFor(() => renderedOldLines(container).length === 6);
      expect(
        root().activeElement?.matches(
          'button[data-semantic-fold-button][data-semantic-fold-toggle="3"]'
        )
      ).toBe(true);
    } finally {
      await wait(10);
      instance.cleanUp();
      dom.cleanup();
    }
  });

  test('the first toggle after hydrating server markup opens the fold', async () => {
    const options = {
      disableFileHeader: true,
      theme: DEFAULT_THEMES,
      diffStyle: 'split' as const,
    };
    const { prerenderedHTML } = await preloadFileDiff({
      fileDiff: movedDiff(),
      options,
    });
    const dom = installDom();
    const consoleError = spyOn(console, 'error');
    const container = document.createElement('div');
    document.body.appendChild(container);
    const instance = new FileDiff<undefined>(options);
    try {
      instance.hydrate({
        fileDiff: movedDiff(),
        fileContainer: container,
        prerenderedHTML,
      });
      await waitFor(() => renderedOldLines(container).length > 0);
      expect(renderedOldLines(container)).toEqual([
        '1',
        '2',
        '6',
        '7',
        '8',
        '9',
      ]);

      clickSemanticFoldToggle(container);
      await waitFor(() => renderedOldLines(container).length === 9);
      expect(renderedOldLines(container)).toEqual([
        '1',
        '2',
        '3',
        '4',
        '5',
        '6',
        '7',
        '8',
        '9',
      ]);
      expect(consoleError).not.toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
      await wait(10);
      instance.cleanUp();
      dom.cleanup();
    }
  });

  test("pressing a closed fold's row or the close icon never selects lines", async () => {
    const dom = installDom();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const selections: unknown[] = [];
    const instance = new FileDiff<undefined>({
      disableFileHeader: true,
      theme: DEFAULT_THEMES,
      diffStyle: 'split',
      enableLineSelection: true,
      onLineSelected: (range) => selections.push(range),
    });
    const root = () => {
      assertDefined(container.shadowRoot, 'shadow root should exist');
      return container.shadowRoot;
    };
    const oldLineCount = () =>
      root().querySelectorAll('[data-deletions] [data-content] > [data-line]')
        .length;
    // A full mouse press: pointerdown and pointerup, then the click.
    const press = (target: Element) => {
      const init = {
        bubbles: true,
        composed: true,
        button: 0,
        pointerId: 1,
        pointerType: 'mouse',
      };
      target.dispatchEvent(new window.PointerEvent('pointerdown', init));
      document.dispatchEvent(new window.PointerEvent('pointerup', init));
      target.dispatchEvent(new window.MouseEvent('click', init));
    };
    try {
      instance.render({
        fileDiff: movedDiff(),
        fileContainer: container,
        forceRender: true,
      });
      await waitFor(() => oldLineCount() > 0);

      // Anywhere on the closed fold's row opens it: here its content cell.
      const row = root().querySelector('[data-semantic-fold]');
      assertDefined(row, "the closed fold's row should be rendered");
      press(row);
      await waitFor(() => oldLineCount() === 9);
      expect(oldLineCount()).toBe(9);

      const icon = root().querySelector(
        '[data-semantic-icon-button][data-semantic-fold-toggle]'
      );
      assertDefined(icon, 'the close icon should be rendered');
      press(icon);
      await waitFor(() => oldLineCount() === 6);
      expect(oldLineCount()).toBe(6);

      expect(selections).toEqual([]);
      expect(root().querySelectorAll('[data-selected-line]').length).toBe(0);
    } finally {
      await wait(10);
      instance.cleanUp();
      dom.cleanup();
    }
  });

  test('the summary counts every line moved, then the edits and removals', () => {
    expect(formatSemanticFoldSummary({ moved: 2, edited: 0, removed: 0 })).toBe(
      'Moved 2 lines'
    );
    expect(formatSemanticFoldSummary({ moved: 2, edited: 1, removed: 0 })).toBe(
      'Moved 3 lines, edited 1 line'
    );
    expect(formatSemanticFoldSummary({ moved: 3, edited: 1, removed: 2 })).toBe(
      'Moved 6 lines, edited 1 line, removed 2 lines'
    );
  });
});
