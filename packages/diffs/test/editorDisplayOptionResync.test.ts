import { afterAll, describe, expect, test } from 'bun:test';

import { FileDiff } from '../src/components/FileDiff';
import { DEFAULT_THEMES } from '../src/constants';
import { Editor } from '../src/editor/editor';
import { disposeHighlighter } from '../src/highlighter/shared_highlighter';
import type { FileContents } from '../src/types';
import { parseDiffFromFile } from '../src/utils/parseDiffFromFile';
import { installDom, wait } from './domHarness';

afterAll(async () => {
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

// Reads the on-screen text of a 1-based line on the additions side.
function lineText(
  container: HTMLElement,
  lineNumber: number
): string | undefined {
  const content = findAdditionContent(container);
  const line = content?.querySelector(`[data-line="${lineNumber}"]`);
  return line == null ? undefined : (line.textContent ?? undefined);
}

// Counts the syntax-highlight token spans on a 1-based line. A line of normal
// code splits into several tokens; the same text inside a block comment renders
// as a single comment token, so this distinguishes the two highlight states
// without asserting on exact colors or markup.
function lineTokenCount(
  container: HTMLElement,
  lineNumber: number
): number | undefined {
  const content = findAdditionContent(container);
  const line = content?.querySelector(`[data-line="${lineNumber}"]`);
  return line == null ? undefined : line.childElementCount;
}

interface DisplayOptionFixture {
  container: HTMLElement;
  editor: Editor<undefined>;
  // Toggles a display option and forces a re-render, exactly as the React bridge
  // does on any display-option change: setOptions(newOptions) then a forced
  // re-render. The bug report's headline trigger is the word-wrap toggle, but
  // every display option (theme, diff style, line numbers, wrap) shares the same
  // forced-render path; line numbers is used here because wrap measurement needs
  // browser layout APIs jsdom lacks.
  toggleDisplayOption(): Promise<void>;
  cleanup(): Promise<void>;
}

async function createFixture(
  oldContents: string,
  newContents: string
): Promise<DisplayOptionFixture> {
  const dom = installDom();
  const container = document.createElement('div');
  document.body.appendChild(container);

  const fileDiff = new FileDiff<undefined>({
    disableFileHeader: true,
    theme: DEFAULT_THEMES,
    diffStyle: 'split',
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
    async toggleDisplayOption() {
      fileDiff.setOptions({
        ...fileDiff.options,
        disableLineNumbers: !(fileDiff.options.disableLineNumbers ?? false),
      });
      fileDiff.render({
        oldFile,
        newFile,
        fileContainer: container,
        forceRender: true,
      });
      // Let syncRenderViewToEditor's highlighter promise resolve.
      await wait(10);
    },
    async cleanup() {
      await wait(10);
      editor.cleanUp();
      fileDiff.cleanUp();
      dom.cleanup();
    },
  };
}

// Inserts text at a collapsed caret on the additions side.
function typeAt(
  editor: Editor<undefined>,
  line: number,
  character: number,
  text: string
): void {
  const position = { line, character };
  editor.setSelections([{ start: position, end: position, direction: 'none' }]);
  editor.applyEdits(
    [{ range: { start: position, end: position }, newText: text }],
    true
  );
}

describe('diff editor: display-option toggle mid-edit', () => {
  test('keeps the edited line text visible when a display option is toggled', async () => {
    // old/new differ so the additions column (the editor's target) renders; the
    // edit targets line 0 ("alpha"), an unchanged context line — the "rename a
    // function" case from the bug report.
    const fixture = await createFixture('alpha\nbravo\n', 'alpha\nCHANGED\n');
    const { container, editor } = fixture;

    try {
      typeAt(editor, 0, 5, 'X');
      await wait(0);
      expect(editor.getState().file.contents).toBe('alphaX\nCHANGED\n');
      // The edit is on screen before the toggle.
      expect(lineText(container, 1)).toBe('alphaX');

      await fixture.toggleDisplayOption();

      // The edit must still be visible without an extra keystroke.
      expect(lineText(container, 1)).toBe('alphaX');
    } finally {
      await fixture.cleanup();
    }
  });

  test('accepts further typing after the toggle without duplicating the edit', async () => {
    const fixture = await createFixture('alpha\nbravo\n', 'alpha\nCHANGED\n');
    const { container, editor } = fixture;

    try {
      typeAt(editor, 0, 5, 'X');
      await wait(0);
      await fixture.toggleDisplayOption();

      // Typing one more character must append to the edit, not re-introduce it.
      // Pre-fix the DOM held the pre-edit text while the document held the edit,
      // so the next keystroke repainted the edit and the new character together.
      typeAt(editor, 0, 6, 'Y');
      await wait(0);

      expect(editor.getState().file.contents).toBe('alphaXY\nCHANGED\n');
      expect(lineText(container, 1)).toBe('alphaXY');
    } finally {
      await fixture.cleanup();
    }
  });

  test('leaves an unedited line untouched when a display option is toggled', async () => {
    const fixture = await createFixture('alpha\nbravo\n', 'alpha\nCHANGED\n');
    const { container, editor } = fixture;

    try {
      // No edit is made: the rebuilt rows already match the document, so the
      // resync must repaint nothing and leave the original text in place.
      expect(lineText(container, 1)).toBe('alpha');

      await fixture.toggleDisplayOption();

      expect(lineText(container, 1)).toBe('alpha');
      expect(editor.getState().file.contents).toBe('alpha\nCHANGED\n');
    } finally {
      await fixture.cleanup();
    }
  });

  test('refreshes downstream highlighting when an edit changes tokenizer state', async () => {
    // Lines 0 and 1 are unchanged context lines; line 2 is the actual diff.
    const fixture = await createFixture(
      'const a = 1;\nconst b = 2;\nOLD\n',
      'const a = 1;\nconst b = 2;\nNEW\n'
    );
    const { container, editor } = fixture;

    try {
      // As normal code, line 1 highlights into several tokens.
      expect(lineTokenCount(container, 2)).toBeGreaterThan(1);

      // Open a block comment on line 0. Line 1's text does not change, but it is
      // now inside the comment, so it collapses to a single comment token.
      typeAt(editor, 0, 0, '/*');
      await wait(0);
      expect(lineText(container, 2)).toBe('const b = 2;');
      expect(lineTokenCount(container, 2)).toBe(1);

      await fixture.toggleDisplayOption();

      // Line 1's text was never edited, so reconciling text alone would leave
      // the stale multi-token code highlighting from the rebuilt source. After
      // re-rendering from the document it stays a single comment token.
      expect(lineText(container, 2)).toBe('const b = 2;');
      expect(lineTokenCount(container, 2)).toBe(1);
    } finally {
      await fixture.cleanup();
    }
  });

  test('keeps a newly inserted line across the toggle', async () => {
    const fixture = await createFixture('alpha\nbravo\n', 'alpha\nCHANGED\n');
    const { container, editor } = fixture;

    try {
      // A line-count-changing edit: split line 0 into two lines.
      typeAt(editor, 0, 5, '\nINSERTED');
      await wait(0);
      expect(editor.getState().file.contents).toBe(
        'alpha\nINSERTED\nCHANGED\n'
      );
      expect(lineText(container, 1)).toBe('alpha');
      expect(lineText(container, 2)).toBe('INSERTED');

      await fixture.toggleDisplayOption();

      // Both the edited line and the inserted line must survive the re-render.
      expect(lineText(container, 1)).toBe('alpha');
      expect(lineText(container, 2)).toBe('INSERTED');
      expect(editor.getState().file.contents).toBe(
        'alpha\nINSERTED\nCHANGED\n'
      );
    } finally {
      await fixture.cleanup();
    }
  });

  // Exercises the fileDiff-prop path the React bridge uses: the host holds one
  // diff object. A line-count edit followed by a forced re-render that re-passes
  // a fresh diff object resets the rendered rows to the original count, so the
  // re-render must come from the document - otherwise inserted lines are never
  // created (and deleted lines never removed).
  test('keeps an inserted line when the host re-passes a fresh diff object', async () => {
    const dom = installDom();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const fileDiff = new FileDiff<undefined>({
      disableFileHeader: true,
      theme: DEFAULT_THEMES,
      diffStyle: 'split',
    });
    const editor = new Editor<undefined>();
    const oldContents = 'alpha\nbravo\n';
    const newContents = 'alpha\nCHANGED\n';
    const file = { name: 'edit.ts' };

    fileDiff.render({
      fileDiff: parseDiffFromFile(
        { ...file, contents: oldContents },
        { ...file, contents: newContents }
      ),
      fileContainer: container,
      forceRender: true,
    });
    editor.edit(fileDiff);
    for (let attempt = 0; attempt < 40; attempt++) {
      const content = findAdditionContent(container);
      if (
        content != null &&
        content.getAttribute('contenteditable') === 'true'
      ) {
        break;
      }
      await wait(0);
    }

    try {
      typeAt(editor, 0, 5, '\nINSERTED');
      await wait(0);
      expect(lineText(container, 2)).toBe('INSERTED');

      // Forced re-render with a brand-new diff object (as a host that re-derives
      // its fileDiff each render would pass), which resets the rendered rows.
      fileDiff.setOptions({ ...fileDiff.options, disableLineNumbers: true });
      fileDiff.render({
        fileDiff: parseDiffFromFile(
          { ...file, contents: oldContents },
          { ...file, contents: newContents }
        ),
        fileContainer: container,
        forceRender: true,
      });
      await wait(10);

      expect(lineText(container, 1)).toBe('alpha');
      expect(lineText(container, 2)).toBe('INSERTED');
      expect(lineText(container, 3)).toBe('CHANGED');
    } finally {
      await wait(10);
      editor.cleanUp();
      fileDiff.cleanUp();
      dom.cleanup();
    }
  });
});
