import { afterAll, describe, expect, mock, test } from 'bun:test';

import { File } from '../src/components/File';
import { DEFAULT_THEMES } from '../src/constants';
import { Editor, type EditorOptions } from '../src/editor/editor';
import { disposeHighlighter } from '../src/highlighter/shared_highlighter';
import type { EditorDecoration, FileContents } from '../src/types';
import { installDom, wait } from './domHarness';

afterAll(async () => {
  await disposeHighlighter();
});

interface DecorationMetadata {
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
  options: EditorOptions<undefined, DecorationMetadata>
): Promise<{
  cleanup(): void;
  content: HTMLElement;
  editor: Editor<undefined, DecorationMetadata>;
  fileContainer: HTMLElement;
}> {
  const dom = installDom();
  const fileContainer = document.createElement('div');
  document.body.appendChild(fileContainer);
  const file = new File<undefined>({
    disableFileHeader: true,
    theme: DEFAULT_THEMES,
  });
  const editor = new Editor<undefined, DecorationMetadata>(options);
  const initialFile: FileContents = {
    name: 'decorations.ts',
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

function decorationElement(id: string): HTMLElement {
  const element = document.createElement('span');
  element.dataset.peer = id;
  element.textContent = id;
  return element;
}

function getDecorationAnchor(
  fileContainer: HTMLElement,
  id: string
): HTMLElement {
  const rendered = fileContainer.shadowRoot?.querySelector<HTMLElement>(
    `[data-peer="${id}"]`
  );
  const anchor = rendered?.parentElement;
  if (anchor?.dataset.editorDecoration === undefined) {
    throw new Error(`decoration ${id} was not rendered`);
  }
  return anchor;
}

function getDecorationTransform(element: HTMLElement): {
  x: number;
  y: number;
} {
  const match = /translateX\(([-\d.]+)px\) translateY\(([-\d.]+)px\)/.exec(
    element.style.transform
  );
  if (match === null) {
    throw new Error(`invalid decoration transform: ${element.style.transform}`);
  }
  return { x: Number(match[1]), y: Number(match[2]) };
}

describe('Editor decorations', () => {
  test('normalizes positions and mounts the custom renderer inside an anchor', async () => {
    const renderDecoration = mock(
      (decoration: EditorDecoration<DecorationMetadata>) =>
        decorationElement(decoration.metadata.id)
    );
    const { cleanup, editor, fileContainer } = await createEditorFixture(
      'alpha\nbravo',
      { renderDecoration }
    );
    const metadata = { id: 'ada' };
    const input: EditorDecoration<DecorationMetadata> = {
      position: { line: 99, character: 99 },
      metadata,
    };

    try {
      editor.setDecorations([input]);

      const anchor = fileContainer.shadowRoot?.querySelector<HTMLElement>(
        '[data-editor-decoration]'
      );
      expect(anchor).not.toBeNull();
      expect(anchor?.firstElementChild).toBe(
        fileContainer.shadowRoot?.querySelector('[data-peer="ada"]')
      );
      expect(anchor?.style.transform).toMatch(
        /^translateX\([\d.-]+px\) translateY\([\d.-]+px\)$/
      );
      expect(renderDecoration).toHaveBeenCalledTimes(1);
      expect(renderDecoration.mock.calls[0]?.[0]).toEqual({
        position: { line: 1, character: 5 },
        metadata,
      });
      expect(input.position).toEqual({ line: 99, character: 99 });
    } finally {
      cleanup();
    }
  });

  test('replaces and clears decorations, including peers at one position', async () => {
    const renderDecoration = mock(
      (decoration: EditorDecoration<DecorationMetadata>) =>
        decorationElement(decoration.metadata.id)
    );
    const { cleanup, editor, fileContainer } = await createEditorFixture(
      'alpha\nbravo',
      { renderDecoration }
    );
    const position = { line: 0, character: 2 };

    try {
      editor.setDecorations([
        { position, metadata: { id: 'ada' } },
        { position, metadata: { id: 'grace' } },
      ]);
      const firstAnchors = Array.from(
        fileContainer.shadowRoot?.querySelectorAll<HTMLElement>(
          '[data-editor-decoration]'
        ) ?? []
      );
      expect(firstAnchors).toHaveLength(2);
      expect(
        firstAnchors.map((anchor) => anchor.firstElementChild?.textContent)
      ).toEqual(['ada', 'grace']);

      editor.setDecorations([
        { position: { line: 1, character: 1 }, metadata: { id: 'linus' } },
      ]);
      expect(firstAnchors.every((anchor) => !anchor.isConnected)).toBe(true);
      expect(
        fileContainer.shadowRoot?.querySelectorAll('[data-editor-decoration]')
      ).toHaveLength(1);
      expect(
        fileContainer.shadowRoot?.querySelector('[data-peer="linus"]')
      ).not.toBeNull();

      const replacement = fileContainer.shadowRoot?.querySelector<HTMLElement>(
        '[data-editor-decoration]'
      );
      editor.setDecorations([]);
      expect(replacement?.isConnected).toBe(false);
      expect(
        fileContainer.shadowRoot?.querySelectorAll('[data-editor-decoration]')
      ).toHaveLength(0);
      expect(renderDecoration).toHaveBeenCalledTimes(3);
    } finally {
      cleanup();
    }
  });

  test('reuses renderer nodes while an edit repaints geometry without a selection', async () => {
    const renderDecoration = mock(
      (decoration: EditorDecoration<DecorationMetadata>) =>
        decorationElement(decoration.metadata.id)
    );
    const { cleanup, editor, fileContainer } = await createEditorFixture(
      'aa-tail',
      { renderDecoration }
    );

    try {
      editor.setDecorations([
        {
          position: { line: 0, character: 2 },
          metadata: { id: 'ada' },
        },
      ]);
      expect(editor.getState().selections).toBeUndefined();

      const anchor = fileContainer.shadowRoot?.querySelector<HTMLElement>(
        '[data-editor-decoration]'
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
        '[data-editor-decoration]'
      );
      const xAfter = Number(
        /translateX\(([-\d.]+)px\)/.exec(repainted?.style.transform ?? '')?.[1]
      );
      expect(Number.isFinite(xBefore)).toBe(true);
      expect(xAfter).toBeGreaterThan(xBefore);
      expect(repainted).toBe(anchor);
      expect(repainted?.firstElementChild).toBe(rendered);
      expect(renderDecoration).toHaveBeenCalledTimes(1);
      expect(renderDecoration.mock.calls[0]?.[0].position).toEqual({
        line: 0,
        character: 2,
      });
      expect(editor.getState().selections).toBeUndefined();
    } finally {
      cleanup();
    }
  });

  test('moves a decoration when real typing inserts text before it', async () => {
    const renderDecoration = mock(
      (decoration: EditorDecoration<DecorationMetadata>) =>
        decorationElement(decoration.metadata.id)
    );
    const { cleanup, content, editor, fileContainer } =
      await createEditorFixture('abcdef', { renderDecoration });

    try {
      editor.setDecorations([
        {
          position: { line: 0, character: 4 },
          metadata: { id: 'ada' },
        },
      ]);
      const before = getDecorationTransform(
        getDecorationAnchor(fileContainer, 'ada')
      );
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
      const after = getDecorationTransform(
        getDecorationAnchor(fileContainer, 'ada')
      );
      expect(after.x - before.x).toBe(16);
      expect(after.y).toBe(before.y);
    } finally {
      cleanup();
    }
  });

  test('maps a batched applyEdits insertion before and exactly at the decoration', async () => {
    const renderDecoration = mock(
      (decoration: EditorDecoration<DecorationMetadata>) =>
        decorationElement(decoration.metadata.id)
    );
    const { cleanup, editor, fileContainer } = await createEditorFixture(
      'abcdefghij',
      { renderDecoration }
    );

    try {
      editor.setDecorations([
        {
          position: { line: 0, character: 5 },
          metadata: { id: 'ada' },
        },
      ]);
      const before = getDecorationTransform(
        getDecorationAnchor(fileContainer, 'ada')
      );

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
      const after = getDecorationTransform(
        getDecorationAnchor(fileContainer, 'ada')
      );
      // Original character 5 + 2 inserted - 1 deleted + 1 inserted at point.
      expect(after.x - before.x).toBe(16);
      expect(after.y).toBe(before.y);
    } finally {
      cleanup();
    }
  });

  test('maps decorations through deletion and replacement ranges', async () => {
    for (const { expectedAfterDelta, expectedInsideDelta, newText } of [
      { expectedAfterDelta: -24, expectedInsideDelta: -8, newText: '' },
      { expectedAfterDelta: 8, expectedInsideDelta: 24, newText: 'WXYZ' },
    ]) {
      const renderDecoration = mock(
        (decoration: EditorDecoration<DecorationMetadata>) =>
          decorationElement(decoration.metadata.id)
      );
      const { cleanup, editor, fileContainer } = await createEditorFixture(
        'abcdefgh',
        { renderDecoration }
      );

      try {
        editor.setDecorations([
          {
            position: { line: 0, character: 3 },
            metadata: { id: 'inside' },
          },
          {
            position: { line: 0, character: 7 },
            metadata: { id: 'after' },
          },
        ]);
        const insideBefore = getDecorationTransform(
          getDecorationAnchor(fileContainer, 'inside')
        );
        const afterBefore = getDecorationTransform(
          getDecorationAnchor(fileContainer, 'after')
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

        const insideAfter = getDecorationTransform(
          getDecorationAnchor(fileContainer, 'inside')
        );
        const afterAfter = getDecorationTransform(
          getDecorationAnchor(fileContainer, 'after')
        );
        expect(insideAfter.x - insideBefore.x).toBe(expectedInsideDelta);
        expect(afterAfter.x - afterBefore.x).toBe(expectedAfterDelta);
      } finally {
        cleanup();
      }
    }
  });

  test('tracks multiline edits through undo and redo', async () => {
    let renderedDecoration: EditorDecoration<DecorationMetadata> | undefined;
    const renderDecoration = mock(
      (decoration: EditorDecoration<DecorationMetadata>) => {
        renderedDecoration = decoration;
        return decorationElement(decoration.metadata.id);
      }
    );
    const { cleanup, editor } = await createEditorFixture(
      'zero\none\ntwo\nthree',
      { renderDecoration }
    );

    try {
      editor.setDecorations([
        {
          position: { line: 2, character: 2 },
          metadata: { id: 'ada' },
        },
      ]);
      expect(renderedDecoration?.position).toEqual({
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
      expect(renderedDecoration?.position).toEqual({
        line: 4,
        character: 2,
      });

      editor.undo();
      expect(renderedDecoration?.position).toEqual({
        line: 2,
        character: 2,
      });
      editor.redo();
      expect(renderedDecoration?.position).toEqual({
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
      expect(renderedDecoration?.position).toEqual({
        line: 2,
        character: 2,
      });
    } finally {
      cleanup();
    }
  });

  test('does not remap decorations replaced synchronously by onChange', async () => {
    const editorRef: {
      current?: Editor<undefined, DecorationMetadata>;
    } = {};
    const renderDecoration = mock(
      (decoration: EditorDecoration<DecorationMetadata>) =>
        decorationElement(decoration.metadata.id)
    );
    const onChange = mock(() => {
      editorRef.current?.setDecorations([
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
      { onChange, renderDecoration }
    );
    editorRef.current = editor;

    try {
      editor.setDecorations([
        {
          position: { line: 0, character: 1 },
          metadata: { id: 'stale' },
        },
      ]);
      const expected = getDecorationTransform(
        getDecorationAnchor(fileContainer, 'stale')
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
      expect(
        getDecorationTransform(getDecorationAnchor(fileContainer, 'fresh'))
      ).toEqual(expected);
    } finally {
      cleanup();
    }
  });

  test('keeps definitions through recycle and clears them after full cleanup', async () => {
    const dom = installDom();
    const renderDecoration = mock(
      (decoration: EditorDecoration<DecorationMetadata>) =>
        decorationElement(decoration.metadata.id)
    );
    const editor = new Editor<undefined, DecorationMetadata>({
      renderDecoration,
    });
    const fileContents: FileContents = {
      name: 'decorations.ts',
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
      editor.setDecorations([
        {
          position: { line: 1, character: 2 },
          metadata: { id: 'ada' },
        },
      ]);
      expect(
        first.shadowRoot?.querySelector('[data-peer="ada"]')
      ).not.toBeNull();

      editor.cleanUp(true);
      files[0].cleanUp();
      const second = await attach();
      expect(
        second.shadowRoot?.querySelector('[data-peer="ada"]')
      ).not.toBeNull();
      expect(renderDecoration).toHaveBeenCalledTimes(2);

      editor.cleanUp();
      files[1].cleanUp();
      const third = await attach();
      expect(third.shadowRoot?.querySelector('[data-editor-decoration]')).toBe(
        null
      );
      expect(renderDecoration).toHaveBeenCalledTimes(2);
    } finally {
      editor.cleanUp();
      for (const file of files) {
        file.cleanUp();
      }
      dom.cleanup();
    }
  });
});
