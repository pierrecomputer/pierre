import { afterAll, describe, expect, spyOn, test } from 'bun:test';
import type { ElementContent, Element as HASTElement } from 'hast';

import { FileDiff } from '../src/components/FileDiff';
import { DEFAULT_THEMES } from '../src/constants';
import { disposeHighlighter } from '../src/highlighter/shared_highlighter';
import { DiffHunksRenderer } from '../src/renderers/DiffHunksRenderer';
import { preloadFileDiff } from '../src/ssr';
import type {
  DiffLineAnnotation,
  FileDiffMetadata,
  SemanticDiffCollapsibleRegion,
} from '../src/types';
import { formatCollapsedMoveSummary } from '../src/utils/createSemanticRegionRow';
import { parseDiffFromFile } from '../src/utils/parseDiffFromFile';
import { installDom, wait, waitFor } from './domHarness';
import {
  assertDefined,
  collectAllElements,
  hastTextContent,
} from './testUtils';

afterAll(async () => {
  await disposeHighlighter();
});

// Lines 3-5 of the old file move to the end: the old side shows them as
// deleted rows beside a gap, and the new side as added rows beside a gap.
const OLD = 'a\nb\nmoved one\nmoved two\nmoved three\nc\nd\ne\nf\n';
const NEW = 'a\nb\nc\nd\ne\nf\nmoved one\nmoved two\nmoved three\n';

const MOVE: SemanticDiffCollapsibleRegion = {
  old: { start: 3, end: 5 },
  operations: [0],
  counts: { moved: 3, edited: 0, removed: 0 },
};

function movedDiff(
  collapsibleRegions: SemanticDiffCollapsibleRegion[] = [MOVE]
): FileDiffMetadata {
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
  fileDiff.semanticCollapsibleRegions = collapsibleRegions;
  return fileDiff;
}

