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
  fileDiff: FileDiff<undefined>;
  oldFile: FileContents;
  newFile: FileContents;
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
    fileDiff,
    oldFile,
    newFile,
    async cleanup() {
      // Drain any pending highlighter/sync callbacks before tearing down the DOM
      // so a late re-attach does not run against a destroyed document.
      await wait(10);
      editor.cleanUp();
      fileDiff.cleanUp();
      dom.cleanup();
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
        await wait(0);
        expect(editor.getState().file.contents).toBe('a\nb\nc\n');
      } finally {
        await fixture.cleanup();
      }
    });
  }
});

// Distinct from the editor's default 20px line height so an assertion against a
// ROW multiple can't coincidentally match the built-in metric.
const CARET_ROW = 30;

// jsdom performs no layout, so every offsetTop/offsetHeight is 0. The split
// additions column lays out as a CSS grid where DOM order drives placement and
// the deletion buffer spans `data-buffer-size` rows. Model that: a row's top is
// the number of grid rows its earlier siblings occupy (buffers occupy their
// size, everything else one), and a row's height is its own span. This lets the
// caret's measured Y reflect where a row actually sits relative to the buffer.
function installGridLayout(): { restore(): void } {
  const proto = HTMLElement.prototype;
  const originalTop = Object.getOwnPropertyDescriptor(proto, 'offsetTop');
  const originalHeight = Object.getOwnPropertyDescriptor(proto, 'offsetHeight');
  const rowSpan = (el: HTMLElement): number => {
    const buffer = el.dataset?.bufferSize;
    return buffer != null ? parseInt(buffer, 10) : 1;
  };
  Object.defineProperty(proto, 'offsetTop', {
    configurable: true,
    get(this: HTMLElement): number {
      let rows = 0;
      let sibling = this.previousElementSibling as HTMLElement | null;
      while (sibling != null) {
        rows += rowSpan(sibling);
        sibling = sibling.previousElementSibling as HTMLElement | null;
      }
      return rows * CARET_ROW;
    },
  });
  Object.defineProperty(proto, 'offsetHeight', {
    configurable: true,
    get(this: HTMLElement): number {
      return rowSpan(this) * CARET_ROW;
    },
  });
  return {
    restore(): void {
      for (const [key, original] of [
        ['offsetTop', originalTop],
        ['offsetHeight', originalHeight],
      ] as const) {
        if (original !== undefined) {
          Object.defineProperty(proto, key, original);
        } else {
          Object.defineProperty(proto, key, {
            configurable: true,
            get: () => 0,
          });
        }
      }
    },
  };
}

function caretTranslateY(container: HTMLElement): number {
  const caret = container.shadowRoot?.querySelector('[data-caret]');
  if (!(caret instanceof HTMLElement)) {
    throw new Error('no caret element rendered');
  }
  const match = /translateY\(([-\d.]+)px\)/.exec(caret.style.transform);
  if (match === null) {
    throw new Error(`caret has no translateY: ${caret.style.transform}`);
  }
  return parseFloat(match[1]);
}

function caretAt(line: number) {
  return [
    {
      start: { line, character: 0 },
      end: { line, character: 0 },
      direction: 'none' as const,
    },
  ];
}

function insertAt(line: number, character: number, newText: string) {
  return {
    range: { start: { line, character }, end: { line, character } },
    newText,
  };
}

