import { afterAll, beforeEach, describe, expect, test } from 'bun:test';

import { FileDiff } from '../src/components/FileDiff';
import { DEFAULT_THEMES } from '../src/constants';
import { Editor } from '../src/editor/editor';
import { disposeHighlighter } from '../src/highlighter/shared_highlighter';
import type { FileContents } from '../src/types';
import { installDom, wait } from './domHarness';

afterAll(async () => {
  await disposeHighlighter();
});

// Other component suites (e.g. CodeView) share the singleton highlighter; reset
// it before each test so async highlight work cannot bleed into undo timing.
beforeEach(async () => {
  await disposeHighlighter();
});

// The editor attaches to the additions (new-file) side of a diff. That column
// is the `[data-code]` element without `data-deletions`; its editable lines
// live in the child marked `data-content`.
function findAdditionContent(container: HTMLElement): HTMLElement | undefined {
  const shadow = container.shadowRoot;
  if (shadow == null) {
    return undefined;
  }
  for (const code of shadow.querySelectorAll<HTMLElement>('[data-code]')) {
    if (code.dataset.deletions !== undefined) {
      continue;
    }
    for (const child of code.children) {
      const el = child as HTMLElement;
      if (el.dataset.content !== undefined) {
        return el;
      }
    }
  }
  return undefined;
}

function countEditableLineEls(content: HTMLElement): number {
  let count = 0;
  for (const child of content.children) {
    const el = child as HTMLElement;
    if (
      el.dataset.line !== undefined &&
      el.dataset.lineType !== 'change-deletion'
    ) {
      count++;
    }
  }
  return count;
}

interface DiffEditorFixture {
  container: HTMLElement;
  editor: Editor<undefined>;
  cleanup(): Promise<void>;
}

async function createDiffEditorFixture(
  diffStyle: 'split' | 'unified',
  oldContents: string,
  newContents: string
): Promise<DiffEditorFixture> {
  const dom = installDom();
  const container = document.createElement('div');
  document.body.appendChild(container);

  const fileDiff = new FileDiff<undefined>({
    disableFileHeader: true,
    theme: DEFAULT_THEMES,
    diffStyle,
  });
  const editor = new Editor<undefined>();
  const oldFile: FileContents = { name: 'edit.ts', contents: oldContents };
  const newFile: FileContents = { name: 'edit.ts', contents: newContents };

  fileDiff.render({
    oldFile,
    newFile,
    fileContainer: container,
    forceRender: true,
  });
  editor.edit(fileDiff);

  for (let attempt = 0; attempt < 40; attempt++) {
    const content = findAdditionContent(container);
    if (content != null && content.getAttribute('contenteditable') === 'true') {
      break;
    }
    await wait(0);
  }

  return {
    container,
    editor,
    async cleanup() {
      // Drain any pending highlighter/sync callbacks before tearing down the DOM
      // so a late re-attach does not run against a destroyed document.
      await wait(10);
      editor.cleanUp();
      fileDiff.cleanUp();
      dom.cleanup();
      await disposeHighlighter();
    },
  };
}

// Replaces the whole document with `newText`, mirroring select-all then a
// delete or paste.
function replaceAll(editor: Editor<undefined>, newText: string): void {
  const lines = editor.getState().file.contents.split('\n');
  const end = { line: lines.length - 1, character: lines.at(-1)!.length };
  editor.setSelections([
    { start: { line: 0, character: 0 }, end, direction: 'none' },
  ]);
  editor.applyEdits(
    [{ range: { start: { line: 0, character: 0 }, end }, newText }],
    true
  );
}

