import { afterAll, describe, expect, test } from 'bun:test';

import { FileDiff } from '../src/components/FileDiff';
import { Editor } from '../src/editor/editor';
import { disposeHighlighter } from '../src/highlighter/shared_highlighter';
import type { RenderRange } from '../src/types';
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
  ) => Promise<void>,
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
    await waitFor(() => {
      const content =
        container.shadowRoot?.querySelector<HTMLElement>('[data-content]');
      return content?.contentEditable === 'true' && hasHighlights(container);
    });
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
      await withEditor(diffStyle, async (editor, container) => {
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