// After deleting every addition the editable column is a single empty row above
// a deletion buffer that spans the rest of the file. Typing there used to send
// the caret to the document top (the empty line has no diff row, so the lookup
// returned -1) and then to the bottom (a newly typed line was appended after the
// buffer). Each new line must instead stay one row below the one above it.
describe('diff editor: caret tracks typed lines after delete-all', () => {
  for (const diffStyle of ['split', 'unified'] as const) {
    test(`keeps the caret on the line being edited (${diffStyle})`, async () => {
      const fixture = await createDiffEditorFixture(
        diffStyle,
        '1\n2\n3\n4\n5\n',
        'a\nb\nc\nd\ne\n'
      );
      const { editor, container } = fixture;
      const layout = installGridLayout();
      try {
        replaceAll(editor, '');
        await wait(0);

        editor.setSelections(caretAt(0));
        const lineZeroY = caretTranslateY(container);

        // Type a character, then Enter. The caret moves to the new trailing
        // line, exactly one row below line 0 — not to the document top.
        editor.applyEdits([insertAt(0, 0, 'x')], true);
        await wait(0);
        editor.applyEdits([insertAt(0, 1, '\n')], true);
        await wait(0);
        editor.setSelections(caretAt(1));
        expect(caretTranslateY(container) - lineZeroY).toBe(CARET_ROW);

        // Typing on that new line keeps the caret on it — not at the bottom of
        // the file after the deletion buffer.
        editor.applyEdits([insertAt(1, 0, 'y')], true);
        await wait(0);
        editor.setSelections(caretAt(1));
        expect(caretTranslateY(container) - lineZeroY).toBe(CARET_ROW);
        expect(editor.getState().file.contents).toBe('x\ny');

        // A second Enter plus typing lands the caret two rows below line 0.
        editor.applyEdits([insertAt(1, 1, '\n')], true);
        await wait(0);
        editor.applyEdits([insertAt(2, 0, 'z')], true);
        await wait(0);
        editor.setSelections(caretAt(2));
        expect(caretTranslateY(container) - lineZeroY).toBe(2 * CARET_ROW);
        expect(editor.getState().file.contents).toBe('x\ny\nz');
      } finally {
        layout.restore();
        await fixture.cleanup();
      }
    });
  }
});

// Switching the diff style after delete-all re-renders from the document
// (`rerenderFromDocument`), which re-highlights and produces one fewer addition
// row than the diff carries for the editor's empty trailing line. Rendering must
// fill that row empty instead of throwing "deletionLine and additionLine are
// null" (the reported crash on split → delete-all → switch to unified).
describe('diff editor: switching diff style after delete-all', () => {
  for (const [from, to] of [
    ['split', 'unified'],
    ['unified', 'split'],
  ] as const) {
    test(`does not crash and keeps an editable line (${from} → ${to})`, async () => {
      const fixture = await createDiffEditorFixture(
        from,
        '1\n2\n3\n4\n5\n',
        'a\nb\nc\nd\ne\n'
      );
      const { editor, container, fileDiff, oldFile, newFile } = fixture;
      try {
        replaceAll(editor, '');
        await wait(0);

        fileDiff.setOptions({ ...fileDiff.options, diffStyle: to });
        fileDiff.render({
          oldFile,
          newFile,
          fileContainer: container,
          forceRender: true,
        });
        await wait(10);

        const content = findAdditionContent(container);
        expect(content).toBeDefined();
        expect(countEditableLineEls(content!)).toBeGreaterThanOrEqual(1);

        // Typing still lands in the document after the switch.
        editor.applyEdits([insertAt(0, 0, 'hi')], true);
        await wait(0);
        expect(editor.getState().file.contents).toBe('hi');
      } finally {
        await fixture.cleanup();
      }
    });
  }
});

// Deleting everything from a newly added file empties both sides of the diff, so
// a recompute compares empty against empty and produces no hunks. The editor
// still needs one editable row to host its caret, so an empty addition row must
// be synthesized even when there is no hunk to grow.
describe('diff editor: delete-all on an added file (empty old side)', () => {
  for (const diffStyle of ['split', 'unified'] as const) {
    test(`keeps an editable line and accepts typing (${diffStyle})`, async () => {
      const fixture = await createDiffEditorFixture(
        diffStyle,
        '',
        'alpha\nbravo\n'
      );
      const { editor, container } = fixture;
      try {
        replaceAll(editor, '');
        await wait(0);
        expect(editor.getState().file.contents).toBe('');

        const content = findAdditionContent(container);
        expect(content).toBeDefined();
        expect(countEditableLineEls(content!)).toBeGreaterThanOrEqual(1);

        editor.applyEdits([insertAt(0, 0, 'hello')], true);
        await wait(0);
        expect(editor.getState().file.contents).toBe('hello');
      } finally {
        await fixture.cleanup();
      }
    });
  }
});
