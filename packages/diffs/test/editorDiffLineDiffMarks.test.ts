import { afterAll, describe, expect, test } from 'bun:test';

import { FileDiff } from '../src/components/FileDiff';
import { Editor } from '../src/editor/editor';
import { getHighlighterType } from '../src/highlighter/highlighterType';
import { disposeHighlighter } from '../src/highlighter/shared_highlighter';
import type {
  DiffLineAnnotation,
  FileDiffMetadata,
  RenderRange,
} from '../src/types';
import { processFile } from '../src/utils/parsePatchFiles';
import { installDom, wait, waitFor } from './domHarness';

afterAll(async () => {
  await disposeHighlighter();
});

const OLD = 'const first = alpha(1, 2);\nconst second = beta;\n';
const NEW = 'const first = alpha(1, 3);\nconst second = beta;\n';

type DiffStyle = 'split' | 'unified';

// Lists every rendered row that has word diff highlights, as
// "<side>:<line number>:<start>-<end> <highlighted text>|...". Rows in the
// deletions column, and unified rows for old lines, are the deletion side.
function getHighlights(container: HTMLElement): string[] {
  const shadow = container.shadowRoot;
  if (shadow == null) throw new Error('expected a shadow root');
  const rows: string[] = [];
  for (const code of shadow.querySelectorAll<HTMLElement>('[data-code]')) {
    for (const row of code.querySelectorAll<HTMLElement>(
      '[data-content] > [data-line]'
    )) {
      const marks = Array.from(
        row.querySelectorAll('[data-diff-span]'),
        (mark) => {
          const start = getTextOffset(row, mark);
          const text = mark.textContent ?? '';
          return `${start}-${start + text.length} ${text}`;
        }
      );
      if (marks.length === 0) continue;
      const side =
        code.dataset.deletions !== undefined ||
        row.dataset.lineType === 'change-deletion'
          ? 'deletions'
          : 'additions';
      rows.push(`${side}:${row.dataset.line}:${marks.join('|')}`);
    }
  }
  return rows.sort();
}

// Lists every rendered code row and line number row, top to bottom in each
// column, as "<line type>:<line number>". Rows saying the file has no final
// newline show "no-newline" instead of a line number.
function getRowLayout(container: HTMLElement): string[] {
  const shadow = container.shadowRoot;
  if (shadow == null) throw new Error('expected a shadow root');
  const rows: string[] = [];
  for (const code of shadow.querySelectorAll<HTMLElement>('[data-code]')) {
    for (const row of code.querySelectorAll<HTMLElement>(
      '[data-content] > [data-line], [data-content] > [data-no-newline]'
    )) {
      rows.push(`${row.dataset.lineType}:${row.dataset.line ?? 'no-newline'}`);
    }
    for (const row of code.querySelectorAll<HTMLElement>(
      '[data-gutter] > [data-column-number], [data-gutter] > [data-gutter-buffer="metadata"]'
    )) {
      rows.push(
        `${row.dataset.lineType}:${row.dataset.columnNumber ?? 'no-newline'}`
      );
    }
  }
  return rows;
}

// Lists every annotation row in each column as the row it is drawn under:
// "<line type>:<line number>".
function getAnnotationRows(container: HTMLElement): string[] {
  const shadow = container.shadowRoot;
  if (shadow == null) throw new Error('expected a shadow root');
  return Array.from(
    shadow.querySelectorAll('[data-content] > [data-line-annotation]'),
    (row) => {
      const above = row.previousElementSibling;
      return `${above?.getAttribute('data-line-type')}:${above?.getAttribute('data-line')}`;
    }
  );
}

// The column where `mark` starts within the text of `row`.
function getTextOffset(row: Element, mark: Element): number {
  const walker = row.ownerDocument.createTreeWalker(row, 4 /* text nodes */);
  let offset = 0;
  for (let node = walker.nextNode(); node != null; node = walker.nextNode()) {
    if (mark.contains(node)) return offset;
    offset += node.textContent?.length ?? 0;
  }
  throw new Error('highlight is not inside its row');
}

