import { afterAll, describe, expect, test } from 'bun:test';

import { File, type FileOptions } from '../src/components/File';
import { FileDiff } from '../src/components/FileDiff';
import { DEFAULT_THEMES } from '../src/constants';
import { Editor, type EditorOptions } from '../src/editor/editor';
import { disposeHighlighter } from '../src/highlighter/shared_highlighter';
import type { FileContents, LineRange } from '../src/types';
import { installDom, wait, waitFor } from './domHarness';

afterAll(async () => {
  await disposeHighlighter();
});

const FOLDABLE_CONTENTS = [
  'function outer() {',
  '  const before = 1;',
  '  if (before) {',
  '    console.log(before);',
  '  }',
  '  return before;',
  '}',
  'const after = true;',
].join('\n');

interface FileEditorFixture {
  cleanup(): void;
  container: HTMLElement;
  editor: Editor<undefined>;
  file: File<undefined>;
}

async function waitForEditableContent(container: HTMLElement): Promise<void> {
  const hasEditableContent = (): boolean =>
    [
      ...(container.shadowRoot?.querySelectorAll<HTMLElement>(
        '[data-content]'
      ) ?? []),
    ].some(
      (content) =>
        content.contentEditable === 'true' ||
        content.getAttribute('contenteditable') === 'true'
    );

  await waitFor(hasEditableContent, { timeout: 3000 });

  expect(hasEditableContent()).toBe(true);
}

interface FileEditorFixtureProps {
  editorOptions?: EditorOptions<undefined>;
  fileOptions?: Partial<FileOptions<undefined>>;
  contents?: string;
}

async function createFileEditorFixture({
  editorOptions,
  fileOptions,
  contents = FOLDABLE_CONTENTS,
}: FileEditorFixtureProps = {}): Promise<FileEditorFixture> {
  const dom = installDom();
  const container = document.createElement('div');
  document.body.appendChild(container);

  const file = new File<undefined>({
    disableFileHeader: true,
    theme: DEFAULT_THEMES,
    ...fileOptions,
  });
  const editor = new Editor<undefined>(editorOptions);
  const fileContents: FileContents = {
    name: 'foldable.ts',
    contents,
  };

  file.render({
    file: fileContents,
    fileContainer: container,
    forceRender: true,
  });
  editor.edit(file);
  await waitForEditableContent(container);

  return {
    cleanup() {
      editor.cleanUp();
      file.cleanUp();
      dom.cleanup();
    },
    container,
    editor,
    file,
  };
}

function shadowRoot(container: HTMLElement): ShadowRoot {
  const shadow = container.shadowRoot;
  if (shadow == null) {
    throw new Error('file container has no shadow root');
  }
  return shadow;
}

function renderedLineNumbers(container: HTMLElement): number[] {
  return [
    ...shadowRoot(container).querySelectorAll<HTMLElement>(
      '[data-content] > [data-line]'
    ),
  ].map((line) => Number(line.dataset.line));
}

function gutterRow(
  container: HTMLElement,
  oneIndexedLine: number
): HTMLElement {
  const row = shadowRoot(container).querySelector<HTMLElement>(
    `[data-column-number="${oneIndexedLine}"]`
  );
  if (row == null) {
    throw new Error(`no gutter row found for line ${oneIndexedLine}`);
  }
  return row;
}

function foldToggle(
  container: HTMLElement,
  oneIndexedLine: number
): HTMLButtonElement {
  const toggle = gutterRow(container, oneIndexedLine).querySelector(
    '[data-fold-toggle]'
  );
  if (!(toggle instanceof HTMLButtonElement)) {
    throw new Error(`no fold toggle found for line ${oneIndexedLine}`);
  }
  return toggle;
}

function foldIconHref(toggle: HTMLButtonElement): string | null {
  return toggle.querySelector('use')?.getAttribute('href') ?? null;
}

