import { afterAll, describe, expect, test } from 'bun:test';

import { FileDiff } from '../src/components/FileDiff';
import { DEFAULT_THEMES } from '../src/constants';
import { Editor } from '../src/editor/editor';
import { disposeHighlighter } from '../src/highlighter/shared_highlighter';
import type { FileContents } from '../src/types';
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

// Renders a fresh diff surface and attaches the editor, as mounting a
// `FileDiff` under an `EditorProvider` does. The caller can tear it down and
// mount another against the same editor instance, the way Reset remounts.
async function mountSurface(
  editor: Editor<undefined>,
  oldFile: FileContents,
  newFile: FileContents
): Promise<{ container: HTMLElement; fileDiff: FileDiff<undefined> }> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const fileDiff = new FileDiff<undefined>({
    disableFileHeader: true,
    theme: DEFAULT_THEMES,
    diffStyle: 'split',
  });
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
  return { container, fileDiff };
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

describe('editor: reset by remounting the surface', () => {
  // Reset reuses one editor instance and remounts the surface. Detaching must
  // drop the edited document so the re-attached surface rebuilds from the
  // original contents, even with the same file name/lang/cacheKey.
  test('reverts edits when the same editor re-attaches to a fresh surface', async () => {
    const dom = installDom();
    const oldFile: FileContents = {
      name: 'edit.ts',
      contents: 'alpha\nbravo\n',
    };
    const newFile: FileContents = {
      name: 'edit.ts',
      contents: 'alpha\nCHANGED\n',
    };
    const editor = new Editor<undefined>();

    try {
      const first = await mountSurface(editor, oldFile, newFile);
      typeAt(editor, 0, 5, 'X');
      await wait(0);
      expect(editor.getState().file.contents).toBe('alphaX\nCHANGED\n');
      expect(lineText(first.container, 1)).toBe('alphaX');

      // Reset: tear down the surface (detaching the editor), then mount a fresh
      // one on the same editor instance.
      editor.cleanUp();
      first.fileDiff.cleanUp();
      first.container.remove();

      const second = await mountSurface(editor, oldFile, newFile);
      expect(editor.getState().file.contents).toBe('alpha\nCHANGED\n');
      expect(lineText(second.container, 1)).toBe('alpha');

      editor.cleanUp();
      second.fileDiff.cleanUp();
      second.container.remove();
    } finally {
      dom.cleanup();
    }
  });
});
