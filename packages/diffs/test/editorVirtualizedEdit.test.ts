import { afterAll, describe, expect, spyOn, test } from 'bun:test';

import { File } from '../src/components/File';
import { DEFAULT_THEMES } from '../src/constants';
import { Editor } from '../src/editor/editor';
import { PieceTable } from '../src/editor/pieceTable';
import { DirectionForward } from '../src/editor/selection';
import { disposeHighlighter } from '../src/highlighter/shared_highlighter';
import type { FileContents, RenderRange } from '../src/types';
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

type EditableSelection = Parameters<
  Editor<'file', undefined>['setSelections']
>[0][number];

function collapsedCaret(line: number): EditableSelection {
  return {
    start: { line, character: 0 },
    end: { line, character: 0 },
    direction: 'none',
  };
}

interface WindowedEditor {
  cleanup(): void;
  content: HTMLElement;
  editor: Editor<'file', undefined>;
  file: File<undefined>;
  fileContainer: HTMLElement;
  initialFile: FileContents;
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
  const editor = new Editor('file');
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
    file,
    fileContainer,
    initialFile,
  };
}

describe('Editor edits at the bottom of a virtualized window', () => {
  // The rows on screen are the render range the host gave the component. An
  // edit that adds lines past its end changes the document and moves the
  // caret, but no row is built for those lines until the host renders a
  // range that holds them.
  test('lines past the window render once the host extends the range', async () => {
    const { cleanup, content, editor, file, fileContainer, initialFile } =
      await createWindowedEditor(200, makeRange(100, 50));
    try {
      const windowLines = Array.from({ length: 50 }, (_, i) => 101 + i);
      expect(renderedLineNumbers(content)).toEqual(windowLines);

      // Enter at the start of the last rendered line pushes that line out of
      // the window and puts the caret on it.
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
      expect(editor.getText()).toContain('line 149\n\nline 150');
      expect(editor.getViewState().selections?.[0]?.start.line).toBe(150);
      expect(renderedLineNumbers(content)).toEqual(windowLines);
      expect(content.textContent).not.toContain('line 150');
      expect(
        fileContainer.shadowRoot?.querySelectorAll('[data-caret]').length ?? 0
      ).toBe(0);

      file.render({
        file: initialFile,
        fileContainer,
        renderRange: makeRange(100, 52),
      });
      await wait(0);
      expect(renderedLineNumbers(content)).toEqual([...windowLines, 151, 152]);
      expect(content.textContent).toContain('line 150');
      expect(
        fileContainer.shadowRoot?.querySelectorAll('[data-caret]').length ?? 0
      ).toBeGreaterThan(0);
    } finally {
      cleanup();
    }
  });
});

describe('Editor selections in a virtualized window', () => {
  test('limits a document-spanning selection to the rendered lines', async () => {
    const range = makeRange(4900, 7);
    const { cleanup, editor, fileContainer } = await createWindowedEditor(
      10_000,
      range
    );
    editor.setOptions({ roundedSelection: false });

    try {
      editor.setViewState({
        selections: [
          {
            start: { line: 0, character: 0 },
            end: { line: 9999, character: 10 },
            direction: DirectionForward,
          },
        ],
        view: { scrollLeft: 0 },
      });

      expect(
        fileContainer.shadowRoot?.querySelectorAll('[data-selection-range]')
      ).toHaveLength(range.totalLines);
    } finally {
      cleanup();
    }
  });
});

describe('Editor search matches in a virtualized window', () => {
  test('resolves positions only for matches in the rendered window', async () => {
    const range = makeRange(900, 7);
    const { cleanup, content, editor, fileContainer } =
      await createWindowedEditor(2000, range);
    try {
      content.dispatchEvent(
        new window.KeyboardEvent('keydown', {
          bubbles: true,
          cancelable: true,
          code: 'KeyF',
          composed: true,
          key: 'f',
          metaKey: true,
        })
      );
      await wait(0);
      const input = fileContainer.shadowRoot?.querySelector<HTMLInputElement>(
        '[data-search-panel] input[data-search]'
      );
      expect(input).not.toBeNull();
      input!.value = 'line';
      input!.dispatchEvent(new window.Event('input', { bubbles: true }));

      editor.setOptions({ matchBrackets: false });
      const positionAt = spyOn(PieceTable.prototype, 'positionAt');
      try {
        editor.setSelections([collapsedCaret(903)]);

        // There is one match per document line. A repaint resolves only both
        // endpoints of the seven rendered matches, not all 2,000 matches.
        expect(positionAt).toHaveBeenCalledTimes(range.totalLines * 2);
        expect(
          fileContainer.shadowRoot?.querySelectorAll('[data-match-range]')
            .length
        ).toBe(range.totalLines);
      } finally {
        positionAt.mockRestore();
      }
    } finally {
      cleanup();
    }
  });
});

describe('Editor virtualized line lookup', () => {
  test('does not scan the content subtree for offscreen selected lines', async () => {
    const { cleanup, content, editor } = await createWindowedEditor(
      300,
      makeRange(100, 50)
    );
    const querySelector = spyOn(content, 'querySelector');
    try {
      editor.setSelections([
        {
          start: { line: 0, character: 0 },
          end: { line: 299, character: 0 },
          direction: 'forward',
        },
      ]);

      const lineQueries = querySelector.mock.calls.filter(
        ([selector]) =>
          typeof selector === 'string' && selector.startsWith('[data-line=')
      );
      expect(lineQueries).toHaveLength(0);
    } finally {
      querySelector.mockRestore();
      cleanup();
    }
  });
});
