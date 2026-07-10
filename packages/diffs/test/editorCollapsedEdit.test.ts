import { afterAll, describe, expect, test } from 'bun:test';

import { FileDiff } from '../src/components/FileDiff';
import { DEFAULT_THEMES } from '../src/constants';
import { Editor } from '../src/editor/editor';
import { disposeHighlighter } from '../src/highlighter/shared_highlighter';
import { installDom, wait } from './domHarness';

afterAll(async () => {
  await disposeHighlighter();
});

// The editor attaches to the additions (new-file) side of a diff: the
// [data-code] element without data-deletions, lines under data-content.
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

function findAdditionGutter(container: HTMLElement): HTMLElement | undefined {
  const content = findAdditionContent(container);
  const code = content?.parentElement;
  for (const child of code?.children ?? []) {
    const el = child as HTMLElement;
    if (el.dataset.gutter !== undefined) {
      return el;
    }
  }
  return undefined;
}

function renderedLineNumbers(container: HTMLElement): number[] {
  const content = findAdditionContent(container);
  const numbers: number[] = [];
  for (const line of content?.querySelectorAll('[data-line]') ?? []) {
    numbers.push(Number(line.getAttribute('data-line')));
  }
  return numbers;
}

interface CollapsedEditFixture {
  container: HTMLElement;
  editor: Editor<undefined>;
  fileDiff: FileDiff<undefined>;
  cleanup(): Promise<void>;
}

// A 60-line file with changes at lines 10 and 50: two hunks with a large
// collapsible gap between them plus collapsible leading/trailing context.
// Editing starts with the still-forced expansion, then the collapse is
// re-enabled mid-session — the standalone vector for exercising
// collapse-during-edit before the option forcing is removed.
async function createCollapsedEditFixture(): Promise<CollapsedEditFixture> {
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

  // Re-enable collapse mid-session: allowed for standalone instances, and
  // Editor.edit's option forcing only runs once at attach.
  fileDiff.setOptions({ ...fileDiff.options, expandUnchanged: false });
  fileDiff.rerender();
  await wait(10);

  return {
    container,
    editor,
    fileDiff,
    async cleanup() {
      await wait(10);
      editor.cleanUp();
      fileDiff.cleanUp();
      dom.cleanup();
    },
  };
}

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

describe('diff editor: collapsed regions during edit', () => {
  test('renders sparse rows with read-only separators and column parity', async () => {
    const fixture = await createCollapsedEditFixture();
    const { container, fileDiff } = fixture;
    try {
      const lineNumbers = renderedLineNumbers(container);
      // The gap between the hunks is collapsed: far fewer than 60 rows, and
      // a mid-gap line has no row.
      expect(lineNumbers.length).toBeLessThan(60);
      expect(lineNumbers).not.toContain(30);
      expect(fileDiff.isLineRenderable(30)).toBe(false);
      expect(fileDiff.isLineRenderable(10)).toBe(true);

      // Separator rows inside the contenteditable column are read-only.
      const content = findAdditionContent(container);
      const separators = content?.querySelectorAll('[data-separator]') ?? [];
      expect(separators.length).toBeGreaterThan(0);
      for (const separator of separators) {
        expect(separator.getAttribute('contenteditable')).toBe('false');
      }

      // The gutter and content columns stay index-parallel (separators emit
      // paired rows), which caret geometry relies on.
      const gutter = findAdditionGutter(container);
      expect(gutter?.childElementCount).toBe(content?.childElementCount);
    } finally {
      await fixture.cleanup();
    }
  });

  test('typing below a collapsed gap patches the row without duplicates', async () => {
    const fixture = await createCollapsedEditFixture();
    const { container, editor } = fixture;
    try {
      // Line 50 (index 49) sits below the collapsed gap.
      typeAt(fixture.editor, 49, 0, 'X');
      await wait(0);
      expect(editor.getFile()?.contents).toContain('Xline 50 changed');

      const content = findAdditionContent(container);
      const rows = content?.querySelectorAll('[data-line="50"]') ?? [];
      expect(rows.length).toBe(1);
      expect(rows[0].textContent).toBe('Xline 50 changed');

      // No duplicates, and no rows materialized inside the collapsed gaps.
      // (The document-end phantom line may gain an appended row, matching the
      // fully expanded behavior.)
      const lineNumbers = renderedLineNumbers(container);
      expect(new Set(lineNumbers).size).toBe(lineNumbers.length);
      for (const lineNumber of lineNumbers) {
        expect(
          lineNumber <= 14 ||
            (lineNumber >= 46 && lineNumber <= 54) ||
            lineNumber === 61
        ).toBe(true);
      }
    } finally {
      await fixture.cleanup();
    }
  });

  test('a line-count edit below the gap re-renders without duplicates', async () => {
    const fixture = await createCollapsedEditFixture();
    const { container, editor } = fixture;
    try {
      typeAt(editor, 49, 'line 50 changed'.length + 1, '\nNEW LINE');
      await wait(20);

      expect(editor.getFile()?.contents).toContain('line 50 changed\nNEW LINE');
      const lineNumbers = renderedLineNumbers(container);
      expect(new Set(lineNumbers).size).toBe(lineNumbers.length);
      // The collapsed gap stays collapsed across the full re-render.
      expect(lineNumbers).not.toContain(30);
      const content = findAdditionContent(container);
      expect(content?.textContent).toContain('NEW LINE');
    } finally {
      await fixture.cleanup();
    }
  });
});
