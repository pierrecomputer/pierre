import { afterAll, describe, expect, test } from 'bun:test';

import { File } from '../src/components/File';
import { DEFAULT_THEMES } from '../src/constants';
import { Editor } from '../src/editor/editor';
import { disposeHighlighter } from '../src/highlighter/shared_highlighter';
import type {
  DiffsEditorSelection,
  FileContents,
  RenderRange,
} from '../src/types';
import { installDom, wait } from './domHarness';

afterAll(async () => {
  await disposeHighlighter();
});

function makeContents(lineCount: number): string {
  return Array.from({ length: lineCount }, (_, i) => `line ${i + 1}`).join(
    '\n'
  );
}

function makeRange(startingLine: number, totalLines: number): RenderRange {
  return { startingLine, totalLines, bufferBefore: 0, bufferAfter: 0 };
}

async function waitForEditableContent(
  container: HTMLElement
): Promise<HTMLElement> {
  for (let attempt = 0; attempt < 40; attempt++) {
    const content = container.shadowRoot?.querySelector('[data-content]');
    if (
      content instanceof HTMLElement &&
      (content.contentEditable === 'true' ||
        content.getAttribute('contenteditable') === 'true')
    ) {
      return content;
    }
    await wait(0);
  }
  throw new Error('editor content did not become editable');
}

// 1-indexed line numbers of the editable rows currently in the rendered window.
function renderedLineNumbers(content: HTMLElement): number[] {
  const out: number[] = [];
  for (const child of Array.from(content.children)) {
    const el = child as HTMLElement;
    const line = el.dataset.line;
    if (line !== undefined && el.dataset.lineType !== 'change-deletion') {
      out.push(parseInt(line, 10));
    }
  }
  return out.sort((a, b) => a - b);
}

function collapsedCaret(line: number): DiffsEditorSelection {
  return {
    start: { line, character: 0 },
    end: { line, character: 0 },
    direction: 'none',
  };
}

interface WindowedEditor {
  cleanup(): void;
  content: HTMLElement;
  editor: Editor<undefined>;
  fileContainer: HTMLElement;
}

// Renders a long file into a partial window so the editor virtualizes: only the
// lines inside `range` get DOM rows, mirroring a scrolled-down CodeView.
async function createWindowedEditor(
  lineCount: number,
  range: RenderRange
): Promise<WindowedEditor> {
  const dom = installDom();
  const fileContainer = document.createElement('div');
  document.body.appendChild(fileContainer);

  const file = new File<undefined>({
    disableFileHeader: true,
    theme: DEFAULT_THEMES,
  });
  const editor = new Editor<undefined>();
  const initialFile: FileContents = {
    name: 'edits.ts',
    contents: makeContents(lineCount),
  };

  file.render({
    file: initialFile,
    fileContainer,
    forceRender: true,
    renderRange: range,
  });
  editor.edit(file);

  const content = await waitForEditableContent(fileContainer);
  return {
    cleanup() {
      editor.cleanUp();
      file.cleanUp();
      dom.cleanup();
    },
    content,
    editor,
    fileContainer,
  };
}