// Waits until the editor attached to the diff in `container` can be edited.
async function waitForEditable(container: HTMLElement): Promise<void> {
  // The new file's column, which the editor makes editable.
  const isEditable = () =>
    container.shadowRoot?.querySelector<HTMLElement>(
      '[data-code]:not([data-deletions]) [data-content]'
    )?.contentEditable === 'true';
  await waitFor(isEditable);
  expect(isEditable()).toBe(true);
}

function hasHighlights(container: HTMLElement): boolean {
  return container.shadowRoot?.querySelector('[data-diff-span]') != null;
}

// The highlights a diff shows when it is rendered without an editor.
async function getReadOnlyHighlights(
  diffStyle: DiffStyle,
  newContents: string,
  oldContents = OLD,
  renderRange?: RenderRange
): Promise<string[]> {
  return (
    await renderReadOnly(diffStyle, newContents, oldContents, renderRange)
  ).highlights;
}

// The rows and highlights a diff shows when it is rendered without an editor.
async function renderReadOnly(
  diffStyle: DiffStyle,
  newContents: string,
  oldContents = OLD,
  renderRange?: RenderRange
): Promise<{ highlights: string[]; layout: string[] }> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const fileDiff = new FileDiff<undefined>({
    disableFileHeader: true,
    diffStyle,
  });
  try {
    fileDiff.render({
      oldFile: { name: 'edit.ts', contents: oldContents },
      newFile: { name: 'edit.ts', contents: newContents },
      fileContainer: container,
      forceRender: true,
      renderRange,
    });
    await waitFor(() => hasHighlights(container));
    return {
      highlights: getHighlights(container),
      layout: getRowLayout(container),
    };
  } finally {
    fileDiff.cleanUp();
    container.remove();
  }
}

// The rows and highlights an edit session shows for the same files: the
// empty line after a final line break is a row of its own, and no row says
// the file has no final newline.
async function renderEditSessionView(
  diffStyle: DiffStyle,
  newContents: string,
  oldContents = OLD,
  renderRange?: RenderRange
): Promise<{ highlights: string[]; layout: string[] }> {
  const withFinalRow = (text: string) =>
    text.endsWith('\n') ? `${text}\n` : text;
  const { highlights, layout } = await renderReadOnly(
    diffStyle,
    withFinalRow(newContents),
    withFinalRow(oldContents),
    renderRange
  );
  return {
    highlights,
    layout: layout.filter((row) => !row.endsWith(':no-newline')),
  };
}

// Renders the diff with an editor attached, runs `run`, then cleans up.
async function withEditor(
  diffStyle: DiffStyle,
  run: (
    editor: Editor<'file-diff', undefined>,
    container: HTMLElement,
    fileDiff: FileDiff<undefined>
  ) => void | Promise<void>,
  {
    renderRange,
    oldContents = OLD,
    newContents = NEW,
    lineAnnotations,
  }: {
    renderRange?: RenderRange;
    oldContents?: string;
    newContents?: string;
    lineAnnotations?: DiffLineAnnotation<undefined>[];
  } = {}
): Promise<void> {
  const dom = installDom();
  const container = document.createElement('div');
  document.body.appendChild(container);
  const fileDiff = new FileDiff<undefined>({
    disableFileHeader: true,
    diffStyle,
  });
  const editor = new Editor('file-diff');
  try {
    fileDiff.render({
      oldFile: { name: 'edit.ts', contents: oldContents },
      newFile: { name: 'edit.ts', contents: newContents },
      fileContainer: container,
      forceRender: true,
      renderRange,
      lineAnnotations,
    });
    editor.edit(fileDiff);
    await waitForEditable(container);
    await waitFor(() => hasHighlights(container));
    expect(hasHighlights(container)).toBe(true);
    await run(editor, container, fileDiff);
  } finally {
    await wait(10);
    editor.cleanUp();
    fileDiff.cleanUp();
    dom.cleanup();
  }
}