function foldIndicator(
  container: HTMLElement,
  oneIndexedLine: number
): HTMLElement {
  const indicator = shadowRoot(container).querySelector<HTMLElement>(
    `[data-content] > [data-line="${oneIndexedLine}"] > [data-fold-indicator]`
  );
  if (indicator == null) {
    throw new Error(`no fold indicator found for line ${oneIndexedLine}`);
  }
  return indicator;
}

function foldEllipsis(
  container: HTMLElement,
  oneIndexedLine: number
): HTMLButtonElement {
  const ellipsis = foldIndicator(container, oneIndexedLine).querySelector(
    '[data-fold-ellipsis]'
  );
  if (!(ellipsis instanceof HTMLButtonElement)) {
    throw new Error(`no fold ellipsis found for line ${oneIndexedLine}`);
  }
  return ellipsis;
}

function recordFoldRangeUpdates(file: File<undefined>): LineRange[][] {
  const updates: LineRange[][] = [];
  const setFoldRanges = file.__setFoldRanges.bind(file);
  file.__setFoldRanges = (ranges) => {
    updates.push(ranges.map((range) => ({ ...range })));
    setFoldRanges(ranges);
  };
  return updates;
}

async function waitForLines(
  container: HTMLElement,
  expected: number[]
): Promise<void> {
  await waitFor(
    () =>
      JSON.stringify(renderedLineNumbers(container)) ===
      JSON.stringify(expected),
    { timeout: 3000 }
  );
  expect(renderedLineNumbers(container)).toEqual(expected);
}

