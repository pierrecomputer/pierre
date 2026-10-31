import { afterAll, describe, expect, spyOn, test } from 'bun:test';

import { CodeView } from '../src/components/CodeView';
import { File } from '../src/components/File';
import { ColumnReconciler } from '../src/dom/ColumnReconciler';
import { Editor } from '../src/editor/editor';
import { disposeHighlighter } from '../src/highlighter/shared_highlighter';
import type { CodeViewItem } from '../src/types';
import { parseDiffFromFile } from '../src/utils/parseDiffFromFile';
import {
  createRoot,
  installDom,
  renderItems,
  wait,
  waitFor,
} from './domHarness';

afterAll(async () => {
  await disposeHighlighter();
});

// Inserts `text` at a position of the editor's document.
function insertText(
  editor: Editor<'file', undefined> | Editor<'file-diff', undefined>,
  line: number,
  character: number,
  text: string
): void {
  editor.applyEdits([
    {
      range: { start: { line, character }, end: { line, character } },
      newText: text,
    },
  ]);
}

function rowTexts(container: HTMLElement): string[] {
  return Array.from(
    container.shadowRoot?.querySelectorAll('[data-content] > [data-line]') ??
      [],
    (row) => row.textContent ?? ''
  );
}

describe('a plain file renders a keystroke as a patch of the rows it changed', () => {
  const CONTENTS = 'const one = 1;\nconst two = 2;\nconst three = 3;';

  test('typing inside a line rewrites that row without laying the file out', async () => {
    const { cleanup } = installDom();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const file = new File<undefined>({
      useTokenTransformer: true,
      disableFileHeader: true,
    });
    const editor = new Editor('file');
    try {
      file.render({
        file: { name: 'a.ts', contents: CONTENTS },
        fileContainer: container,
        forceRender: true,
      });
      editor.edit(file);
      await waitFor(() => editor.getText() === CONTENTS);
      // Let the attach pass finish, then draw the tokens it delivered, so the
      // keystroke is the only difference between the two renders below.
      await wait(200);
      file.rerender();

      // The rows the render tells the column to patch, per reconcile.
      const reconcile = spyOn(ColumnReconciler.prototype, 'reconcile');
      const patchedRows = (call: number) =>
        reconcile.mock.calls[call]?.[1]?.map((spec) => spec.key);
      try {
        insertText(editor, 1, 12, '9');
        // One write, patching the changed line's row and the rows the
        // tokenizer recolored after it.
        expect(reconcile).toHaveBeenCalledTimes(1);
        expect(patchedRows(0)).toContain('a1');
        expect(rowTexts(container)[1]).toBe('const two = 92;');
        // The patched DOM is what a full render produces.
        const patched = container.shadowRoot?.innerHTML;
        file.rerender();
        expect(patchedRows(1)).toBeUndefined();
        expect(container.shadowRoot?.innerHTML).toBe(patched);

        // A line-count change lays the file out again.
        insertText(editor, 1, 0, 'x\n');
        expect(patchedRows(2)).toBeUndefined();
        expect(rowTexts(container)).toHaveLength(4);
      } finally {
        reconcile.mockRestore();
      }
    } finally {
      editor.cleanUp();
      file.cleanUp();
      cleanup();
    }
  });
});

describe('a CodeView item renders a keystroke as a patch in its frame', () => {
  function makeEditDiffItem(id: string): CodeViewItem<undefined> {
    return {
      id,
      type: 'diff',
      fileDiff: parseDiffFromFile(
        { name: `${id}.txt`, contents: 'one\ntwo\nthree\n' },
        { name: `${id}.txt`, contents: 'one\ntwo changed\nthree\n' }
      ),
      version: 0,
      edit: true,
    };
  }

  test('typing inside a change rewrites its rows in the next frame', async () => {
    const { cleanup } = installDom();
    const viewer = new CodeView({
      createEditor: (type, options, key) => new Editor(type, options, key),
    });
    const root = createRoot();
    try {
      viewer.setup(root);
      await renderItems(viewer, [makeEditDiffItem('target')]);
      await waitFor(() => viewer.getEditor('target') != null);
      await wait(50);
      const editor = viewer.getEditor('target');
      if (editor == null) throw new Error('Expected target editor');
      const element = viewer.getRenderedItems()[0]?.element;
      if (element == null) throw new Error('Expected a rendered item');

      // Whether the writes since `from` patched by key or walked.
      const reconcile = spyOn(ColumnReconciler.prototype, 'reconcile');
      const patchedSince = (from: number) => {
        const hints = reconcile.mock.calls.slice(from).map(([, hint]) => hint);
        expect(hints.length).toBeGreaterThan(0);
        return hints.every((hint) => hint != null);
      };
      try {
        insertText(editor, 1, 11, 'x');
        // Nothing is written until the host's frame.
        expect(reconcile).not.toHaveBeenCalled();
        await wait(0);
        expect(patchedSince(0)).toBe(true);
        expect(rowTexts(element)).toContain('two changedx');

        // A line-count change lays the diff out again.
        const written = reconcile.mock.calls.length;
        insertText(editor, 1, 0, 'x\n');
        await wait(0);
        expect(patchedSince(written)).toBe(false);
        expect(rowTexts(element)).toContain('x');
      } finally {
        reconcile.mockRestore();
      }
    } finally {
      viewer.cleanUp();
      cleanup();
    }
  });
});

describe('the gutter utility survives rows being renumbered', () => {
  function gutterCell(container: HTMLElement, lineNumber: number) {
    return container.shadowRoot?.querySelector<HTMLElement>(
      `[data-gutter] > [data-column-number="${lineNumber}"]`
    );
  }

  test('deleting a line above the hovered line keeps the utility in its gutter', async () => {
    const { cleanup } = installDom();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const file = new File<undefined>({
      useTokenTransformer: true,
      disableFileHeader: true,
      enableGutterUtility: true,
    });
    const editor = new Editor('file');
    try {
      file.render({
        file: { name: 'a.ts', contents: 'one\ntwo\nthree' },
        fileContainer: container,
        forceRender: true,
      });
      editor.edit(file);
      await waitFor(() => editor.getText() === 'one\ntwo\nthree');
      await wait(200);
      file.rerender();

      // Hovering a gutter row shows the utility inside that row.
      const third = gutterCell(container, 3);
      if (third == null) throw new Error('Expected the third gutter cell');
      third.dispatchEvent(
        new window.PointerEvent('pointermove', {
          bubbles: true,
          cancelable: true,
          composed: true,
          pointerType: 'mouse',
        })
      );
      expect(third.querySelector('[data-gutter-utility-slot]')).not.toBeNull();

      // Deleting the first line renumbers the hovered line to 2, rewriting
      // its gutter cell; the utility has to be put back into it.
      editor.applyEdits([
        {
          range: {
            start: { line: 0, character: 0 },
            end: { line: 1, character: 0 },
          },
          newText: '',
        },
      ]);
      const slot = container.shadowRoot?.querySelector(
        '[data-gutter-utility-slot]'
      );
      expect(slot?.isConnected).toBe(true);
      expect(
        slot
          ?.closest('[data-column-number]')
          ?.getAttribute('data-column-number')
      ).toBe('2');
    } finally {
      editor.cleanUp();
      file.cleanUp();
      cleanup();
    }
  });
});
