import { afterAll, describe, expect, test } from 'bun:test';

import { FileDiff } from '../src/components/FileDiff';
import { DEFAULT_THEMES } from '../src/constants';
import { Editor } from '../src/editor/editor';
import { isMoveCursorShortcut } from '../src/editor/platform';
import { disposeHighlighter } from '../src/highlighter/shared_highlighter';
import { installDom, wait } from './domHarness';

afterAll(async () => {
  await disposeHighlighter();
});

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

interface FoldFixture {
  container: HTMLElement;
  editor: Editor<undefined>;
  fileDiff: FileDiff<undefined>;
  content: HTMLElement;
  cleanup(): Promise<void>;
}

// 60-line file, changes at lines 10 and 50: hunks cover lines 6-14 and
// 46-54, with the gap 15-45 collapsed once the fixture re-enables collapse
// mid-session (the standalone pre-flip vector).
async function createFoldFixture(): Promise<FoldFixture> {
  const dom = installDom();
  const container = document.createElement('div');
  document.body.appendChild(container);

  const oldContents =
    Array.from({ length: 60 }, (_, index) => `line ${index + 1}`).join('\n') +
    '\n';
  const newContents = oldContents
    .replace('line 10\n', 'line 10 changed\n')
    .replace('line 50\n', 'line 50 changed\n');

  const fileDiff = new FileDiff<undefined>({
    disableFileHeader: true,
    theme: DEFAULT_THEMES,
    diffStyle: 'split',
  });
  const editor = new Editor<undefined>();
  fileDiff.render({
    oldFile: { name: 'edit.ts', contents: oldContents },
    newFile: { name: 'edit.ts', contents: newContents },
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

  fileDiff.setOptions({ ...fileDiff.options, expandUnchanged: false });
  fileDiff.rerender();
  await wait(10);

  return {
    container,
    editor,
    fileDiff,
    // Re-query after the collapse re-render: it can rebuild the column the
    // editor re-listens on.
    content: findAdditionContent(container)!,
    async cleanup() {
      await wait(10);
      editor.cleanUp();
      fileDiff.cleanUp();
      dom.cleanup();
    },
  };
}

function setCaret(editor: Editor<undefined>, line: number, character = 0) {
  const position = { line, character };
  editor.setSelections([{ start: position, end: position, direction: 'none' }]);
}

function pressKey(
  content: HTMLElement,
  key: string,
  init: KeyboardEventInit = {}
) {
  const KeyboardEventCtor = content.ownerDocument.defaultView!.KeyboardEvent;
  content.dispatchEvent(
    new KeyboardEventCtor('keydown', { key, bubbles: true, ...init })
  );
}

// isMoveCursorShortcut only reads key/modifier fields, so a plain shape
// stands in for a KeyboardEvent outside an installed DOM.
function keyEvent(key: string): KeyboardEvent {
  const shape: Pick<
    KeyboardEvent,
    'key' | 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey'
  > = { key, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false };
  // oxlint-disable-next-line typescript/consistent-type-assertions
  return shape as KeyboardEvent;
}

describe('diff editor: fold-skip navigation', () => {
  test('page keys are not editor-handled cursor shortcuts', () => {
    // Page keys fall through to native contenteditable caret movement, which
    // can only land on rendered rows once separators are read-only.
    expect(isMoveCursorShortcut(keyEvent('PageDown'))).toBeUndefined();
    expect(isMoveCursorShortcut(keyEvent('PageUp'))).toBeUndefined();
  });

  test('arrow-down at a hunk boundary skips the collapsed gap', async () => {
    const fixture = await createFoldFixture();
    const { editor, content } = fixture;
    try {
      // Line 14 (index 13) is the last rendered line of the first hunk.
      setCaret(editor, 13);
      await wait(0);
      pressKey(content, 'ArrowDown');
      const selections = editor.getState().selections;
      // The caret jumps over lines 15-45 to line 46 (index 45).
      expect(selections?.at(-1)?.start.line).toBe(45);
    } finally {
      await fixture.cleanup();
    }
  });

  test('arrow-up at a hunk boundary skips the collapsed gap', async () => {
    const fixture = await createFoldFixture();
    const { editor, content } = fixture;
    try {
      setCaret(editor, 45);
      await wait(0);
      pressKey(content, 'ArrowUp');
      expect(editor.getState().selections?.at(-1)?.start.line).toBe(13);
    } finally {
      await fixture.cleanup();
    }
  });

  test('arrow-right at the end of a hunk boundary line skips the gap', async () => {
    const fixture = await createFoldFixture();
    const { editor, content } = fixture;
    try {
      // End of line 14 (index 13), the last rendered line before the gap.
      setCaret(editor, 13, 'line 14'.length);
      await wait(0);
      pressKey(content, 'ArrowRight');
      const selection = editor.getState().selections?.at(-1);
      // The caret lands at the start of the next renderable line (46).
      expect(selection?.start.line).toBe(45);
      expect(selection?.start.character).toBe(0);
    } finally {
      await fixture.cleanup();
    }
  });

  test('arrow-left at the start of a hunk boundary line skips the gap', async () => {
    const fixture = await createFoldFixture();
    const { editor, content } = fixture;
    try {
      // Start of line 46 (index 45), the first rendered line after the gap.
      setCaret(editor, 45, 0);
      await wait(0);
      pressKey(content, 'ArrowLeft');
      const selection = editor.getState().selections?.at(-1);
      // The caret lands at the end of the previous renderable line (14).
      expect(selection?.start.line).toBe(13);
      expect(selection?.start.character).toBe('line 14'.length);
    } finally {
      await fixture.cleanup();
    }
  });

  test('shift+arrow-right extends the selection across the gap', async () => {
    const fixture = await createFoldFixture();
    const { editor, content } = fixture;
    try {
      setCaret(editor, 13, 'line 14'.length);
      await wait(0);
      pressKey(content, 'ArrowRight', { shiftKey: true });
      const selection = editor.getState().selections?.at(-1);
      expect(selection?.start.line).toBe(13);
      expect(selection?.end.line).toBe(45);
      expect(selection?.end.character).toBe(0);
    } finally {
      await fixture.cleanup();
    }
  });

  test('horizontal motion stays put when only collapsed lines remain', async () => {
    const fixture = await createFoldFixture();
    const { editor, content } = fixture;
    try {
      // End of line 54 (index 53): only the collapsed trailing gap is below.
      setCaret(editor, 53, 'line 54'.length);
      await wait(0);
      pressKey(content, 'ArrowRight');
      let selection = editor.getState().selections?.at(-1);
      expect(selection?.start.line).toBe(53);
      expect(selection?.start.character).toBe('line 54'.length);

      // Start of line 6 (index 5): only the collapsed leading gap is above.
      setCaret(editor, 5, 0);
      await wait(0);
      pressKey(content, 'ArrowLeft');
      selection = editor.getState().selections?.at(-1);
      expect(selection?.start.line).toBe(5);
      expect(selection?.start.character).toBe(0);
    } finally {
      await fixture.cleanup();
    }
  });

  test('shift+arrow-down builds a selection spanning the gap', async () => {
    const fixture = await createFoldFixture();
    const { editor, content } = fixture;
    try {
      setCaret(editor, 13);
      await wait(0);
      pressKey(content, 'ArrowDown', { shiftKey: true });
      const selection = editor.getState().selections?.at(-1);
      // Fold semantics: the selection covers the hidden lines.
      expect(selection?.start.line).toBe(13);
      expect(selection?.end.line).toBe(45);
    } finally {
      await fixture.cleanup();
    }
  });
});

describe('diff editor: reveal-on-jump', () => {
  test('setSelections into a collapsed region expands it', async () => {
    const fixture = await createFoldFixture();
    const { container, editor, fileDiff } = fixture;
    try {
      expect(fileDiff.isLineRenderable(30)).toBe(false);

      // Jump the caret to line 30 (index 29), hidden inside the gap.
      setCaret(editor, 29);
      await wait(20);

      expect(fileDiff.isLineRenderable(30)).toBe(true);
      const content = findAdditionContent(container);
      expect(content?.querySelector('[data-line="30"]')).not.toBeNull();
    } finally {
      await fixture.cleanup();
    }
  });

  test('undo whose caret restore lands in a collapsed region expands it', async () => {
    const fixture = await createFoldFixture();
    const { editor, fileDiff } = fixture;
    try {
      // Edit line 30 while its gap is temporarily expanded, then collapse
      // everything again by rebuilding the diff state: the undo caret restore
      // must reveal the region on its own.
      setCaret(editor, 29);
      await wait(20);
      editor.applyEdits(
        [
          {
            range: {
              start: { line: 29, character: 0 },
              end: { line: 29, character: 0 },
            },
            newText: 'edited ',
          },
        ],
        true
      );
      await wait(20);

      expect(editor.canUndo).toBe(true);
      editor.undo();
      await wait(20);
      expect(editor.getFile()?.contents).not.toContain('edited line 30');
      // The caret restore targeted line 30, so it stays revealed.
      expect(fileDiff.isLineRenderable(30)).toBe(true);
    } finally {
      await fixture.cleanup();
    }
  });

  test('a same-line-count replace inside the gap materializes a rendered hunk', async () => {
    const fixture = await createFoldFixture();
    const { container, editor, fileDiff } = fixture;
    try {
      const hunksBefore = fileDiff.fileDiff!.hunks.length;
      // Mirrors search replaceAll: a buffer edit with no active selection
      // into a line hidden inside the collapsed gap.
      editor.applyEdits(
        [
          {
            range: {
              start: { line: 29, character: 0 },
              end: { line: 29, character: 'line 30'.length },
            },
            newText: 'REPLACED',
          },
        ],
        true
      );
      // The deferred escalation re-render runs through the rAF queue.
      await wait(30);

      expect(fileDiff.fileDiff!.hunks.length).toBe(hunksBefore + 1);
      const content = findAdditionContent(container);
      const row = content?.querySelector('[data-line="30"]');
      expect(row).not.toBeNull();
      expect(row?.textContent).toBe('REPLACED');
    } finally {
      await fixture.cleanup();
    }
  });
});