describe('editor folding on File', () => {
  test('is enabled by default and folds or unfolds a block from the gutter', async () => {
    const { cleanup, container } = await createFileEditorFixture();
    try {
      const shadow = shadowRoot(container);
      const firstGutterRow = gutterRow(container, 1);
      const foldZone = firstGutterRow.querySelector(':scope > [data-fold]');
      const initialToggle = foldToggle(container, 1);

      expect(shadow.querySelector('[data-code][data-folding]')).not.toBe(null);
      expect(foldZone?.parentElement).toBe(firstGutterRow);
      expect(firstGutterRow.closest('[data-gutter]')).not.toBe(null);
      expect(foldZone?.contains(initialToggle)).toBe(true);
      expect(initialToggle.getAttribute('aria-expanded')).toBe('true');
      expect(foldIconHref(initialToggle)).toBe('#diffs-icon-fold-chevron-down');

      initialToggle.focus();
      initialToggle.click();
      await waitForLines(container, [1, 7, 8]);

      const foldedToggle = foldToggle(container, 1);
      expect(shadow.activeElement).toBe(foldedToggle);
      expect(foldedToggle.hasAttribute('data-folded')).toBe(true);
      expect(foldedToggle.getAttribute('aria-expanded')).toBe('false');
      expect(foldIconHref(foldedToggle)).toBe('#diffs-icon-fold-chevron-right');

      const indicator = foldIndicator(container, 1);
      const ellipsis = foldEllipsis(container, 1);
      expect(indicator.parentElement?.dataset.line).toBe('1');
      expect(indicator.getAttribute('contenteditable')).toBe('false');
      expect(ellipsis.ariaLabel).toBe('Unfold line 1');
      expect(foldIconHref(ellipsis)).toBe('#diffs-icon-fold-ellipsis');
      expect(indicator.dataset.foldEndText).toBeUndefined();
      expect(indicator.children.length).toBe(1);
      expect(indicator.firstElementChild).toBe(ellipsis);
      expect(indicator.textContent).toBe('');

      ellipsis.click();
      await waitForLines(container, [1, 2, 3, 4, 5, 6, 7, 8]);
      expect(shadow.querySelector('[data-fold-indicator]')).toBe(null);

      const unfoldedToggle = foldToggle(container, 1);
      expect(shadow.activeElement).toBe(unfoldedToggle);
      expect(unfoldedToggle.hasAttribute('data-folded')).toBe(false);
      expect(foldIconHref(unfoldedToggle)).toBe(
        '#diffs-icon-fold-chevron-down'
      );
    } finally {
      cleanup();
    }
  });

  test('can be disabled through the file options', async () => {
    const { cleanup, container } = await createFileEditorFixture({
      fileOptions: { folding: false },
    });
    try {
      const shadow = shadowRoot(container);
      expect(shadow.querySelector('[data-code][data-folding]')).toBe(null);
      expect(shadow.querySelector('[data-fold]')).toBe(null);
      expect(shadow.querySelector('[data-fold-toggle]')).toBe(null);
      expect(renderedLineNumbers(container)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    } finally {
      cleanup();
    }
  });

  test('responds to folding option changes at runtime', async () => {
    const { cleanup, container, file } = await createFileEditorFixture({
      fileOptions: { folding: false },
    });
    const setFolding = (folding: boolean): void => {
      file.setOptions({ ...file.options, folding });
    };
    try {
      setFolding(true);
      await waitFor(() => foldToggle(container, 1) != null);

      foldToggle(container, 1).click();
      await waitForLines(container, [1, 7, 8]);

      setFolding(false);
      await waitForLines(container, [1, 2, 3, 4, 5, 6, 7, 8]);
      expect(shadowRoot(container).querySelector('[data-fold-toggle]')).toBe(
        null
      );

      setFolding(true);
      expect(foldToggle(container, 1)).toBeInstanceOf(HTMLButtonElement);
    } finally {
      cleanup();
    }
  });

  test('preserves a nested fold while its outer fold is toggled', async () => {
    const { cleanup, container } = await createFileEditorFixture();
    try {
      foldToggle(container, 3).click();
      await waitForLines(container, [1, 2, 3, 5, 6, 7, 8]);

      foldToggle(container, 1).click();
      await waitForLines(container, [1, 7, 8]);

      foldToggle(container, 1).click();
      await waitForLines(container, [1, 2, 3, 5, 6, 7, 8]);

      const nestedToggle = foldToggle(container, 3);
      expect(nestedToggle.hasAttribute('data-folded')).toBe(true);
      expect(foldIconHref(nestedToggle)).toBe('#diffs-icon-fold-chevron-right');

      nestedToggle.click();
      await waitForLines(container, [1, 2, 3, 4, 5, 6, 7, 8]);
    } finally {
      cleanup();
    }
  });

  test('round-trips nested fold state and ignores stale ranges', async () => {
    const { cleanup, container, editor } = await createFileEditorFixture();
    try {
      foldToggle(container, 3).click();
      await waitForLines(container, [1, 2, 3, 5, 6, 7, 8]);
      foldToggle(container, 1).click();
      await waitForLines(container, [1, 7, 8]);

      expect(editor.getState().foldRanges).toEqual([
        { startLine: 0, endLine: 5 },
        { startLine: 2, endLine: 3 },
      ]);

      editor.setState({ foldRanges: [] });
      await waitForLines(container, [1, 2, 3, 4, 5, 6, 7, 8]);

      editor.setState({
        foldRanges: [
          { startLine: 0, endLine: 6 },
          { startLine: 2, endLine: 3 },
          { startLine: 0, endLine: 5 },
          { startLine: 2, endLine: 4 },
          { startLine: 2, endLine: 3 },
          { startLine: -1, endLine: 5 },
          { startLine: 7, endLine: 9 },
        ],
      });
      await waitForLines(container, [1, 7, 8]);
      expect(editor.getState().foldRanges).toEqual([
        { startLine: 0, endLine: 5 },
        { startLine: 2, endLine: 3 },
      ]);

      foldToggle(container, 1).click();
      await waitForLines(container, [1, 2, 3, 5, 6, 7, 8]);
      expect(foldToggle(container, 3).hasAttribute('data-folded')).toBe(true);
    } finally {
      cleanup();
    }
  });

  test('reveals a folded caret restored through setState', async () => {
    const { cleanup, container, editor } = await createFileEditorFixture();
    try {
      foldToggle(container, 1).click();
      await waitForLines(container, [1, 7, 8]);

      editor.setState({
        selections: [
          {
            start: { line: 3, character: 4 },
            end: { line: 3, character: 4 },
            direction: 0,
          },
        ],
      });

      await waitForLines(container, [1, 2, 3, 4, 5, 6, 7, 8]);
      expect(editor.getState().selections?.at(-1)?.start).toEqual({
        line: 3,
        character: 4,
      });
    } finally {
      cleanup();
    }
  });

  test('keeps a fold when restoring a caret on its visible delimiter', async () => {
    const { cleanup, container, editor } = await createFileEditorFixture();
    try {
      foldToggle(container, 1).click();
      await waitForLines(container, [1, 7, 8]);

      editor.setState({
        foldRanges: [{ startLine: 0, endLine: 5 }],
        selections: [
          {
            start: { line: 6, character: 0 },
            end: { line: 6, character: 0 },
            direction: 0,
          },
        ],
      });

      await waitForLines(container, [1, 7, 8]);
      expect(editor.getState().foldRanges).toEqual([
        { startLine: 0, endLine: 5 },
      ]);
      expect(editor.getState().selections?.at(-1)?.start).toEqual({
        line: 6,
        character: 0,
      });
    } finally {
      cleanup();
    }
  });

  test('keeps a fold between line-changing edits in a net-zero batch', async () => {
    const contents = [
      'const first = {',
      '  value: 1,',
      '};',
      'const middle = true;',
      'const second = {',
      '  value: 2,',
      '};',
      'removeMe();',
      'keepMe();',
    ].join('\n');
    const { cleanup, container, editor } = await createFileEditorFixture({
      contents,
    });
    try {
      foldToggle(container, 5).click();
      await waitForLines(container, [1, 2, 3, 4, 5, 7, 8, 9]);

      editor.applyEdits([
        {
          range: {
            start: { line: 3, character: 0 },
            end: { line: 3, character: 0 },
          },
          newText: 'inserted();\n',
        },
        {
          range: {
            start: { line: 7, character: 0 },
            end: { line: 8, character: 0 },
          },
          newText: '',
        },
      ]);

      await waitForLines(container, [1, 2, 3, 4, 5, 6, 8, 9]);
      const shiftedToggle = foldToggle(container, 6);
      expect(shiftedToggle.hasAttribute('data-folded')).toBe(true);
      expect(foldIconHref(shiftedToggle)).toBe(
        '#diffs-icon-fold-chevron-right'
      );
    } finally {
      cleanup();
    }
  });

  test('shifts a fold when a newline is inserted before its header', async () => {
    const { cleanup, container, editor } = await createFileEditorFixture();
    try {
      foldToggle(container, 1).click();
      await waitForLines(container, [1, 7, 8]);
      let foldRangesDuringChange: LineRange[] | undefined;
      editor.setOptions({
        onChange: () => {
          foldRangesDuringChange = editor.getState().foldRanges;
        },
      });

      editor.applyEdits([
        {
          range: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 0 },
          },
          newText: '\n',
        },
      ]);

      await waitForLines(container, [1, 2, 8, 9]);
      const shiftedToggle = foldToggle(container, 2);
      expect(shiftedToggle.hasAttribute('data-folded')).toBe(true);
      expect(foldIconHref(shiftedToggle)).toBe(
        '#diffs-icon-fold-chevron-right'
      );
      expect(foldRangesDuringChange).toEqual([{ startLine: 1, endLine: 6 }]);
      expect(editor.getState().foldRanges).toEqual([
        { startLine: 1, endLine: 6 },
      ]);
    } finally {
      cleanup();
    }
  });

  test('shifts a fold when whole lines are deleted before its header', async () => {
    const { cleanup, container, editor } = await createFileEditorFixture({
      contents: `removeMe();\n${FOLDABLE_CONTENTS}`,
    });
    try {
      foldToggle(container, 2).click();
      await waitForLines(container, [1, 2, 8, 9]);

      editor.applyEdits([
        {
          range: {
            start: { line: 0, character: 0 },
            end: { line: 1, character: 0 },
          },
          newText: '',
        },
      ]);

      await waitForLines(container, [1, 7, 8]);
      expect(foldToggle(container, 1).hasAttribute('data-folded')).toBe(true);
      expect(editor.getState().foldRanges).toEqual([
        { startLine: 0, endLine: 5 },
      ]);
    } finally {
      cleanup();
    }
  });

  test('retains active fold controls across ordinary character edits', async () => {
    const { cleanup, container, editor, file } =
      await createFileEditorFixture();
    try {
      foldToggle(container, 1).click();
      await waitForLines(container, [1, 7, 8]);
      await wait(0);

      const outerToggle = foldToggle(container, 1);
      const outerIndicator = foldIndicator(container, 1);
      const foldRangeUpdates = recordFoldRangeUpdates(file);

      editor.applyEdits([
        {
          range: {
            start: { line: 0, character: 9 },
            end: { line: 0, character: 14 },
          },
          newText: 'inner',
        },
      ]);

      await waitFor(() => editor.getText().includes('function inner() {'));
      expect(foldToggle(container, 1)).toBe(outerToggle);
      expect(foldIndicator(container, 1)).toBe(outerIndicator);
      expect(outerToggle.isConnected).toBe(true);
      expect(outerToggle.hasAttribute('data-folded')).toBe(true);
      expect(foldRangeUpdates).toEqual([]);
    } finally {
      cleanup();
    }
  });

  test('recomputes a fold when its closing delimiter gains a suffix', async () => {
    const { cleanup, container, editor } = await createFileEditorFixture({
      contents: ['section {', '  child', '', '}', 'after'].join('\n'),
    });
    try {
      foldToggle(container, 1).click();
      await waitForLines(container, [1, 4, 5]);

      editor.applyEdits([
        {
          range: {
            start: { line: 3, character: 1 },
            end: { line: 3, character: 1 },
          },
          newText: ' // comment',
        },
      ]);

      await waitForLines(container, [1, 3, 4, 5]);
      expect(editor.getState().foldRanges).toEqual([
        { startLine: 0, endLine: 1 },
      ]);
    } finally {
      cleanup();
    }
  });

  test('syncs each fold toggle to the host once', async () => {
    const { cleanup, container, file } = await createFileEditorFixture();
    try {
      const foldRangeUpdates = recordFoldRangeUpdates(file);

      foldToggle(container, 1).click();
      await waitForLines(container, [1, 7, 8]);
      await wait(0);
      expect(foldRangeUpdates).toEqual([[{ startLine: 1, endLine: 5 }]]);

      foldRangeUpdates.length = 0;
      foldToggle(container, 1).click();
      await waitForLines(container, [1, 2, 3, 4, 5, 6, 7, 8]);
      await wait(0);
      expect(foldRangeUpdates).toEqual([[]]);
    } finally {
      cleanup();
    }
  });
});

describe('editor folding on FileDiff', () => {
  test('does not render fold controls even when folding is enabled', async () => {
    const dom = installDom();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const fileDiff = new FileDiff<undefined>({
      disableFileHeader: true,
      diffStyle: 'split',
      theme: DEFAULT_THEMES,
      folding: true,
    });
    const editor = new Editor<undefined>();
    const oldFile: FileContents = {
      name: 'foldable.ts',
      contents: FOLDABLE_CONTENTS,
    };
    const newFile: FileContents = {
      name: 'foldable.ts',
      contents: FOLDABLE_CONTENTS.replace(
        '  return before;',
        '  return before + 1;'
      ),
    };

    try {
      fileDiff.render({
        oldFile,
        newFile,
        fileContainer: container,
        forceRender: true,
      });
      editor.edit(fileDiff);
      await waitForEditableContent(container);

      const shadow = shadowRoot(container);
      expect(shadow.querySelector('[data-code][data-folding]')).toBe(null);
      expect(shadow.querySelector('[data-fold]')).toBe(null);
      expect(shadow.querySelector('[data-fold-toggle]')).toBe(null);
    } finally {
      await wait(10);
      editor.cleanUp();
      fileDiff.cleanUp();
      dom.cleanup();
    }
  });
});