describe('Editor edits at the bottom of a virtualized window', () => {
  // A run of Enter presses at the window's bottom edge must keep rendering each
  // new line. The editor widens its render range when the caret reaches the
  // last rendered line; if that widened range is not persisted, the next edit
  // reads a stale end line, treats the caret as past the window, and leaves the
  // just-typed line (and its caret) unrendered until a scroll re-syncs.
  test('keeps consecutive newlines at the window bottom rendered', async () => {
    const { cleanup, content, editor, fileContainer } =
      await createWindowedEditor(200, makeRange(100, 50));
    try {
      // The window renders 1-indexed lines 101..150.
      expect(renderedLineNumbers(content).at(-1)).toBe(150);

      // Enter on the last rendered line, then Enter again on the new last line.
      editor.setSelections([collapsedCaret(149)]);
      editor.applyEdits([
        {
          range: {
            start: { line: 149, character: 0 },
            end: { line: 149, character: 0 },
          },
          newText: '\n',
        },
      ]);
      await wait(0);
      editor.applyEdits([
        {
          range: {
            start: { line: 150, character: 0 },
            end: { line: 150, character: 0 },
          },
          newText: '\n',
        },
      ]);
      await wait(0);

      const selections = editor.getState().selections ?? [];
      expect(selections).toHaveLength(1);
      const caretLine = selections[0].start.line + 1;
      expect(caretLine).toBe(152);
      // The just-typed line has a rendered row...
      expect(renderedLineNumbers(content)).toContain(caretLine);
      // ...and its caret is drawn, which #renderCaret only does when
      // #isLineVisible (reading the persisted render range) returns true.
      const caretCount =
        fileContainer.shadowRoot?.querySelectorAll('[data-caret]').length ?? 0;
      expect(caretCount).toBeGreaterThan(0);
    } finally {
      cleanup();
    }
  });

  // A single programmatic edit that inserts several lines at the window bottom
  // pushes the caret well past the previous end line. Every inserted line up to
  // the caret should still get a row.
  test('renders a multi-line insert at the window bottom', async () => {
    const { cleanup, content, editor } = await createWindowedEditor(
      200,
      makeRange(100, 50)
    );
    try {
      editor.setSelections([collapsedCaret(149)]);
      editor.applyEdits([
        {
          range: {
            start: { line: 149, character: 0 },
            end: { line: 149, character: 0 },
          },
          newText: 'X\nY\nZ\n',
        },
      ]);
      await wait(0);

      const selections = editor.getState().selections ?? [];
      expect(selections).toHaveLength(1);
      const caretLine = selections[0].start.line + 1;
      expect(caretLine).toBe(153);
      expect(renderedLineNumbers(content)).toContain(caretLine);
    } finally {
      cleanup();
    }
  });

  // A single huge insert drops the caret far below the window. Widening to reach
  // it would build a DOM row per inserted line synchronously, defeating
  // virtualization. The editor caps widening at twice the synced window (here
  // 2 * 50 = 100), so the rendered row count stays bounded near the window and
  // does not scale with the insert; the far caret is left for a scroll to render.
  test('keeps a large multi-line insert from materializing unbounded rows', async () => {
    const { cleanup, content, editor } = await createWindowedEditor(
      200,
      makeRange(100, 50)
    );
    try {
      const insertedLines = 1000;
      editor.setSelections([collapsedCaret(149)]);
      editor.applyEdits([
        {
          range: {
            start: { line: 149, character: 0 },
            end: { line: 149, character: 0 },
          },
          newText: 'X\n'.repeat(insertedLines),
        },
      ]);
      await wait(0);

      // Bounded by the 2x cap (100), nowhere near the 1000 inserted lines.
      const rendered = renderedLineNumbers(content).length;
      expect(rendered).toBeLessThanOrEqual(100);
      expect(rendered).toBeLessThan(insertedLines);

      // The caret lands far below the window and is not rendered synchronously.
      const selections = editor.getState().selections ?? [];
      const caretLine = selections[0].start.line + 1;
      expect(caretLine).toBeGreaterThan(1000);
      expect(renderedLineNumbers(content)).not.toContain(caretLine);
    } finally {
      cleanup();
    }
  });

  // Consecutive programmatic inserts with no scroll between them must not let the
  // persisted render range ratchet up without bound. The cap is measured against
  // the window captured at the last sync (50), so widening saturates at 2x (100)
  // and the rendered row count stays bounded however many lines are inserted.
  test('keeps consecutive inserts from materializing unbounded rows', async () => {
    const { cleanup, content, editor } = await createWindowedEditor(
      200,
      makeRange(100, 50)
    );
    try {
      let caret = 149;
      for (let round = 0; round < 40; round++) {
        editor.setSelections([collapsedCaret(caret)]);
        editor.applyEdits([
          {
            range: {
              start: { line: caret, character: 0 },
              end: { line: caret, character: 0 },
            },
            newText: 'a\nb\nc\nd\ne\n',
          },
        ]);
        await wait(0);
        caret += 5;
      }

      // 200 lines inserted, but the window saturates at the 2x cap (100).
      const rendered = renderedLineNumbers(content).length;
      expect(rendered).toBeLessThanOrEqual(100);
    } finally {
      cleanup();
    }
  });

  // An edit whose dirty lines start below the rendered window - e.g. a caller
  // sets the selection to an offscreen line and edits there before the
  // virtualizer re-syncs - must not widen. #rerender only builds rows from
  // change.startLine, so widening would append the edited rows right after the
  // window with the intervening lines unbuilt, while #isLineVisible reports them
  // visible: a discontiguous render with the rows/caret mispositioned. The
  // window must stay bounded and contiguous; the edit renders on the next scroll.
  test('does not widen for an edit that starts below the rendered window', async () => {
    const { cleanup, content, editor } = await createWindowedEditor(
      300,
      makeRange(100, 50)
    );
    try {
      // Line 180 is offscreen (window ends at 150) yet within the 2x cap
      // (reachable to line 199), so only the start-below-window guard - not the
      // cap - keeps this edit off the widen path.
      editor.setSelections([collapsedCaret(180)]);
      editor.applyEdits([
        {
          range: {
            start: { line: 180, character: 0 },
            end: { line: 180, character: 0 },
          },
          newText: 'Z\n',
        },
      ]);
      await wait(0);

      // No row past the window's bottom edge was appended, so there is no
      // unrendered gap; the offscreen edit is left for the next scroll.
      const rendered = renderedLineNumbers(content);
      expect(Math.max(...rendered)).toBeLessThanOrEqual(150);
    } finally {
      cleanup();
    }
  });
});