// Replaces text on one line of the new file.
function replaceText(
  editor: Editor<'file-diff', undefined>,
  line: number,
  start: number,
  end: number,
  newText: string
): void {
  editor.applyEdits([
    {
      range: {
        start: { line, character: start },
        end: { line, character: end },
      },
      newText,
    },
  ]);
}

// A render window that shows only the first three rows.
const WINDOW: RenderRange = {
  startingLine: 0,
  totalLines: 3,
  bufferBefore: 0,
  bufferAfter: 0,
};

describe('word diff highlights while typing', () => {
  for (const diffStyle of ['split', 'unified'] as const) {
    test(`${diffStyle}: update on both sides in the same pass`, async () => {
      await withEditor(diffStyle, async (editor, container) => {
        // 'alpha(1, 3)' becomes 'alpha(9, 3)', which moves the old line's
        // highlight from '2' to both numbers.
        replaceText(editor, 0, 20, 21, '9');
        // No waiting: the edit itself must leave the right highlights.
        const highlights = getHighlights(container);
        expect(highlights).toEqual(
          await getReadOnlyHighlights(
            diffStyle,
            NEW.replace('alpha(1, 3)', 'alpha(9, 3)')
          )
        );
      });
    });
  }

  // Edits that add or remove rows, or change their line types, render again
  // in the same pass.
  for (const diffStyle of ['split', 'unified'] as const) {
    test(`${diffStyle}: show the new rows right away when a context line becomes a change`, async () => {
      await withEditor(
        diffStyle,
        async (editor, container) => {
          replaceText(editor, 1, 15, 19, 'gamma');
          const expected = await renderEditSessionView(
            diffStyle,
            NEW.replace('beta', 'gamma'),
            OLD,
            WINDOW
          );
          expect(getRowLayout(container)).toEqual(expected.layout);
          expect(getHighlights(container)).toEqual(expected.highlights);
        },
        { renderRange: WINDOW }
      );
    });

    test(`${diffStyle}: show the new rows right away when change blocks merge`, async () => {
      const oldContents =
        'const first = alpha(1, 2);\nconst second = beta;\nconst third = omega(3);\n';
      const newContents =
        'const first = alpha(1, 3);\nconst second = beta;\nconst third = omega(4);\n';
      await withEditor(
        diffStyle,
        async (editor, container) => {
          replaceText(editor, 1, 15, 19, 'gamma');
          const expected = await renderEditSessionView(
            diffStyle,
            newContents.replace('beta', 'gamma'),
            oldContents,
            WINDOW
          );
          expect(getRowLayout(container)).toEqual(expected.layout);
          expect(getHighlights(container)).toEqual(expected.highlights);
        },
        { renderRange: WINDOW, oldContents, newContents }
      );
    });

    test(`${diffStyle}: show the new rows right away when an added line gains an old partner`, async () => {
      const oldContents = 'const first = alpha(1, 2);\nconst third = omega;\n';
      const newContents =
        'const first = alpha(1, 3);\nconst second = beta;\nconst third = omega;\n';
      await withEditor(
        diffStyle,
        async (editor, container) => {
          // The old line after the added one becomes a change, so in split
          // view the empty row next to the added line moves below it.
          replaceText(editor, 2, 14, 19, 'gamma');
          const expected = await renderEditSessionView(
            diffStyle,
            newContents.replace('omega', 'gamma'),
            oldContents
          );
          expect(getRowLayout(container)).toEqual(expected.layout);
          expect(getHighlights(container)).toEqual(expected.highlights);
        },
        { oldContents, newContents }
      );
    });

    test(`${diffStyle}: show the new rows right away when one edit reverts a change and makes another`, async () => {
      const oldContents =
        'const first = alpha;\nconst second = beta;\nconst third = omega;\n';
      const newContents = oldContents.replace('alpha', 'ALPHA');
      await withEditor(
        diffStyle,
        async (editor, container) => {
          editor.applyEdits([
            {
              range: {
                start: { line: 0, character: 14 },
                end: { line: 0, character: 19 },
              },
              newText: 'alpha',
            },
            {
              range: {
                start: { line: 2, character: 14 },
                end: { line: 2, character: 19 },
              },
              newText: 'OMEGA',
            },
          ]);
          const expected = await renderEditSessionView(
            diffStyle,
            oldContents.replace('omega', 'OMEGA'),
            oldContents,
            WINDOW
          );
          expect(getRowLayout(container)).toEqual(expected.layout);
          expect(getHighlights(container)).toEqual(expected.highlights);
        },
        { renderRange: WINDOW, oldContents, newContents }
      );
    });

    test(`${diffStyle}: update the rows saying there is no final newline right away`, async () => {
      const oldContents = 'const first = alpha;\nconst second = beta;';
      const newContents = oldContents.replace('alpha', 'ALPHA');
      await withEditor(
        diffStyle,
        async (editor, container) => {
          // The last line becomes a change, so the rows below it saying the
          // file has no final newline do too.
          replaceText(editor, 1, 15, 19, 'BETA');
          const expected = await renderEditSessionView(
            diffStyle,
            newContents.replace('beta', 'BETA'),
            oldContents
          );
          expect(getRowLayout(container)).toEqual(expected.layout);
          expect(getHighlights(container)).toEqual(expected.highlights);
        },
        { oldContents, newContents }
      );
    });

    test(`${diffStyle}: keep annotations on their lines when an edit rebuilds the rows`, async () => {
      const oldContents =
        'const first = alpha;\nconst second = beta;\nconst third = gamma;\nconst fourth = delta;\n';
      const newContents = oldContents.replace('alpha', 'ALPHA');
      await withEditor(
        diffStyle,
        (editor, container) => {
          // Adds a line above the annotated line and removes one below it, so
          // the line count stays the same but the annotated line moves down.
          editor.applyEdits([
            {
              range: {
                start: { line: 0, character: 0 },
                end: { line: 0, character: 0 },
              },
              newText: 'const extra = added;\n',
            },
            {
              range: {
                start: { line: 2, character: 0 },
                end: { line: 3, character: 0 },
              },
              newText: '',
            },
          ]);
          const content = container.shadowRoot?.querySelector(
            '[data-code]:not([data-deletions]) [data-content]'
          );
          const annotations = content?.querySelectorAll(
            '[data-line-annotation]'
          );
          expect(annotations?.length).toBe(1);
          // The annotation is drawn under the row of the line it belongs to.
          expect(
            annotations?.[0].previousElementSibling?.getAttribute('data-line')
          ).toBe('3');
        },
        {
          oldContents,
          newContents,
          lineAnnotations: [{ side: 'additions', lineNumber: 2 }],
        }
      );
    });

    test(`${diffStyle}: annotation rows rebuilt by an edit are paired for resizing again`, async () => {
      if (diffStyle !== 'split') return;
      const oldContents = 'alpha\nold\ncharlie\n';
      const newContents = 'alpha\nnew\ncharlie\n';
      await withEditor(
        diffStyle,
        (editor, container) => {
          const pairedRows = () =>
            Array.from(
              container.shadowRoot?.querySelectorAll<HTMLElement>(
                '[data-line-annotation*=","]'
              ) ?? []
            );
          const before = pairedRows();
          expect(before).toHaveLength(2);
          const beforeChildren = before.map((row) => row.firstElementChild);
          // The annotation content measures 160px from now on; the initial
          // setup measured it before this.
          const { prototype } =
            container.ownerDocument.defaultView!.HTMLElement;
          const getBoundingClientRect = prototype.getBoundingClientRect;
          prototype.getBoundingClientRect = function (
            this: HTMLElement
          ): DOMRect {
            const rect = getBoundingClientRect.call(this);
            if (
              this.parentElement?.hasAttribute('data-line-annotation') !== true
            ) {
              return rect;
            }
            const tall: DOMRect = {
              x: rect.x,
              y: rect.y,
              width: rect.width,
              height: 160,
              top: rect.top,
              right: rect.right,
              bottom: rect.top + 160,
              left: rect.left,
              toJSON() {
                return tall;
              },
            };
            return tall;
          };
          try {
            // Reverting the annotated line to the old text makes it context,
            // which rewrites its annotation row in both columns.
            replaceText(editor, 1, 0, 3, 'old');
          } finally {
            prototype.getBoundingClientRect = getBoundingClientRect;
          }
          const after = pairedRows();
          expect(after).toHaveLength(2);
          for (const [index, row] of after.entries()) {
            expect(row.firstElementChild).not.toBe(beforeChildren[index]);
            // The resize manager measured the rewritten annotation content.
            expect(
              row.style.getPropertyValue('--diffs-annotation-min-height')
            ).toBe('160px');
          }
        },
        {
          oldContents,
          newContents,
          lineAnnotations: [{ side: 'additions', lineNumber: 2 }],
        }
      );
    });

    test(`${diffStyle}: keep annotations on their lines when an edit moves lines inside a change`, async () => {
      const oldContents =
        'const a = 1;\nconst b = 2;\nconst c = 3;\nconst d = 4;\n';
      const newContents =
        'const A = 9;\nconst B = 8;\nconst C = 7;\nconst D = 6;\n';
      await withEditor(
        diffStyle,
        (editor, container, fileDiff) => {
          // Adds a line at the top and removes the third line. Every line is
          // still a change, so the change block keeps its size.
          editor.applyEdits([
            {
              range: {
                start: { line: 0, character: 0 },
                end: { line: 0, character: 0 },
              },
              newText: 'const extra = 5;\n',
            },
            {
              range: {
                start: { line: 2, character: 0 },
                end: { line: 3, character: 0 },
              },
              newText: '',
            },
          ]);
          const annotations = getAnnotationRows(container);
          expect(annotations.length).toBeGreaterThan(0);
          fileDiff.rerender();
          expect(annotations).toEqual(getAnnotationRows(container));
        },
        {
          oldContents,
          newContents,
          lineAnnotations: [
            { side: 'additions', lineNumber: 2 },
            { side: 'deletions', lineNumber: 2 },
          ],
        }
      );
    });

    test(`${diffStyle}: show context rows right away when a change is reverted`, async () => {
      await withEditor(diffStyle, (editor, container) => {
        replaceText(editor, 0, 23, 24, '2');
        // The session keeps the reverted lines on screen, as context.
        const layout = getRowLayout(container);
        expect(layout.length).toBeGreaterThan(0);
        expect(layout.every((row) => row.startsWith('context:'))).toBe(true);
        expect(getHighlights(container)).toEqual([]);
      });
    });
  }

  for (const diffStyle of ['split', 'unified'] as const) {
    test(`${diffStyle}: follow several edits made before the next full render`, async () => {
      await withEditor(diffStyle, async (editor, container) => {
        replaceText(editor, 0, 20, 21, '9');
        replaceText(editor, 0, 23, 24, '8');
        expect(getHighlights(container)).toEqual(
          await getReadOnlyHighlights(
            diffStyle,
            NEW.replace('alpha(1, 3)', 'alpha(9, 8)')
          )
        );
      });
    });

    test(`${diffStyle}: go away when a change is edited back to the original`, async () => {
      await withEditor(diffStyle, (editor, container) => {
        replaceText(editor, 0, 23, 24, '2');
        expect(getHighlights(container)).toEqual([]);
      });
    });
  }

  test('split: appear on both sides when a context line becomes a change', async () => {
    await withEditor('split', async (editor, container) => {
      replaceText(editor, 1, 15, 19, 'gamma');
      const highlights = getHighlights(container);
      expect(highlights.some((row) => row.includes('gamma'))).toBe(true);
      expect(highlights).toEqual(
        await getReadOnlyHighlights('split', NEW.replace('beta', 'gamma'))
      );
    });
  });
});

