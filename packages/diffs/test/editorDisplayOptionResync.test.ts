import { afterAll, describe, expect, spyOn, test } from 'bun:test';

import { File } from '../src/components/File';
import { FileDiff } from '../src/components/FileDiff';
import { DEFAULT_THEMES } from '../src/constants';
import { Editor } from '../src/editor/editor';
import { disposeHighlighter } from '../src/highlighter/shared_highlighter';
import type { DiffsHighlighter, FileContents } from '../src/types';
import { parseDiffFromFile } from '../src/utils/parseDiffFromFile';
import { installDom, wait, waitFor } from './domHarness';

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
  fileDiff: FileDiff<undefined>;
  // Toggles a display option and forces a re-render, exactly as the React bridge
  // does on any display-option change: setOptions(newOptions) then a forced
  // re-render. The bug report's headline trigger is the word-wrap toggle, but
  // display options (theme, line numbers, wrap) share the same forced-render
  // path; line numbers is used here because wrap measurement needs browser
  // layout APIs jsdom lacks. Display re-renders rebuild the columns in place,
  // so the editable content element keeps its identity.
  toggleDisplayOption(): Promise<void>;
  // Switches between split and unified rendering mid-edit. Unlike display
  // options, a diff-style switch builds a fresh code element for the target
  // style, so the editable content element is genuinely replaced — the case
  // the replacement-focus test exercises.
  toggleDiffStyle(): Promise<void>;
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
  const oldFile: FileContents = { name: 'edit.ts', contents: oldContents };
  const newFile: FileContents = { name: 'edit.ts', contents: newContents };
  const editor = new Editor<undefined>('file-diff');

  fileDiff.render({
    oldFile,
    newFile,
    fileContainer: container,
    forceRender: true,
  });
  editor.edit(fileDiff);

  // Deadline-based: the first fixture in a file pays the shared highlighter's
  // cold start, which can outlast any fixed number of macrotask turns on a
  // slow runner. The editor assigns the contentEditable property, which jsdom
  // does not reflect to the attribute, so poll the property.
  await waitFor(() => {
    const content = findAdditionContent(container);
    return content?.contentEditable === 'true';
  });

  return {
    container,
    editor,
    fileDiff,
    async toggleDisplayOption() {
      const disableLineNumbers = !(
        fileDiff.options.disableLineNumbers ?? false
      );
      fileDiff.setOptions({
        ...fileDiff.options,
        disableLineNumbers,
      });
      fileDiff.render({
        oldFile,
        newFile,
        fileContainer: container,
        forceRender: true,
      });
      // The forced re-render rebuilds the columns in place (the content
      // element is retained) and re-syncs the editor through an async
      // highlighter pass; wait for the option to land on the pre element
      // instead of a fixed sleep.
      await waitFor(() => {
        const pre = container.shadowRoot?.querySelector('pre');
        return (
          (pre?.hasAttribute('data-disable-line-numbers') ?? false) ===
          disableLineNumbers
        );
      });
      await wait(0);
    },
    async toggleDiffStyle() {
      const previousContent = findAdditionContent(container);
      fileDiff.setOptions({
        ...fileDiff.options,
        diffStyle: fileDiff.options.diffStyle === 'split' ? 'unified' : 'split',
      });
      fileDiff.render({
        oldFile,
        newFile,
        fileContainer: container,
        forceRender: true,
      });
      // The style switch builds a fresh code element, replacing the editable
      // content; wait for the replacement to be re-marked editable by the
      // async editor re-sync.
      await waitFor(() => {
        const content = findAdditionContent(container);
        return (
          content != null &&
          content !== previousContent &&
          content.contentEditable === 'true'
        );
      });
      await wait(0);
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
  test('keeps focus when replacement does not emit blur', async () => {
    const fixture = await createFixture('alpha\nbravo\n', 'alpha\nCHANGED\n');
    const { container, editor } = fixture;
    const focusTargets: HTMLElement[] = [];
    const focusSpy = spyOn(HTMLElement.prototype, 'focus').mockImplementation(
      function (this: HTMLElement) {
        focusTargets.push(this);
        this.dispatchEvent(new Event('focus'));
      }
    );

    try {
      editor.focus({ lineNumber: 1, preventScroll: true });
      // Focus can be deferred while the editor settles its first highlight
      // pass, and a deferred background pass may replace the additions column
      // once more before it lands — wait for focus to land on the current
      // column, then capture that element as the pre-toggle baseline.
      await waitFor(() => {
        const current = findAdditionContent(container);
        return current != null && focusTargets.at(-1) === current;
      });
      const content = findAdditionContent(container);
      if (content == null) {
        throw new Error('missing editable additions content');
      }
      expect(focusTargets.at(-1) === content).toBe(true);

      // Firefox and WebKit can remove the focused shadow subtree without a
      // blur event, so replacement detection must preserve the focus intent.
      // A diff-style switch is used because it genuinely replaces the
      // editable element; display-option re-renders keep it in place.
      await fixture.toggleDiffStyle();

      const replacement = findAdditionContent(container);
      expect(replacement == null).toBe(false);
      expect(replacement === content).toBe(false);
      // Focus restoration can trail the replacement by a deferred focus
      // retry; wait for it to settle before asserting the final target.
      await waitFor(() => focusTargets.at(-1) === replacement);
      expect(focusTargets.at(-1) === replacement).toBe(true);
    } finally {
      focusSpy.mockRestore();
      await fixture.cleanup();
    }
  });

  test('keeps the edited line text visible when a display option is toggled', async () => {
    // old/new differ so the additions column (the editor's target) renders; the
    // edit targets line 0 ("alpha"), an unchanged context line — the "rename a
    // function" case from the bug report.
    const fixture = await createFixture('alpha\nbravo\n', 'alpha\nCHANGED\n');
    const { container, editor } = fixture;

    try {
      typeAt(editor, 0, 5, 'X');
      await wait(0);
      expect(editor.getText()).toBe('alphaX\nCHANGED\n');
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

      expect(editor.getText()).toBe('alphaXY\nCHANGED\n');
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
      expect(editor.getText()).toBe('alpha\nCHANGED\n');
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
      expect(editor.getText()).toBe('alpha\nINSERTED\nCHANGED\n');
      expect(lineText(container, 1)).toBe('alpha');
      expect(lineText(container, 2)).toBe('INSERTED');

      await fixture.toggleDisplayOption();

      // Both the edited line and the inserted line must survive the re-render.
      expect(lineText(container, 1)).toBe('alpha');
      expect(lineText(container, 2)).toBe('INSERTED');
      expect(editor.getText()).toBe('alpha\nINSERTED\nCHANGED\n');
    } finally {
      await fixture.cleanup();
    }
  });

  // Exercises the fileDiff-prop path the React bridge uses when an options
  // update re-passes the same controlled input during an active edit session.
  test('keeps an inserted line when the host re-passes the same diff', async () => {
    const dom = installDom();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const fileDiff = new FileDiff<undefined>({
      disableFileHeader: true,
      theme: DEFAULT_THEMES,
      diffStyle: 'split',
    });
    const editor = new Editor<undefined>('file-diff');
    const oldContents = 'alpha\nbravo\n';
    const newContents = 'alpha\nCHANGED\n';
    const file = { name: 'edit.ts' };
    const externalDiff = parseDiffFromFile(
      { ...file, contents: oldContents },
      { ...file, contents: newContents }
    );

    fileDiff.render({
      fileDiff: externalDiff,
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

      // A display-option update re-passes the same controlled diff. The private
      // edit session remains the render source for its inserted line.
      fileDiff.setOptions({ ...fileDiff.options, disableLineNumbers: true });
      fileDiff.render({
        fileDiff: externalDiff,
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

// Waits for the editor to mark the additions column editable after an attach.
async function waitForEditable(container: HTMLElement): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt++) {
    const content = findAdditionContent(container);
    if (content != null && content.getAttribute('contenteditable') === 'true') {
      return;
    }
    await wait(0);
  }
}

describe('file editor: theme toggle mid-edit', () => {
  // The plain-file twin of "keeps focus when replacement does not emit blur":
  // File.applyFullRender rewrites the code columns' innerHTML, which destroys
  // the DOM focus state without a blur event. The render must capture focus
  // intent before the rewrite so __syncRenderView restores it — the same
  // capture FileDiff.applyHunksToDOM performs. Focus arrives here without a
  // caret (tab/pointer focus), so the selection-based fallback cannot restore
  // it and only the captured request can.
  test('restores focus when a theme toggle forces a full render', async () => {
    const dom = installDom();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const file = new File<undefined>({
      disableFileHeader: true,
      theme: DEFAULT_THEMES,
      themeType: 'light',
    });
    const fileContents: FileContents = {
      name: 'edit.ts',
      contents: 'alpha\nbravo\n',
    };
    const editor = new Editor<undefined>('file');
    file.render({
      file: fileContents,
      fileContainer: container,
      forceRender: true,
    });
    editor.edit(file);
    await waitFor(() => {
      const content = findAdditionContent(container);
      return content?.contentEditable === 'true';
    });

    const focusTargets: HTMLElement[] = [];
    const focusSpy = spyOn(HTMLElement.prototype, 'focus').mockImplementation(
      function (this: HTMLElement) {
        focusTargets.push(this);
        this.dispatchEvent(new Event('focus'));
      }
    );

    try {
      const content = findAdditionContent(container);
      if (content == null) {
        throw new Error('missing editable file content');
      }
      content.focus();
      await wait(10);
      expect(focusTargets.at(-1) === content).toBe(true);
      const focusCallsBeforeToggle = focusTargets.length;

      file.setOptions({ ...file.options, themeType: 'dark' });
      file.render({
        file: fileContents,
        fileContainer: container,
        forceRender: true,
      });
      // The theme swap re-highlights asynchronously before the full render
      // applies; wait for the editor to re-claim focus rather than for a
      // fixed number of turns.
      await waitFor(() => focusTargets.length > focusCallsBeforeToggle);

      expect(focusTargets.length).toBeGreaterThan(focusCallsBeforeToggle);
      const replacement = findAdditionContent(container);
      expect(replacement == null).toBe(false);
      expect(focusTargets.at(-1) === replacement).toBe(true);
    } finally {
      focusSpy.mockRestore();
      await wait(10);
      editor.cleanUp();
      file.cleanUp();
      dom.cleanup();
    }
  });
});

describe('diff editor: detach then re-attach', () => {
  // Mirrors the demo's Edit-mode toggle and surface switch: turning editing off
  // detaches the editor (editor.cleanUp), turning it back on re-attaches the
  // same instance (editor.edit). cleanUp tears down the tokenizer, so the
  // re-attach must rebuild it before any edit can render. Pre-fix cleanUp kept
  // the parsed document and its cacheKey, so __syncRenderView treated the
  // re-attach as "same file" and skipped the rebuild that creates the
  // tokenizer; #rerender then bailed on the missing tokenizer and edits never
  // reached the DOM, even though the model still recorded them.
  test('renders edits typed after a detach/re-attach cycle', async () => {
    const fixture = await createFixture('alpha\nbravo\n', 'alpha\nCHANGED\n');
    const { container, editor, fileDiff } = fixture;

    try {
      typeAt(editor, 0, 5, 'X');
      await wait(0);
      expect(lineText(container, 1)).toBe('alphaX');

      // Detach (Edit-mode off) then re-attach the same editor (Edit-mode on).
      editor.cleanUp();
      await wait(0);
      editor.edit(fileDiff);
      await waitForEditable(container);

      // A keystroke typed after the re-attach must paint into the DOM, not just
      // land in the model. Pre-fix the re-attach reused the stale document and
      // never rebuilt the tokenizer, so #rerender bailed: the model recorded the
      // edit (getState below) while the rendered line stayed stale.
      typeAt(editor, 1, 0, 'Q');
      await wait(0);
      expect(editor.getText()).toBe('alphaX\nQCHANGED\n');
      expect(lineText(container, 2)).toBe('QCHANGED');
    } finally {
      await fixture.cleanup();
    }
  });

  test('ignores a stale async editor sync after reset remounts the diff', async () => {
    const dom = installDom();
    const container = document.createElement('div');
    document.body.appendChild(container);

    const oldFile: FileContents = {
      name: 'edit.ts',
      contents: 'alpha\nbravo\n',
      cacheKey: 'old:initial',
    };
    const newFile: FileContents = {
      name: 'edit.ts',
      contents: 'alpha\nCHANGED\n',
      cacheKey: 'new:initial',
    };
    const editor = new Editor<undefined>('file-diff');
    const fileDiff = new FileDiff<undefined>(
      {
        disableFileHeader: true,
        theme: DEFAULT_THEMES,
        diffStyle: 'split',
      },
      undefined,
      true
    );

    let remountedFileDiff: FileDiff<undefined> | undefined;

    try {
      fileDiff.render({
        oldFile,
        newFile,
        fileContainer: container,
        forceRender: true,
      });
      editor.edit(fileDiff);
      await waitForEditable(container);

      typeAt(editor, 0, 5, 'X');
      await wait(0);
      expect(lineText(container, 1)).toBe('alphaX');

      const renderer = (
        fileDiff as unknown as {
          hunksRenderer: {
            initializeHighlighter(): Promise<DiffsHighlighter>;
          };
          syncRenderViewToEditor(): void;
        }
      ).hunksRenderer;
      const highlighter = await renderer.initializeHighlighter();
      let resolveStaleSync:
        | ((highlighter: DiffsHighlighter) => void)
        | undefined;
      renderer.initializeHighlighter = () =>
        new Promise<DiffsHighlighter>((resolve) => {
          resolveStaleSync = resolve;
        });

      // Queue an editor sync from the edited instance, then reset by unmounting
      // that instance and mounting a fresh diff with the original contents.
      (
        fileDiff as unknown as { syncRenderViewToEditor(): void }
      ).syncRenderViewToEditor();
      fileDiff.cleanUp();

      const remountedContainer = document.createElement('div');
      document.body.appendChild(remountedContainer);
      remountedFileDiff = new FileDiff<undefined>(
        {
          disableFileHeader: true,
          theme: DEFAULT_THEMES,
          diffStyle: 'split',
        },
        undefined,
        true
      );
      remountedFileDiff.render({
        oldFile: { ...oldFile, cacheKey: 'old:reset' },
        newFile: { ...newFile, cacheKey: 'new:reset' },
        fileContainer: remountedContainer,
        forceRender: true,
      });
      editor.edit(remountedFileDiff);
      await waitForEditable(remountedContainer);
      expect(lineText(remountedContainer, 1)).toBe('alpha');

      resolveStaleSync?.(highlighter);
      await wait(0);

      typeAt(editor, 1, 0, 'Q');
      await wait(0);

      expect(editor.getText()).toBe('alpha\nQCHANGED\n');
      expect(lineText(remountedContainer, 1)).toBe('alpha');
      expect(lineText(remountedContainer, 2)).toBe('QCHANGED');
    } finally {
      editor.cleanUp();
      remountedFileDiff?.cleanUp();
      dom.cleanup();
    }
  });
});