// One summary per content row of a column, in row order: a line number, a
// gap with its height in rows, or a collapsed move's row.
function columnRows(content: ElementContent[] | undefined): string[] {
  assertDefined(content, 'content AST should be defined');
  return content.flatMap((node) => {
    if (node.type !== 'element') return [];
    const { properties } = node;
    if (properties['data-line'] != null) return [`${properties['data-line']}`];
    if ('data-content-buffer' in properties) {
      return [`gap×${properties['data-buffer-size']}`];
    }
    if ('data-semantic-region' in properties) {
      return [
        `collapsed ${properties['data-semantic-region-start']}-${properties['data-semantic-region-end']}`,
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

// Click the collapsed row's button, or the expanded move's first-line icon.
function clickSemanticRegionToggle(container: HTMLElement): void {
  const toggle = container.shadowRoot?.querySelector(
    '[data-semantic-region-toggle]'
  );
  assertDefined(toggle, 'toggle should be rendered');
  toggle.dispatchEvent(
    new window.MouseEvent('click', { bubbles: true, composed: true })
  );
}

describe('collapsed moves', () => {
  test('a collapsed move shows one row beside a one-row gap', async () => {
    const result = await new DiffHunksRenderer({
      diffStyle: 'split',
    }).asyncRender(movedDiff());

    expect(columnRows(result.deletionsContentAST)).toEqual([
      '1',
      '2',
      'collapsed 3-5',
      '6',
      '7',
      '8',
      '9',
      'gap×3',
    ]);
    expect(columnRows(result.additionsContentAST)).toEqual([
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

    assertDefined(result.deletionsGutterAST, 'gutter AST should be defined');
    const gutter = collectAllElements(result.deletionsGutterAST);
    const cell = gutter.find(
      (node) => node.properties['data-gutter-buffer'] === 'semantic-region'
    );
    assertDefined(cell, 'collapsed move gutter cell should be rendered');
    expect(cell.properties['data-line-type']).toBe('change-moved');
    expect(hastTextContent(cell)).toBe('Moved 3 lines');
    const toggle = collectAllElements(cell.children).find(
      (node) => 'data-semantic-region-toggle' in node.properties
    );
    expect(toggle?.properties['data-semantic-region-toggle']).toBe(3);
    expect(toggle?.properties['aria-expanded']).toBe('false');
    // The row shows the icon its first line shows when expanded.
    expect(iconHref(cell)).toBe('#diffs-icon-symbol-moved-duo');
  });

  test('an expanded move shows its lines, and its first icon collapses it', async () => {
    const renderer = new DiffHunksRenderer({ diffStyle: 'split' });
    const fileDiff = movedDiff();
    await renderer.asyncRender(fileDiff);
    renderer.toggleSemanticRegion(3);
    const result = await renderer.asyncRender(fileDiff);

    expect(columnRows(result.deletionsContentAST)).toEqual([
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
    expect(columnRows(result.additionsContentAST)).toEqual([
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
    assertDefined(result.deletionsGutterAST, 'gutter AST should be defined');
    const toggles = collectAllElements(result.deletionsGutterAST).filter(
      (node) => 'data-semantic-region-toggle' in node.properties
    );
    expect(toggles.map(iconHref)).toEqual(['#diffs-icon-symbol-moved-duo']);
    expect(toggles.map((node) => node.properties)).toEqual([
      expect.objectContaining({
        'data-semantic-icon': '',
        'data-semantic-region-toggle': 3,
        'aria-expanded': 'true',
      }),
    ]);
  });

  test('moves render in full in unified view, windowed renders, and around annotations', async () => {
    const unified = await new DiffHunksRenderer({
      diffStyle: 'unified',
    }).asyncRender(movedDiff());
    expect(
      collectAllElements(unified.unifiedContentAST ?? []).some(
        (node) => 'data-semantic-region' in node.properties
      )
    ).toBe(false);

    const windowed = await new DiffHunksRenderer({
      diffStyle: 'split',
    }).asyncRender(movedDiff(), {
      startingLine: 0,
      totalLines: 100,
      bufferBefore: 0,
      bufferAfter: 0,
    });
    expect(columnRows(windowed.deletionsContentAST)).toContain('4');

    const annotated = new DiffHunksRenderer<string>({ diffStyle: 'split' });
    const annotations: DiffLineAnnotation<string>[] = [
      { side: 'deletions', lineNumber: 4, metadata: 'note' },
    ];
    annotated.setLineAnnotations(annotations);
    const result = await annotated.asyncRender(movedDiff());
    expect(columnRows(result.deletionsContentAST)).toContain('4');
    expect(columnRows(result.deletionsContentAST)).not.toContain(
      'collapsed 3-5'
    );
  });

  test('each region collapses or expands on its own', async () => {
    // The same moved lines, split into two adjacent regions.
    const regions: SemanticDiffCollapsibleRegion[] = [
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
    const fileDiff = movedDiff(regions);
    const collapsed = await renderer.asyncRender(fileDiff);
    expect(columnRows(collapsed.deletionsContentAST).slice(0, 5)).toEqual([
      '1',
      '2',
      'collapsed 3-3',
      'collapsed 4-5',
      '6',
    ]);

    renderer.toggleSemanticRegion(3);
    const firstExpanded = await renderer.asyncRender(fileDiff);
    expect(columnRows(firstExpanded.deletionsContentAST).slice(0, 5)).toEqual([
      '1',
      '2',
      '3',
      'collapsed 4-5',
      '6',
    ]);
  });

  test('a collapsed move over a row with a new-side line is an error', async () => {
    const badMove: SemanticDiffCollapsibleRegion = {
      old: { start: 1, end: 2 },
      operations: [0],
      counts: { moved: 2, edited: 0, removed: 0 },
    };
    expect(
      new DiffHunksRenderer({ diffStyle: 'split' }).asyncRender(
        movedDiff([badMove])
      )
    ).rejects.toThrow('has a new-side line beside old line 1');
  });

  test('the toggle expands and collapses the move in a FileDiff', async () => {
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
    const clickToggle = () => clickSemanticRegionToggle(container);
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

  test('the first toggle after hydrating server markup expands the move', async () => {
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

      clickSemanticRegionToggle(container);
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

  test('pressing a collapsed row or the collapse icon never selects lines', async () => {
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

      // Anywhere on the collapsed row expands it: here its content cell.
      const row = root().querySelector('[data-semantic-region]');
      assertDefined(row, 'collapsed row should be rendered');
      press(row);
      await waitFor(() => oldLineCount() === 9);
      expect(oldLineCount()).toBe(9);

      const icon = root().querySelector(
        '[data-semantic-icon][data-semantic-region-toggle]'
      );
      assertDefined(icon, 'collapse icon should be rendered');
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
    expect(
      formatCollapsedMoveSummary({ moved: 2, edited: 0, removed: 0 })
    ).toBe('Moved 2 lines');
    expect(
      formatCollapsedMoveSummary({ moved: 2, edited: 1, removed: 0 })
    ).toBe('Moved 3 lines, edited 1 line');
    expect(
      formatCollapsedMoveSummary({ moved: 3, edited: 1, removed: 2 })
    ).toBe('Moved 6 lines, edited 1 line, removed 2 lines');
  });
});