describe('word diff highlights after the editor redraws rows in the background', () => {
  // Switches the page to dark. The editor follows the page's color scheme, so
  // it recolors every line in the background.
  function flipColorScheme(): void {
    document.body.style.colorScheme = 'dark';
    // The editor re-reads the color scheme when the page's attributes change.
    document.body.dataset.theme = 'dark';
  }

  // A long diff where every third line changed, so the editor's background
  // tokenizing redraws it in several batches.
  const LONG_OLD = Array.from(
    { length: 48 },
    (_, i) => `const value${i} = compute(${i});`
  ).join('\n');
  const LONG_NEW = Array.from({ length: 48 }, (_, i) =>
    i % 3 === 0
      ? `const value${i} = compute(${i + 100});`
      : `const value${i} = compute(${i});`
  ).join('\n');

  // Uses Highlights and a finite render range, so the editor redraws rows
  // itself after background tokenizing. Runs `run`, then cleans up.
  async function withHighlights(
    diffStyle: DiffStyle,
    diff: { oldContents: string; newContents: string } | FileDiffMetadata,
    run: (context: {
      container: HTMLElement;
      fileDiff: FileDiff<undefined>;
      // Runs `start`, then waits until the background redraws it caused have
      // finished. Returns how many there were.
      waitForRedraws: (start: () => void) => Promise<number>;
      // Attaches `editor` and waits until it can be edited.
      attach: (editor: Editor<'file-diff', undefined>) => Promise<void>;
    }) => Promise<void>
  ): Promise<void> {
    // The shared highlighter keeps whichever backend loaded first.
    await disposeHighlighter();
    const dom = installDom();
    // The page starts light; flipColorScheme switches it to dark.
    document.body.style.colorScheme = 'light';
    const container = document.createElement('div');
    document.body.appendChild(container);
    const fileDiff = new FileDiff<undefined>({
      disableFileHeader: true,
      diffStyle,
      preferredHighlighter: 'highlights',
    });
    let redrawCount = 0;
    const applyTokens = fileDiff.applyTokens.bind(fileDiff);
    fileDiff.applyTokens = (lines) => {
      // Background tokenizing hands finished lines to the diff.
      redrawCount++;
      applyTokens(lines);
    };
    try {
      const renderRange: RenderRange = {
        startingLine: 0,
        totalLines: 100,
        bufferBefore: 0,
        bufferAfter: 0,
      };
      fileDiff.render(
        'hunks' in diff
          ? {
              fileDiff: diff,
              fileContainer: container,
              forceRender: true,
              renderRange,
            }
          : {
              oldFile: { name: 'edit.ts', contents: diff.oldContents },
              newFile: { name: 'edit.ts', contents: diff.newContents },
              fileContainer: container,
              forceRender: true,
              renderRange,
            }
      );
      await waitFor(() => hasHighlights(container));
      expect(getHighlighterType()).toBe('highlights');
      await run({
        container,
        fileDiff,
        async attach(editor) {
          editor.edit(fileDiff);
          await waitForEditable(container);
        },
        async waitForRedraws(start) {
          const countBefore = redrawCount;
          start();
          await waitFor(() => redrawCount > countBefore);
          let settledCount = -1;
          while (settledCount !== redrawCount) {
            settledCount = redrawCount;
            await wait(50);
          }
          const redraws = redrawCount - countBefore;
          expect(redraws).toBeGreaterThan(0);
          return redraws;
        },
      });
    } finally {
      await wait(10);
      fileDiff.cleanUp();
      dom.cleanup();
    }
  }

  for (const diffStyle of ['split', 'unified'] as const) {
    test(`${diffStyle}: stay on rows redrawn after the color scheme changes`, async () => {
      await withHighlights(
        diffStyle,
        { oldContents: OLD, newContents: NEW },
        async ({ container, attach, waitForRedraws }) => {
          const before = getHighlights(container);
          expect(before.length).toBeGreaterThan(0);
          const editor = new Editor('file-diff');
          try {
            await attach(editor);
            await waitForRedraws(flipColorScheme);
            expect(getHighlights(container)).toEqual(before);
          } finally {
            editor.cleanUp();
          }
        }
      );
    });

    test(`${diffStyle}: stay on rows redrawn in several batches`, async () => {
      await withHighlights(
        diffStyle,
        { oldContents: LONG_OLD, newContents: LONG_NEW },
        async ({ container, attach, waitForRedraws }) => {
          const before = getHighlights(container);
          expect(before.length).toBe(32);
          const editor = new Editor('file-diff');
          try {
            await attach(editor);
            const redraws = await waitForRedraws(flipColorScheme);
            expect(redraws).toBeGreaterThan(1);
            expect(getHighlights(container)).toEqual(before);
          } finally {
            editor.cleanUp();
          }
        }
      );
    });

    test(`${diffStyle}: follow an edit made after rows were redrawn`, async () => {
      await withHighlights(
        diffStyle,
        { oldContents: OLD, newContents: NEW },
        async ({ container, attach, waitForRedraws }) => {
          const editor = new Editor('file-diff');
          try {
            await attach(editor);
            await waitForRedraws(flipColorScheme);
            replaceText(editor, 0, 20, 21, '9');
            expect(getHighlights(container)).toEqual(
              await getReadOnlyHighlights(
                diffStyle,
                NEW.replace('alpha(1, 3)', 'alpha(9, 3)')
              )
            );
          } finally {
            editor.cleanUp();
          }
        }
      );
    });

    // A patch can contain hunks with no lines on a side. They must not hide
    // the lines of the hunks around them.
    for (const { name, emptyHunk, line, highlight } of [
      {
        name: 'after an empty hunk',
        emptyHunk: '@@ -4,0 +4,0 @@\n',
        line: 8,
        highlight: '11-12 2',
      },
      {
        name: 'before an empty hunk that starts at the same line',
        emptyHunk: '@@ -1,0 +1,0 @@\n',
        line: 1,
        highlight: '11-12 2',
      },
      {
        name: 'before a deletion-only hunk',
        emptyHunk: '@@ -2 +1,0 @@\n-const x1 = 1;\n',
        line: 1,
        highlight: '11-12 2',
      },
    ]) {
      test(`${diffStyle}: work on lines ${name}`, async () => {
        const oldContents = Array.from(
          { length: 10 },
          (_, i) => `const x${i} = 1;\n`
        ).join('');
        let newContents = oldContents
          .replace('x0 = 1', 'x0 = 2')
          .replace('x7 = 1', 'x7 = 2');
        if (emptyHunk.includes('-const x1')) {
          newContents = newContents.replace('const x1 = 1;\n', '');
        }
        const lastHunk = emptyHunk.includes('-const x1')
          ? '@@ -8 +7 @@\n-const x7 = 1;\n+const x7 = 2;\n'
          : '@@ -8 +8 @@\n-const x7 = 1;\n+const x7 = 2;\n';
        const diff = processFile(
          '--- a/edit.ts\n+++ b/edit.ts\n' +
            '@@ -1 +1 @@\n-const x0 = 1;\n+const x0 = 2;\n' +
            emptyHunk +
            lastHunk,
          {
            oldFile: { name: 'edit.ts', contents: oldContents },
            newFile: { name: 'edit.ts', contents: newContents },
            throwOnError: true,
          }
        );
        if (diff == null) throw new Error('expected the patch to parse');
        await withHighlights(
          diffStyle,
          diff,
          async ({ container, attach, waitForRedraws }) => {
            const lineHighlight = () =>
              getHighlights(container).find((row) =>
                row.startsWith(`additions:${line}:`)
              );
            expect(lineHighlight()).toBe(`additions:${line}:${highlight}`);
            const editor = new Editor('file-diff');
            try {
              await attach(editor);
              await waitForRedraws(flipColorScheme);
              expect(lineHighlight()).toBe(`additions:${line}:${highlight}`);
              replaceText(editor, line - 1, 11, 12, '3');
              expect(lineHighlight()).toBe(`additions:${line}:11-12 3`);
            } finally {
              editor.cleanUp();
            }
          }
        );
      });
    }
  }
});
