import { afterAll, describe, expect, test } from 'bun:test';

import { FileDiff } from '../src/components/FileDiff';
import { Editor } from '../src/editor/editor';
import { getHighlighterType } from '../src/highlighter/highlighterType';
import { disposeHighlighter } from '../src/highlighter/shared_highlighter';
import type { FileDiffMetadata, RenderRange } from '../src/types';
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
      const marks = [...row.querySelectorAll('[data-diff-span]')].map(
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
  oldContents = OLD
): Promise<string[]> {
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
    });
    await waitFor(() => hasHighlights(container));
    return getHighlights(container);
  } finally {
    fileDiff.cleanUp();
    container.remove();
  }
}

// Renders the diff with an editor attached, runs `run`, then cleans up.
async function withEditor(
  diffStyle: DiffStyle,
  run: (
    editor: Editor<'file-diff', undefined>,
    container: HTMLElement
  ) => void | Promise<void>,
  {
    renderRange,
    oldContents = OLD,
    newContents = NEW,
  }: {
    renderRange?: RenderRange;
    oldContents?: string;
    newContents?: string;
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
    });
    editor.edit(fileDiff);
    await waitForEditable(container);
    await waitFor(() => hasHighlights(container));
    expect(hasHighlights(container)).toBe(true);
    await run(editor, container);
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

  test('unified: reach a row the edit pushes past the end of the render window', async () => {
    // Making line 2 a change adds its old line above it, so line 2 moves
    // from the window's last row to just past it while still on screen.
    await withEditor(
      'unified',
      async (editor, container) => {
        replaceText(editor, 1, 15, 19, 'gamma');
        const expected = await getReadOnlyHighlights(
          'unified',
          NEW.replace('beta', 'gamma')
        );
        const editedRow = expected.find((row) =>
          row.startsWith('additions:2:')
        );
        if (editedRow == null) {
          throw new Error('expected the edited row to have highlights');
        }
        expect(getHighlights(container)).toContain(editedRow);
      },
      { renderRange: WINDOW }
    );
  });

  test('unified: reach a row that moves further when change blocks merge', async () => {
    // Editing the context line between two changes merges both blocks, which
    // moves line 2 two rows down.
    const oldContents =
      'const first = alpha(1, 2);\nconst second = beta;\nconst third = omega(3);\n';
    const newContents =
      'const first = alpha(1, 3);\nconst second = beta;\nconst third = omega(4);\n';
    await withEditor(
      'unified',
      async (editor, container) => {
        replaceText(editor, 1, 15, 19, 'gamma');
        const expected = await getReadOnlyHighlights(
          'unified',
          newContents.replace('beta', 'gamma'),
          oldContents
        );
        const editedRow = expected.find((row) =>
          row.startsWith('additions:2:')
        );
        if (editedRow == null) {
          throw new Error('expected the edited row to have highlights');
        }
        expect(getHighlights(container)).toContain(editedRow);
      },
      { renderRange: WINDOW, oldContents, newContents }
    );
  });

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
    const updateRenderCache = fileDiff.updateRenderCache.bind(fileDiff);
    fileDiff.updateRenderCache = (lines, themeType, options) => {
      updateRenderCache(lines, themeType, options);
      // Background tokenizing updates the cache without edit options.
      if (options == null) redrawCount++;
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
