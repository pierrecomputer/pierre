import { afterAll, describe, expect, mock, test } from 'bun:test';

import { File } from '../src/components/File';
import { DEFAULT_THEMES } from '../src/constants';
import { Editor, type EditorOptions } from '../src/editor/editor';
import { disposeHighlighter } from '../src/highlighter/shared_highlighter';
import type { EditorCaret, FileContents } from '../src/types';
import { installDom, wait } from './domHarness';

afterAll(async () => {
  await disposeHighlighter();
});

interface CaretMetadata {
  id: string;
}

async function waitForEditableContent(
  container: HTMLElement
): Promise<HTMLElement> {
  for (let attempt = 0; attempt < 20; attempt++) {
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

async function createEditorFixture(
  contents: string,
  options: EditorOptions<undefined, CaretMetadata>
): Promise<{
  cleanup(): void;
  content: HTMLElement;
  editor: Editor<undefined, CaretMetadata>;
  fileContainer: HTMLElement;
}> {
  const dom = installDom();
  const fileContainer = document.createElement('div');
  document.body.appendChild(fileContainer);
  const file = new File<undefined>({
    disableFileHeader: true,
    theme: DEFAULT_THEMES,
  });
  const editor = new Editor<undefined, CaretMetadata>('file', options);
  const initialFile: FileContents = {
    name: 'carets.ts',
    contents,
  };

  file.render({ file: initialFile, fileContainer, forceRender: true });
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

function caretElement(id: string): HTMLElement {
  const element = document.createElement('span');
  element.dataset.peer = id;
  element.textContent = id;
  return element;
}

function getCaretAnchor(fileContainer: HTMLElement, id: string): HTMLElement {
  const rendered = fileContainer.shadowRoot?.querySelector<HTMLElement>(
    `[data-peer="${id}"]`
  );
  const anchor = rendered?.parentElement;
  if (anchor?.dataset.remoteCaret === undefined) {
    throw new Error(`caret ${id} was not rendered`);
  }
  return anchor;
}

function getCaretTransform(element: HTMLElement): {
  x: number;
  y: number;
} {
  const match = /translateX\(([-\d.]+)px\) translateY\(([-\d.]+)px\)/.exec(
    element.style.transform
  );
  if (match === null) {
    throw new Error(`invalid caret transform: ${element.style.transform}`);
  }
  return { x: Number(match[1]), y: Number(match[2]) };
}

describe('Editor carets', () => {
  test('normalizes positions and mounts the custom renderer inside an anchor', async () => {
    const renderCaret = mock((caret: EditorCaret<CaretMetadata>) =>
      caretElement(caret.metadata.id)
    );
    const { cleanup, editor, fileContainer } = await createEditorFixture(
      'alpha\nbravo',
      { renderCaret }
    );
    const metadata = { id: 'ada' };
    const input: EditorCaret<CaretMetadata> = {
      position: { line: 99, character: 99 },
      metadata,
    };

    try {
      editor.setCarets([input]);

      const anchor = fileContainer.shadowRoot?.querySelector<HTMLElement>(
        '[data-remote-caret]'
      );
      expect(anchor).not.toBeNull();
      expect(anchor?.firstElementChild).toBe(
        fileContainer.shadowRoot?.querySelector('[data-peer="ada"]')
      );
      expect(anchor?.style.transform).toMatch(
        /^translateX\([\d.-]+px\) translateY\([\d.-]+px\)$/
      );
      expect(renderCaret).toHaveBeenCalledTimes(1);
      expect(renderCaret.mock.calls[0]?.[0]).toEqual({
        position: { line: 1, character: 5 },
        metadata,
      });
      expect(input.position).toEqual({ line: 99, character: 99 });
    } finally {
      cleanup();
    }
  });

  test('renders a caret highlight across every covered line and remaps it through edits', async () => {
    const { cleanup, editor, fileContainer } = await createEditorFixture(
      'alpha\nbravo',
      { renderCaret: (caret) => caretElement(caret.metadata.id) }
    );

    try {
      editor.setCarets([
        {
          position: { line: 1, character: 3 },
          highlight: {
            start: { line: 0, character: 2 },
            end: { line: 1, character: 3 },
          },
          metadata: { id: 'ada' },
        },
      ]);
      expect(
        fileContainer.shadowRoot?.querySelectorAll(
          '[data-caret-highlight-range]'
        )
      ).toHaveLength(2);

      editor.applyEdits([
        {
          range: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 0 },
          },
          newText: 'XY',
        },
      ]);
      expect(
        fileContainer.shadowRoot?.querySelectorAll(
          '[data-caret-highlight-range]'
        )
      ).toHaveLength(2);
    } finally {
      cleanup();
    }
  });

  test('keeps overlapping highlights separately tinted and rounded', async () => {
    const { cleanup, editor, fileContainer } = await createEditorFixture(
      'alpha',
      { renderCaret: (caret) => caretElement(caret.metadata.id) }
    );

    try {
      editor.setCarets([
        {
          position: { line: 0, character: 5 },
          highlight: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 5 },
          },
          highlightColor: '#f00',
          metadata: { id: 'ada' },
        },
        {
          position: { line: 0, character: 5 },
          highlight: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 5 },
          },
          highlightColor: '#00f',
          metadata: { id: 'grace' },
        },
      ]);

      const highlights = Array.from(
        fileContainer.shadowRoot?.querySelectorAll<HTMLElement>(
          '[data-caret-highlight-range]'
        ) ?? []
      );
      expect(highlights).toHaveLength(2);
      expect(
        highlights.map((highlight) =>
          highlight.style.getPropertyValue('--diffs-caret-highlight-bg')
        )
      ).toEqual(['#f00', '#00f']);
      expect(
        highlights.every(
          (highlight) =>
            highlight.dataset.rtl !== undefined &&
            highlight.dataset.rtr !== undefined &&
            highlight.dataset.rbl !== undefined &&
            highlight.dataset.rbr !== undefined
        )
      ).toBe(true);
    } finally {
      cleanup();
    }
  });

  test('replaces and clears carets, including peers at one position', async () => {
    const renderCaret = mock((caret: EditorCaret<CaretMetadata>) =>
      caretElement(caret.metadata.id)
    );
    const { cleanup, editor, fileContainer } = await createEditorFixture(
      'alpha\nbravo',
      { renderCaret }
    );
    const position = { line: 0, character: 2 };

    try {
      editor.setCarets([
        { position, metadata: { id: 'ada' } },
        { position, metadata: { id: 'grace' } },
      ]);
      const firstAnchors = Array.from(
        fileContainer.shadowRoot?.querySelectorAll<HTMLElement>(
          '[data-remote-caret]'
        ) ?? []
      );
      expect(firstAnchors).toHaveLength(2);
      expect(
        firstAnchors.map((anchor) => anchor.firstElementChild?.textContent)
      ).toEqual(['ada', 'grace']);

      editor.setCarets([
        { position: { line: 1, character: 1 }, metadata: { id: 'linus' } },
      ]);
      expect(firstAnchors.every((anchor) => !anchor.isConnected)).toBe(true);
      expect(
        fileContainer.shadowRoot?.querySelectorAll('[data-remote-caret]')
      ).toHaveLength(1);
      expect(
        fileContainer.shadowRoot?.querySelector('[data-peer="linus"]')
      ).not.toBeNull();

      const replacement = fileContainer.shadowRoot?.querySelector<HTMLElement>(
        '[data-remote-caret]'
      );
      editor.setCarets([]);
      expect(replacement?.isConnected).toBe(false);
      expect(
        fileContainer.shadowRoot?.querySelectorAll('[data-remote-caret]')
      ).toHaveLength(0);
      expect(renderCaret).toHaveBeenCalledTimes(3);
    } finally {
      cleanup();
    }
  });

  test('reuses renderer nodes while an edit repaints geometry without a selection', async () => {
    const renderCaret = mock((caret: EditorCaret<CaretMetadata>) =>
      caretElement(caret.metadata.id)
    );
    const { cleanup, editor, fileContainer } = await createEditorFixture(
      'aa-tail',
      { renderCaret }
    );

    try {
      editor.setCarets([
        {
          position: { line: 0, character: 2 },
          metadata: { id: 'ada' },
        },
      ]);
      expect(editor.getViewState().selections).toBeUndefined();

      const anchor = fileContainer.shadowRoot?.querySelector<HTMLElement>(
        '[data-remote-caret]'
      );
      const rendered = anchor?.firstElementChild;
      const xBefore = Number(
        /translateX\(([-\d.]+)px\)/.exec(anchor?.style.transform ?? '')?.[1]
      );

      editor.applyEdits([
        {
          range: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 1 },
          },
          newText: '\t',
        },
      ]);

      const repainted = fileContainer.shadowRoot?.querySelector<HTMLElement>(
        '[data-remote-caret]'
      );
      const xAfter = Number(
        /translateX\(([-\d.]+)px\)/.exec(repainted?.style.transform ?? '')?.[1]
      );
      expect(Number.isFinite(xBefore)).toBe(true);
      expect(xAfter).toBeGreaterThan(xBefore);
      expect(repainted).toBe(anchor);
      expect(repainted?.firstElementChild).toBe(rendered);
      expect(renderCaret).toHaveBeenCalledTimes(1);
      expect(renderCaret.mock.calls[0]?.[0].position).toEqual({
        line: 0,
        character: 2,
      });
      expect(editor.getViewState().selections).toBeUndefined();
    } finally {
      cleanup();
    }
  });

  test('moves a caret when real typing inserts text before it', async () => {
    const renderCaret = mock((caret: EditorCaret<CaretMetadata>) =>
      caretElement(caret.metadata.id)
    );
    const { cleanup, content, editor, fileContainer } =
      await createEditorFixture('abcdef', { renderCaret });

    try {
      editor.setCarets([
        {
          position: { line: 0, character: 4 },
          metadata: { id: 'ada' },
        },
      ]);
      const before = getCaretTransform(getCaretAnchor(fileContainer, 'ada'));
      editor.setSelections([
        {
          start: { line: 0, character: 1 },
          end: { line: 0, character: 1 },
          direction: 'none',
        },
      ]);

      const view = content.ownerDocument.defaultView;
      if (view === null) {
        throw new Error('editor content has no window');
      }
      const event = new view.InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        composed: true,
        data: 'XY',
        inputType: 'insertText',
      });
      content.dispatchEvent(event);

      expect(event.defaultPrevented).toBe(true);
      expect(editor.getText()).toBe('aXYbcdef');
      const after = getCaretTransform(getCaretAnchor(fileContainer, 'ada'));
      expect(after.x - before.x).toBe(16);
      expect(after.y).toBe(before.y);
    } finally {
      cleanup();
    }
  });

  test('maps a batched applyEdits insertion before and exactly at the caret', async () => {
    const renderCaret = mock((caret: EditorCaret<CaretMetadata>) =>
      caretElement(caret.metadata.id)
    );
    const { cleanup, editor, fileContainer } = await createEditorFixture(
      'abcdefghij',
      { renderCaret }
    );

    try {
      editor.setCarets([
        {
          position: { line: 0, character: 5 },
          metadata: { id: 'ada' },
        },
      ]);
      const before = getCaretTransform(getCaretAnchor(fileContainer, 'ada'));

      // Input order is deliberately not document order. Both the insertion
      // before the point and the insertion exactly at it have right gravity.
      editor.applyEdits([
        {
          range: {
            start: { line: 0, character: 5 },
            end: { line: 0, character: 5 },
          },
          newText: '!',
        },
        {
          range: {
            start: { line: 0, character: 1 },
            end: { line: 0, character: 1 },
          },
          newText: 'XX',
        },
        {
          range: {
            start: { line: 0, character: 3 },
            end: { line: 0, character: 4 },
          },
          newText: '',
        },
      ]);

      expect(editor.getText()).toBe('aXXbce!fghij');
      const after = getCaretTransform(getCaretAnchor(fileContainer, 'ada'));
      // Original character 5 + 2 inserted - 1 deleted + 1 inserted at point.
      expect(after.x - before.x).toBe(16);
      expect(after.y).toBe(before.y);
    } finally {
      cleanup();
    }
  });

  test('maps carets through deletion and replacement ranges', async () => {
    for (const { expectedAfterDelta, expectedInsideDelta, newText } of [
      { expectedAfterDelta: -24, expectedInsideDelta: -8, newText: '' },
      { expectedAfterDelta: 8, expectedInsideDelta: 24, newText: 'WXYZ' },
    ]) {
      const renderCaret = mock((caret: EditorCaret<CaretMetadata>) =>
        caretElement(caret.metadata.id)
      );
      const { cleanup, editor, fileContainer } = await createEditorFixture(
        'abcdefgh',
        { renderCaret }
      );

      try {
        editor.setCarets([
          {
            position: { line: 0, character: 3 },
            metadata: { id: 'inside' },
          },
          {
            position: { line: 0, character: 7 },
            metadata: { id: 'after' },
          },
        ]);
        const insideBefore = getCaretTransform(
          getCaretAnchor(fileContainer, 'inside')
        );
        const afterBefore = getCaretTransform(
          getCaretAnchor(fileContainer, 'after')
        );

        editor.applyEdits([
          {
            range: {
              start: { line: 0, character: 2 },
              end: { line: 0, character: 5 },
            },
            newText,
          },
        ]);

        const insideAfter = getCaretTransform(
          getCaretAnchor(fileContainer, 'inside')
        );
        const afterAfter = getCaretTransform(
          getCaretAnchor(fileContainer, 'after')
        );
        expect(insideAfter.x - insideBefore.x).toBe(expectedInsideDelta);
        expect(afterAfter.x - afterBefore.x).toBe(expectedAfterDelta);
      } finally {
        cleanup();
      }
    }
  });

  test('tracks multiline edits through undo and redo', async () => {
    let renderedCaret: EditorCaret<CaretMetadata> | undefined;
    const renderCaret = mock((caret: EditorCaret<CaretMetadata>) => {
      renderedCaret = caret;
      return caretElement(caret.metadata.id);
    });
    const { cleanup, editor } = await createEditorFixture(
      'zero\none\ntwo\nthree',
      { renderCaret }
    );

    try {
      editor.setCarets([
        {
          position: { line: 2, character: 2 },
          metadata: { id: 'ada' },
        },
      ]);
      expect(renderedCaret?.position).toEqual({
        line: 2,
        character: 2,
      });

      editor.applyEdits([
        {
          range: {
            start: { line: 1, character: 0 },
            end: { line: 1, character: 0 },
          },
          newText: 'new-a\nnew-b\n',
        },
      ]);
      expect(renderedCaret?.position).toEqual({
        line: 4,
        character: 2,
      });

      editor.undo();
      expect(renderedCaret?.position).toEqual({
        line: 2,
        character: 2,
      });
      editor.redo();
      expect(renderedCaret?.position).toEqual({
        line: 4,
        character: 2,
      });

      editor.applyEdits([
        {
          range: {
            start: { line: 1, character: 0 },
            end: { line: 3, character: 0 },
          },
          newText: '',
        },
      ]);
      expect(editor.getText()).toBe('zero\none\ntwo\nthree');
      expect(renderedCaret?.position).toEqual({
        line: 2,
        character: 2,
      });
    } finally {
      cleanup();
    }
  });

  test('does not remap carets replaced synchronously by onChange', async () => {
    const editorRef: {
      current?: Editor<undefined, CaretMetadata>;
    } = {};
    const renderCaret = mock((caret: EditorCaret<CaretMetadata>) =>
      caretElement(caret.metadata.id)
    );
    const onChange = mock(() => {
      editorRef.current?.setCarets([
        {
          // onChange receives the post-edit document, so this is already the
          // final coordinate and must not be mapped through the edit again.
          position: { line: 0, character: 1 },
          metadata: { id: 'fresh' },
        },
      ]);
    });
    const { cleanup, editor, fileContainer } = await createEditorFixture(
      'abcdef',
      { onChange, renderCaret }
    );
    editorRef.current = editor;

    try {
      editor.setCarets([
        {
          position: { line: 0, character: 1 },
          metadata: { id: 'stale' },
        },
      ]);
      const expected = getCaretTransform(
        getCaretAnchor(fileContainer, 'stale')
      );

      editor.applyEdits([
        {
          range: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 0 },
          },
          newText: 'XX',
        },
      ]);

      expect(onChange).toHaveBeenCalledTimes(1);
      expect(
        fileContainer.shadowRoot?.querySelector('[data-peer="stale"]')
      ).toBe(null);
      expect(getCaretTransform(getCaretAnchor(fileContainer, 'fresh'))).toEqual(
        expected
      );
    } finally {
      cleanup();
    }
  });

  test('clears carets when an edit session is recycled', async () => {
    const dom = installDom();
    const renderCaret = mock((caret: EditorCaret<CaretMetadata>) =>
      caretElement(caret.metadata.id)
    );
    const editor = new Editor<undefined, CaretMetadata>('file', {
      renderCaret,
    });
    const fileContents: FileContents = {
      name: 'carets.ts',
      contents: 'alpha\nbravo',
    };
    const files: File<undefined>[] = [];

    const attach = async (): Promise<HTMLElement> => {
      const fileContainer = document.createElement('div');
      document.body.appendChild(fileContainer);
      const file = new File<undefined>({
        disableFileHeader: true,
        theme: DEFAULT_THEMES,
      });
      files.push(file);
      file.render({ file: fileContents, fileContainer, forceRender: true });
      editor.edit(file);
      await waitForEditableContent(fileContainer);
      return fileContainer;
    };

    try {
      const first = await attach();
      editor.setCarets([
        {
          position: { line: 1, character: 2 },
          metadata: { id: 'ada' },
        },
      ]);
      expect(
        first.shadowRoot?.querySelector('[data-peer="ada"]')
      ).not.toBeNull();

      editor.cleanUp('recycle');
      files[0].cleanUp();
      const second = await attach();
      expect(second.shadowRoot?.querySelector('[data-peer="ada"]')).toBeNull();
      expect(renderCaret).toHaveBeenCalledTimes(1);

      editor.cleanUp();
      files[1].cleanUp();
      const third = await attach();
      expect(third.shadowRoot?.querySelector('[data-remote-caret]')).toBe(null);
      expect(renderCaret).toHaveBeenCalledTimes(1);
    } finally {
      editor.cleanUp();
      for (const file of files) {
        file.cleanUp();
      }
      dom.cleanup();
    }
  });
});