describe('diff editor: select-all then delete', () => {
  for (const diffStyle of ['split', 'unified'] as const) {
    test(`keeps an editable line, accepts typing, and undoes (${diffStyle})`, async () => {
      const fixture = await createDiffEditorFixture(
        diffStyle,
        'a\nb\nX\n',
        'a\nb\nc\n'
      );
      const { editor, container } = fixture;

      try {
        // Delete everything.
        replaceAll(editor, '');
        await wait(0);
        expect(editor.getState().file.contents).toBe('');

        // The additions column must still exist with one empty editable line.
        const content = findAdditionContent(container);
        expect(content).toBeDefined();
        if (content == null) return;
        expect(countEditableLineEls(content)).toBeGreaterThanOrEqual(1);

        // Typing must still land in the document.
        editor.applyEdits(
          [
            {
              range: {
                start: { line: 0, character: 0 },
                end: { line: 0, character: 0 },
              },
              newText: 'hello',
            },
          ],
          true
        );
        await wait(0);
        expect(editor.getState().file.contents).toBe('hello');

        // Undo reverts the typing, then the deletion, back to the original.
        editor.undo();
        editor.undo();
        for (let attempt = 0; attempt < 40; attempt++) {
          if (editor.getState().file.contents === 'a\nb\nc\n') {
            break;
          }
          await wait(10);
        }
        expect(editor.getState().file.contents).toBe('a\nb\nc\n');
      } finally {
        await fixture.cleanup();
      }
    });

    test(`keeps split rows top-aligned after inserting a line (${diffStyle})`, async () => {
      const oldContents =
        Array.from({ length: 30 }, (_, index) => `old ${index + 1}`).join(
          '\n'
        ) + '\n';
      const newContents =
        Array.from({ length: 40 }, (_, index) => `new ${index + 1}`).join(
          '\n'
        ) + '\n';
      const fixture = await createDiffEditorFixture(
        diffStyle,
        oldContents,
        newContents
      );
      const { editor, container } = fixture;

      try {
        replaceAll(editor, '');
        for (let attempt = 0; attempt < 40; attempt++) {
          if (editor.getState().file.contents === '') {
            break;
          }
          await wait(10);
        }

        editor.applyEdits(
          [
            {
              range: {
                start: { line: 0, character: 0 },
                end: { line: 0, character: 0 },
              },
              newText: '\n',
            },
          ],
          true
        );
        for (let attempt = 0; attempt < 40; attempt++) {
          const content = findAdditionContent(container);
          const hasLine2 =
            content != null &&
            [...content.children].some(
              (child) => (child as HTMLElement).dataset.line === '2'
            );
          const hasCaret =
            container.shadowRoot?.querySelector('[data-caret]') != null;
          if (hasLine2 && hasCaret) {
            break;
          }
          await wait(10);
        }

        const content = findAdditionContent(container);
        expect(content).toBeDefined();
        if (content == null) return;

        const line1Index = [...content.children].findIndex(
          (child) => (child as HTMLElement).dataset.line === '1'
        );
        const line2Index = [...content.children].findIndex(
          (child) => (child as HTMLElement).dataset.line === '2'
        );
        if (diffStyle === 'split') {
          expect(line1Index).toBeGreaterThanOrEqual(0);
          expect(line2Index).toBe(line1Index + 1);
        }
        expect(
          container.shadowRoot?.querySelector('[data-caret]') != null
        ).toBe(true);
      } finally {
        await fixture.cleanup();
      }
    });

    test(`keeps the trailing blank line and caret after typing text then Enter (${diffStyle})`, async () => {
      const oldContents =
        Array.from({ length: 8 }, (_, index) => `old ${index + 1}`).join('\n') +
        '\n';
      const newContents = [
        'old 1\n',
        'old 2\n',
        'old 3 changed\n',
        'old 4\n',
        'inserted\n',
        'old 5\n',
        'old 6\n',
        'old 7\n',
        'old 8\n',
        'appended\n',
      ].join('');
      const fixture = await createDiffEditorFixture(
        diffStyle,
        oldContents,
        newContents
      );
      const { editor, container } = fixture;

      try {
        replaceAll(editor, '');
        await wait(0);
        expect(editor.getState().file.contents).toBe('');

        editor.setSelections([
          {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 0 },
            direction: 'none',
          },
        ]);
        editor.applyEdits(
          [
            {
              range: {
                start: { line: 0, character: 0 },
                end: { line: 0, character: 0 },
              },
              newText: 'a',
            },
          ],
          true
        );
        await wait(0);

        const content = findAdditionContent(container);
        expect(content).toBeDefined();
        if (content == null) return;
        dispatchBeforeInput(content, 'insertLineBreak');

        for (let attempt = 0; attempt < 40; attempt++) {
          const hasLine2 = [...content.children].some(
            (child) => (child as HTMLElement).dataset.line === '2'
          );
          const hasCaret =
            container.shadowRoot?.querySelector('[data-caret]') != null;
          if (hasLine2 && hasCaret) {
            break;
          }
          await wait(10);
        }

        expect(editor.getState().file.contents).toBe('a\n');
        const freshContent = findAdditionContent(container);
        expect(freshContent).toBeDefined();
        if (freshContent == null) return;
        expect(
          [...freshContent.children].some(
            (child) => (child as HTMLElement).dataset.line === '2'
          )
        ).toBe(true);
        expect(
          container.shadowRoot?.querySelector('[data-caret]') != null
        ).toBe(true);
      } finally {
        await fixture.cleanup();
      }
    });
  }
});

// Fires the beforeinput the browser would send, so the editor's own handler
// runs (it reads e.inputType and edits #selections). cancelable lets the
// handler preventDefault as it does in the browser. InputEvent lives on the
// jsdom window rather than globalThis, so reach it through the element.
function dispatchBeforeInput(content: HTMLElement, inputType: string): void {
  const view = content.ownerDocument.defaultView;
  if (view == null) {
    throw new Error('content element is not attached to a window');
  }
  content.dispatchEvent(
    new view.InputEvent('beforeinput', {
      inputType,
      bubbles: true,
      cancelable: true,
      composed: true,
      data: null,
    })
  );
}

// cmd+backspace deletes to the start of the line. Chrome reports it as
// deleteSoftLineBackward, but Safari reports deleteHardLineBackward; the editor
// must treat both the same or Safari's cmd+backspace silently does nothing.
describe('diff editor: cmd+backspace (deleteHardLineBackward) deletes to line start', () => {
  for (const diffStyle of ['split', 'unified'] as const) {
    test(`Safari's deleteHardLineBackward matches Chrome's deleteSoftLineBackward (${diffStyle})`, async () => {
      const fixture = await createDiffEditorFixture(
        diffStyle,
        'a\nb\n',
        'hello world\nfoo\n'
      );
      const { editor, container } = fixture;
      try {
        const content = findAdditionContent(container);
        expect(content).toBeDefined();
        if (content == null) return;

        // Caret at the end of "hello world", then Safari's cmd+backspace.
        editor.setSelections([
          {
            start: { line: 0, character: 11 },
            end: { line: 0, character: 11 },
            direction: 'none',
          },
        ]);
        dispatchBeforeInput(content, 'deleteHardLineBackward');
        await wait(0);
        expect(editor.getState().file.contents).toBe('\nfoo\n');
      } finally {
        await fixture.cleanup();
      }
    });
  }
});
