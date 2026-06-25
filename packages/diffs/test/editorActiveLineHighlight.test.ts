import { afterAll, describe, expect, test } from 'bun:test';

import { File, type FileOptions } from '../src/components/File';
import { DEFAULT_THEMES } from '../src/constants';
import { Editor } from '../src/editor/editor';
import { disposeHighlighter } from '../src/highlighter/shared_highlighter';
import type { FileContents, SelectedLineRange } from '../src/types';
import { installDom, wait } from './domHarness';

afterAll(async () => {
  await disposeHighlighter();
});

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

interface EditorFixture {
  cleanup(): void;
  content: HTMLElement;
  editor: Editor<undefined>;
}

async function createEditorFixture(
  contents: string,
  fileOptions?: Partial<FileOptions<undefined>>
): Promise<EditorFixture> {
  const dom = installDom();
  const fileContainer = document.createElement('div');
  document.body.appendChild(fileContainer);

  const file = new File<undefined>({
    disableFileHeader: true,
    theme: DEFAULT_THEMES,
    ...fileOptions,
  });
  const editor = new Editor<undefined>();
  const initialFile: FileContents = { name: 'highlight.ts', contents };

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
  };
}

// The active-line highlight is the full-line background applied via the
// data-selected-line attribute. This returns the 1-based data-line numbers of
// the content rows currently carrying that attribute.
function highlightedLineNumbers(content: HTMLElement): number[] {
  return [...content.querySelectorAll('[data-line][data-selected-line]')]
    .map((el) => Number(el.getAttribute('data-line')))
    .sort((a, b) => a - b);
}

describe('editor active line highlight', () => {
  test('highlights the caret line for a collapsed selection', async () => {
    const { cleanup, content, editor } = await createEditorFixture(
      'alpha\nbravo\ncharlie\ndelta'
    );
    try {
      editor.setSelections([
        {
          start: { line: 1, character: 0 },
          end: { line: 1, character: 0 },
          direction: 'none',
        },
      ]);
      // Line index 1 ("bravo") renders as data-line "2".
      expect(highlightedLineNumbers(content)).toEqual([2]);
    } finally {
      cleanup();
    }
  });

  test('drops the full-line highlight during a forward multi-line selection', async () => {
    const { cleanup, content, editor } = await createEditorFixture(
      'alpha\nbravo\ncharlie\ndelta'
    );
    try {
      editor.setSelections([
        {
          start: { line: 1, character: 0 },
          end: { line: 3, character: 2 },
          direction: 'forward',
        },
      ]);
      // A non-empty selection shows the selected text, not a full-line
      // background, so no row carries the active-line highlight.
      expect(highlightedLineNumbers(content)).toEqual([]);
    } finally {
      cleanup();
    }
  });

  test('drops the full-line highlight during a backward multi-line selection', async () => {
    const { cleanup, content, editor } = await createEditorFixture(
      'alpha\nbravo\ncharlie\ndelta'
    );
    try {
      editor.setSelections([
        {
          start: { line: 1, character: 0 },
          end: { line: 3, character: 2 },
          direction: 'backward',
        },
      ]);
      expect(highlightedLineNumbers(content)).toEqual([]);
    } finally {
      cleanup();
    }
  });

  test('does not publish a line-selection notification for an editor selection', async () => {
    const notifiedRanges: (SelectedLineRange | null)[] = [];
    const { cleanup, content, editor } = await createEditorFixture(
      'alpha\nbravo\ncharlie\ndelta',
      { onLineSelected: (range) => notifiedRanges.push(range) }
    );
    try {
      editor.setSelections([
        {
          start: { line: 1, character: 0 },
          end: { line: 3, character: 2 },
          direction: 'forward',
        },
      ]);
      // A non-empty selection draws no full-line highlight...
      expect(highlightedLineNumbers(content)).toEqual([]);
      // ...and text selection is not a gutter line selection, so a consumer's
      // onLineSelected handler must not fire.
      expect(notifiedRanges).toEqual([]);
    } finally {
      cleanup();
    }
  });
});
