import { afterAll, describe, expect, test } from 'bun:test';

import { File } from '../src/components/File';
import { FileDiff } from '../src/components/FileDiff';
import { DEFAULT_THEMES } from '../src/constants';
import { Editor, type IStateStorage } from '../src/edit';
import { disposeHighlighter } from '../src/highlighter/shared_highlighter';
import type { EditorState, FileContents, LineRange } from '../src/types';
import { installDom, wait, waitFor } from './domHarness';

afterAll(async () => {
  await disposeHighlighter();
});

const ORIGINAL_FILE: FileContents = {
  name: 'persisted.ts',
  contents: 'alpha\nbravo\n',
  cacheKey: 'persisted.ts',
};

const FOLDABLE_FILE: FileContents = {
  name: 'foldable.ts',
  contents: [
    'function outer() {',
    '  const before = 1;',
    '  if (before) {',
    '    console.log(before);',
    '  }',
    '  return before;',
    '}',
    'const after = true;',
  ].join('\n'),
  cacheKey: 'foldable.ts',
};

interface AttachedFile {
  container: HTMLElement;
  file: File<undefined>;
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

async function attachFile(
  editor: Editor<undefined>,
  fileContents: FileContents
): Promise<AttachedFile> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const file = new File<undefined>({
    disableErrorHandling: true,
    disableFileHeader: true,
    theme: DEFAULT_THEMES,
  });

  file.render({
    file: fileContents,
    fileContainer: container,
    forceRender: true,
  });
  editor.edit(file);
  await waitFor(() => {
    const content = container.shadowRoot?.querySelector('[data-content]');
    return (
      content instanceof HTMLElement &&
      (content.contentEditable === 'true' ||
        content.getAttribute('contenteditable') === 'true')
    );
  });

  return { container, file };
}

async function renderFile(
  editor: Editor<undefined>,
  attached: AttachedFile,
  fileContents: FileContents
): Promise<void> {
  attached.file.render({
    file: fileContents,
    fileContainer: attached.container,
    forceRender: true,
  });
  await waitFor(() => {
    const file = editor.getFile();
    return (
      file?.name === fileContents.name &&
      file.cacheKey === fileContents.cacheKey
    );
  });
}

function savedCaret(character: number): EditorState {
  return {
    selections: [
      {
        start: { line: 0, character },
        end: { line: 0, character },
        direction: 0,
      },
    ],
  };
}

function foldToggle(
  attached: AttachedFile,
  oneIndexedLine: number
): HTMLButtonElement {
  const toggle = attached.container.shadowRoot?.querySelector(
    `[data-column-number="${oneIndexedLine}"] [data-fold-toggle]`
  );
  if (!(toggle instanceof HTMLButtonElement)) {
    throw new Error(`no fold toggle found for line ${oneIndexedLine}`);
  }
  return toggle;
}

function renderedLineNumbers(attached: AttachedFile): number[] {
  return [
    ...(attached.container.shadowRoot?.querySelectorAll<HTMLElement>(
      '[data-content] > [data-line]'
    ) ?? []),
  ].map((line) => Number(line.dataset.line));
}

async function waitForFoldRanges(
  editor: Editor<undefined>,
  expected: LineRange[]
): Promise<void> {
  await waitFor(
    () =>
      JSON.stringify(editor.getState().foldRanges) === JSON.stringify(expected)
  );
  expect(editor.getState().foldRanges).toEqual(expected);
}

describe('Editor persisted state lifecycle', () => {
  test('restores nested folds after switching files', async () => {
    const dom = installDom();
    const editor = new Editor<undefined>({ persistState: true });
    let attached: AttachedFile | undefined;
    const nestedFold = { startLine: 2, endLine: 3 };
    const outerFold = { startLine: 0, endLine: 5 };

    try {
      attached = await attachFile(editor, { ...FOLDABLE_FILE });

      foldToggle(attached, 3).click();
      await waitForFoldRanges(editor, [nestedFold]);
      foldToggle(attached, 1).click();
      await waitForFoldRanges(editor, [outerFold, nestedFold]);

      await renderFile(editor, attached, {
        name: 'next.ts',
        contents: 'next\n',
        cacheKey: 'next.ts',
      });
      await renderFile(editor, attached, { ...FOLDABLE_FILE });

      await waitForFoldRanges(editor, [outerFold, nestedFold]);
      expect(renderedLineNumbers(attached)).toEqual([1, 7, 8]);

      foldToggle(attached, 1).click();
      await waitForFoldRanges(editor, [nestedFold]);
      expect(renderedLineNumbers(attached)).toEqual([1, 2, 3, 5, 6, 7, 8]);
    } finally {
      editor.cleanUp();
      attached?.file.cleanUp();
      dom.cleanup();
    }
  });

  test('a pending async restore cannot overwrite a newer fold toggle', async () => {
    const dom = installDom();
    const pendingState = createDeferred<EditorState | undefined>();
    const storage: IStateStorage = {
      get() {
        return pendingState.promise;
      },
      set() {},
    };
    const editor = new Editor<undefined>({
      persistState: true,
      persistStateStorage: storage,
    });
    let attached: AttachedFile | undefined;
    const nestedFold = { startLine: 2, endLine: 3 };

    try {
      attached = await attachFile(editor, { ...FOLDABLE_FILE });

      foldToggle(attached, 3).click();
      await waitForFoldRanges(editor, [nestedFold]);

      pendingState.resolve({
        foldRanges: [{ startLine: 0, endLine: 5 }],
      });
      await wait(0);

      expect(editor.getState().foldRanges).toEqual([nestedFold]);
      expect(renderedLineNumbers(attached)).toEqual([1, 2, 3, 5, 6, 7, 8]);
    } finally {
      editor.cleanUp();
      attached?.file.cleanUp();
      dom.cleanup();
    }
  });

  test('an async restore survives an unchanged file rerender', async () => {
    const dom = installDom();
    const pendingState = createDeferred<EditorState | undefined>();
    const gets: string[] = [];
    const sets: string[] = [];
    const storage: IStateStorage = {
      get(cacheKey) {
        gets.push(cacheKey);
        return pendingState.promise;
      },
      set(cacheKey) {
        sets.push(cacheKey);
      },
    };
    const editor = new Editor<undefined>({
      persistState: true,
      persistStateStorage: storage,
    });
    let attached: AttachedFile | undefined;

    try {
      attached = await attachFile(editor, { ...ORIGINAL_FILE });
      await waitFor(() => gets.length === 1);

      await renderFile(editor, attached, { ...ORIGINAL_FILE });
      pendingState.resolve(savedCaret(3));
      await waitFor(
        () => editor.getState().selections?.[0]?.start.character === 3
      );

      expect(gets).toEqual(['persisted.ts']);
      expect(sets).toEqual([]);
      expect(editor.getState().selections).toEqual(savedCaret(3).selections);
    } finally {
      editor.cleanUp();
      attached?.file.cleanUp();
      dom.cleanup();
    }
  });

  test('a stale async restore cannot overwrite the next file state', async () => {
    const dom = installDom();
    const pendingState = createDeferred<EditorState | undefined>();
    const storage: IStateStorage = {
      get(cacheKey) {
        return cacheKey === 'persisted.ts' ? pendingState.promise : undefined;
      },
      set() {},
    };
    const editor = new Editor<undefined>({
      persistState: true,
      persistStateStorage: storage,
    });
    let attached: AttachedFile | undefined;

    try {
      attached = await attachFile(editor, { ...ORIGINAL_FILE });
      await renderFile(editor, attached, {
        name: 'next.ts',
        contents: 'zulu\n',
        cacheKey: 'next.ts',
      });
      editor.setSelections([
        {
          start: { line: 0, character: 1 },
          end: { line: 0, character: 1 },
          direction: 'none',
        },
      ]);

      pendingState.resolve(savedCaret(4));
      await wait(0);

      expect(editor.getFile()?.name).toBe('next.ts');
      expect(editor.getState().selections).toEqual(savedCaret(1).selections);
    } finally {
      editor.cleanUp();
      attached?.file.cleanUp();
      dom.cleanup();
    }
  });

  test('leaving during the first read does not clobber stored state', async () => {
    const dom = installDom();
    const pendingRead = createDeferred<EditorState | undefined>();
    const storedState = savedCaret(4);
    const states = new Map<string, EditorState>([['saved.ts', storedState]]);
    let delayedReadStarted = false;
    const storage: IStateStorage = {
      get(cacheKey) {
        if (cacheKey === 'saved.ts' && !delayedReadStarted) {
          delayedReadStarted = true;
          return pendingRead.promise;
        }
        return states.get(cacheKey);
      },
      set(cacheKey, state) {
        states.set(cacheKey, state);
      },
    };
    const editor = new Editor<undefined>({
      persistState: true,
      persistStateStorage: storage,
    });
    let attached: AttachedFile | undefined;

    try {
      attached = await attachFile(editor, { ...ORIGINAL_FILE });
      await renderFile(editor, attached, {
        name: 'saved.ts',
        contents: 'saved\n',
        cacheKey: 'saved.ts',
      });
      await waitFor(() => delayedReadStarted);

      await renderFile(editor, attached, {
        name: 'next.ts',
        contents: 'next\n',
        cacheKey: 'next.ts',
      });
      pendingRead.resolve(storedState);
      await wait(0);

      expect(states.get('saved.ts')).toEqual(storedState);

      await renderFile(editor, attached, {
        name: 'saved.ts',
        contents: 'saved\n',
        cacheKey: 'saved.ts',
      });
      expect(editor.getState().selections).toEqual(storedState.selections);
    } finally {
      editor.cleanUp();
      attached?.file.cleanUp();
      dom.cleanup();
    }
  });

  test('serializes delayed writes so the newest state wins', async () => {
    const dom = installDom();
    const firstWrite = createDeferred<void>();
    const secondWrite = createDeferred<void>();
    const writeGates = [firstWrite, secondWrite];
    const writes: EditorState[] = [];
    const states = new Map<string, EditorState>();
    const storage: IStateStorage = {
      get(cacheKey) {
        return states.get(cacheKey);
      },
      set(cacheKey, state) {
        if (cacheKey !== 'persisted.ts') {
          states.set(cacheKey, state);
          return;
        }
        const gate = writeGates[writes.length];
        if (gate === undefined) {
          throw new Error('unexpected persisted.ts write');
        }
        writes.push(state);
        return gate.promise.then(() => {
          states.set(cacheKey, state);
        });
      },
    };
    const editor = new Editor<undefined>({
      persistState: true,
      persistStateStorage: storage,
    });
    let attached: AttachedFile | undefined;

    try {
      attached = await attachFile(editor, { ...ORIGINAL_FILE });
      editor.setSelections([
        {
          start: { line: 0, character: 1 },
          end: { line: 0, character: 1 },
          direction: 'none',
        },
      ]);
      await renderFile(editor, attached, {
        name: 'next.ts',
        contents: 'next\n',
        cacheKey: 'next.ts',
      });

      await renderFile(editor, attached, { ...ORIGINAL_FILE });
      editor.setSelections([
        {
          start: { line: 0, character: 2 },
          end: { line: 0, character: 2 },
          direction: 'none',
        },
      ]);
      await renderFile(editor, attached, {
        name: 'next.ts',
        contents: 'next\n',
        cacheKey: 'next.ts',
      });

      expect(writes).toHaveLength(1);
      secondWrite.resolve();
      firstWrite.resolve();
      await waitFor(
        () => states.get('persisted.ts')?.selections?.[0]?.start.character === 2
      );

      expect(writes).toHaveLength(2);
      expect(states.get('persisted.ts')?.selections).toEqual(
        savedCaret(2).selections
      );

      await renderFile(editor, attached, { ...ORIGINAL_FILE });
      expect(editor.getState().selections).toEqual(savedCaret(2).selections);
    } finally {
      editor.cleanUp();
      attached?.file.cleanUp();
      dom.cleanup();
    }
  });

  test('full cleanup restores cached text into a fresh File mount', async () => {
    const dom = installDom();
    const editor = new Editor<undefined>({ persistState: true });
    let first: AttachedFile | undefined;
    let second: AttachedFile | undefined;

    try {
      first = await attachFile(editor, { ...ORIGINAL_FILE });
      editor.applyEdits(
        [
          {
            range: {
              start: { line: 0, character: 0 },
              end: { line: 0, character: 0 },
            },
            newText: 'X',
          },
        ],
        true
      );

      editor.cleanUp();
      first.file.cleanUp();
      first = undefined;

      second = await attachFile(editor, { ...ORIGINAL_FILE });
      await waitFor(
        () =>
          second?.container.shadowRoot?.querySelector(
            '[data-content] [data-line="1"]'
          )?.textContent === 'Xalpha'
      );

      expect(editor.getText()).toBe('Xalpha\nbravo\n');
      expect(
        second.container.shadowRoot?.querySelector(
          '[data-content] [data-line="1"]'
        )?.textContent
      ).toBe('Xalpha');
      expect(editor.canUndo).toBe(true);
    } finally {
      editor.cleanUp();
      first?.file.cleanUp();
      second?.file.cleanUp();
      dom.cleanup();
    }
  });

  test('a rename with the same cache key keeps text, state, and history', async () => {
    const dom = installDom();
    const editor = new Editor<undefined>({ persistState: true });
    let attached: AttachedFile | undefined;

    try {
      attached = await attachFile(editor, {
        ...ORIGINAL_FILE,
        cacheKey: 'logical-file',
      });
      editor.applyEdits(
        [
          {
            range: {
              start: { line: 0, character: 0 },
              end: { line: 0, character: 0 },
            },
            newText: 'X',
          },
        ],
        true
      );
      editor.setSelections([
        {
          start: { line: 0, character: 3 },
          end: { line: 0, character: 3 },
          direction: 'none',
        },
      ]);

      await renderFile(editor, attached, {
        ...ORIGINAL_FILE,
        name: 'renamed.ts',
        cacheKey: 'logical-file',
      });
      await waitFor(
        () =>
          editor.getFile()?.name === 'renamed.ts' &&
          editor.getText() === 'Xalpha\nbravo\n'
      );

      expect(editor.getState().selections).toEqual(savedCaret(3).selections);
      expect(editor.canUndo).toBe(true);
    } finally {
      editor.cleanUp();
      attached?.file.cleanUp();
      dom.cleanup();
    }
  });

  test('repeated recycle cleanup preserves state restoration', async () => {
    const dom = installDom();
    const editor = new Editor<undefined>({ persistState: true });
    let first: AttachedFile | undefined;
    let second: AttachedFile | undefined;

    try {
      first = await attachFile(editor, { ...ORIGINAL_FILE });
      editor.setSelections([
        {
          start: { line: 0, character: 2 },
          end: { line: 0, character: 2 },
          direction: 'none',
        },
      ]);

      editor.cleanUp(true);
      // A repeated teardown has no attached instance, but must not erase the
      // state-restoration request captured by the first cleanup.
      editor.cleanUp(true);
      first.file.cleanUp(true);
      first = undefined;

      second = await attachFile(editor, { ...ORIGINAL_FILE });

      expect(editor.getState().selections).toEqual(savedCaret(2).selections);
    } finally {
      editor.cleanUp();
      first?.file.cleanUp();
      second?.file.cleanUp();
      dom.cleanup();
    }
  });

  // Renders a file inside a scrollable wrapper (the editor's default viewport
  // is its nearest overflow-y:auto ancestor) so the restore path's scroll
  // behavior is observable. The wrapper starts scrolled away from 0,0 as if a
  // previously open file had left an offset behind.
  function attachFileInScrolledViewport(
    editor: Editor<undefined>,
    fileContents: FileContents
  ): AttachedFile & { viewport: HTMLElement } {
    const viewport = document.createElement('div');
    viewport.style.overflowY = 'auto';
    document.body.appendChild(viewport);
    const container = document.createElement('div');
    viewport.appendChild(container);
    viewport.scrollTop = 40;
    viewport.scrollLeft = 8;

    const file = new File<undefined>({
      disableErrorHandling: true,
      disableFileHeader: true,
      theme: DEFAULT_THEMES,
    });
    file.render({
      file: fileContents,
      fileContainer: container,
      forceRender: true,
    });
    editor.edit(file);
    return { container, file, viewport };
  }

  test('a missing state record resets the viewport scroll to 0,0', async () => {
    const dom = installDom();
    const storage: IStateStorage = {
      get: () => undefined,
      set() {},
    };
    const editor = new Editor<undefined>({
      persistState: true,
      persistStateStorage: storage,
    });
    let attached: (AttachedFile & { viewport: HTMLElement }) | undefined;

    try {
      attached = attachFileInScrolledViewport(editor, {
        ...ORIGINAL_FILE,
      });
      const { viewport } = attached;
      // The reset targets the viewport's vertical position (and the code
      // scroller's own horizontal offset); the viewport's scrollLeft is left
      // to the host.
      await waitFor(() => viewport.scrollTop === 0);
    } finally {
      editor.cleanUp();
      attached?.file.cleanUp();
      dom.cleanup();
    }
  });

  test('a record with scrollTop restores the viewport position', async () => {
    const dom = installDom();
    const storage: IStateStorage = {
      get: () => ({ ...savedCaret(3), view: { scrollLeft: 0, scrollTop: 25 } }),
      set() {},
    };
    const editor = new Editor<undefined>({
      persistState: true,
      persistStateStorage: storage,
    });
    let attached: (AttachedFile & { viewport: HTMLElement }) | undefined;

    try {
      attached = attachFileInScrolledViewport(editor, {
        ...ORIGINAL_FILE,
      });
      const { viewport } = attached;
      await waitFor(() => viewport.scrollTop === 25);
    } finally {
      editor.cleanUp();
      attached?.file.cleanUp();
      dom.cleanup();
    }
  });

  // The shared-editor pattern (e.g. an EditProvider handing every keyed
  // surface the same Editor): the outgoing surface's cleanUp persists its
  // record into the editor's per-instance storage, and re-attaching a new
  // surface for the same cacheKey restores it — including the viewport's
  // vertical position.
  test('a reused editor restores viewport scrollTop across surface remounts', async () => {
    const dom = installDom();
    const editor = new Editor<undefined>({ persistState: true });
    let attached: (AttachedFile & { viewport: HTMLElement }) | undefined;
    let reattached: (AttachedFile & { viewport: HTMLElement }) | undefined;

    try {
      attached = attachFileInScrolledViewport(editor, {
        ...ORIGINAL_FILE,
      });
      // First visit has no record: the viewport resets to 0. Then the user
      // scrolls, and leaving the file persists that position.
      await waitFor(() => attached!.viewport.scrollTop === 0);
      attached.viewport.scrollTop = 33;
      editor.cleanUp();
      attached.file.cleanUp();

      reattached = attachFileInScrolledViewport(editor, {
        ...ORIGINAL_FILE,
      });
      await waitFor(() => reattached!.viewport.scrollTop === 33);
    } finally {
      editor.cleanUp();
      attached?.file.cleanUp();
      reattached?.file.cleanUp();
      dom.cleanup();
    }
  });

  // A user scroll while an async read is in flight is signalled by its input
  // event (wheel/touch/pointer press); the late restore must leave the
  // user's vertical position alone while still applying selections.
  test('a user scroll during an async read wins over the restored scrollTop', async () => {
    const dom = installDom();
    const pendingState = createDeferred<EditorState | undefined>();
    const gets: string[] = [];
    const storage: IStateStorage = {
      get(cacheKey) {
        gets.push(cacheKey);
        return pendingState.promise;
      },
      set() {},
    };
    const editor = new Editor<undefined>({
      persistState: true,
      persistStateStorage: storage,
    });
    let attached: (AttachedFile & { viewport: HTMLElement }) | undefined;

    try {
      attached = attachFileInScrolledViewport(editor, { ...ORIGINAL_FILE });
      const { viewport } = attached;
      await waitFor(() => gets.length === 1);

      viewport.dispatchEvent(new Event('wheel'));
      viewport.scrollTop = 77;
      pendingState.resolve({
        ...savedCaret(3),
        view: { scrollLeft: 0, scrollTop: 25 },
      });
      await waitFor(
        () => editor.getState().selections?.[0]?.start.character === 3
      );
      expect(editor.getState().selections).toEqual(savedCaret(3).selections);
      expect(viewport.scrollTop).toBe(77);
    } finally {
      editor.cleanUp();
      attached?.file.cleanUp();
      dom.cleanup();
    }
  });

  // The counterpart: scrollTop moved by layout work alone (no input event —
  // height reconciliation, clamping) must not block the async restore.
  test('a layout-driven scroll change does not block the async scrollTop restore', async () => {
    const dom = installDom();
    const pendingState = createDeferred<EditorState | undefined>();
    const gets: string[] = [];
    const storage: IStateStorage = {
      get(cacheKey) {
        gets.push(cacheKey);
        return pendingState.promise;
      },
      set() {},
    };
    const editor = new Editor<undefined>({
      persistState: true,
      persistStateStorage: storage,
    });
    let attached: (AttachedFile & { viewport: HTMLElement }) | undefined;

    try {
      attached = attachFileInScrolledViewport(editor, { ...ORIGINAL_FILE });
      const { viewport } = attached;
      await waitFor(() => gets.length === 1);

      viewport.scrollTop = 5;
      pendingState.resolve({
        ...savedCaret(3),
        view: { scrollLeft: 0, scrollTop: 25 },
      });
      await waitFor(() => viewport.scrollTop === 25);
      expect(viewport.scrollTop).toBe(25);
      expect(editor.getState().selections).toEqual(savedCaret(3).selections);
    } finally {
      editor.cleanUp();
      attached?.file.cleanUp();
      dom.cleanup();
    }
  });

  // Diffs persist only their serializable state, keyed by the cacheKey
  // parseDiffFromFile derives from the file pair. A first attach has no
  // record (reset to 0,0); a later fresh editor + fresh FileDiff for the same
  // pair restores the persisted viewport position.
  test('with persistState, a diff resets on first attach and restores on revisit', async () => {
    const dom = installDom();
    const editor = new Editor<undefined>({ persistState: true });
    const viewport = document.createElement('div');
    viewport.style.overflowY = 'auto';
    document.body.appendChild(viewport);
    const container = document.createElement('div');
    viewport.appendChild(container);
    viewport.scrollTop = 40;
    viewport.scrollLeft = 8;

    const oldFile: FileContents = { name: 'diffed.ts', contents: 'alpha\n' };
    const newFile: FileContents = {
      name: 'diffed.ts',
      contents: 'alpha\nbravo\n',
    };
    const fileDiff = new FileDiff<undefined>({
      disableErrorHandling: true,
      disableFileHeader: true,
      theme: DEFAULT_THEMES,
    });
    const revisitDiff = new FileDiff<undefined>({
      disableErrorHandling: true,
      disableFileHeader: true,
      theme: DEFAULT_THEMES,
    });
    try {
      fileDiff.render({
        oldFile,
        newFile,
        fileContainer: container,
        forceRender: true,
      });
      editor.edit(fileDiff);
      await waitFor(() => viewport.scrollTop === 0);

      // Scroll the diff, tear the surface down, and revisit the same pair on
      // a fresh component with the same editor — its record must restore the
      // position.
      viewport.scrollTop = 27;
      editor.cleanUp();
      fileDiff.cleanUp();
      container.innerHTML = '';
      viewport.scrollTop = 5;

      revisitDiff.render({
        oldFile,
        newFile,
        fileContainer: container,
        forceRender: true,
      });
      editor.edit(revisitDiff);
      await waitFor(() => viewport.scrollTop === 27);
    } finally {
      editor.cleanUp();
      fileDiff.cleanUp();
      revisitDiff.cleanUp();
      dom.cleanup();
    }
  });

  // A FileDiff renders straight from the host's metadata (no __prepareFile
  // substitution like File), so a host that re-parses pristine metadata after
  // edits — same derived cacheKey, original content — must get a document
  // built from that metadata, not the edited cached one, or the rendered rows
  // and the editing document would diverge.
  test('a re-parsed pristine diff does not adopt the edited cached document', async () => {
    const dom = installDom();
    const editor = new Editor<undefined>({ persistState: true });
    const container = document.createElement('div');
    document.body.appendChild(container);
    const oldFile: FileContents = {
      name: 'diffed-reparse.ts',
      contents: 'alpha\n',
    };
    const newFile: FileContents = {
      name: 'diffed-reparse.ts',
      contents: 'alpha\nbravo\n',
    };
    const first = new FileDiff<undefined>({
      disableErrorHandling: true,
      disableFileHeader: true,
      theme: DEFAULT_THEMES,
    });
    const second = new FileDiff<undefined>({
      disableErrorHandling: true,
      disableFileHeader: true,
      theme: DEFAULT_THEMES,
    });
    try {
      first.render({
        oldFile,
        newFile,
        fileContainer: container,
        forceRender: true,
      });
      editor.edit(first);
      await waitFor(() => editor.getText() === 'alpha\nbravo\n');
      editor.applyEdits([
        {
          range: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 0 },
          },
          newText: 'edited ',
        },
      ]);
      expect(editor.getText()).toBe('edited alpha\nbravo\n');
      editor.cleanUp();
      first.cleanUp();
      container.innerHTML = '';

      second.render({
        oldFile,
        newFile,
        fileContainer: container,
        forceRender: true,
      });
      editor.edit(second);
      // waitFor times out silently; the expect below is the real assertion.
      await waitFor(() => editor.getText() === 'alpha\nbravo\n');
      expect(editor.getText()).toBe('alpha\nbravo\n');
    } finally {
      editor.cleanUp();
      first.cleanUp();
      second.cleanUp();
      dom.cleanup();
    }
  });

  test('without persistState, attaching a diff leaves the viewport alone', async () => {
    const dom = installDom();
    const editor = new Editor<undefined>();
    const viewport = document.createElement('div');
    viewport.style.overflowY = 'auto';
    document.body.appendChild(viewport);
    const container = document.createElement('div');
    viewport.appendChild(container);
    viewport.scrollTop = 40;

    const fileDiff = new FileDiff<undefined>({
      disableErrorHandling: true,
      disableFileHeader: true,
      theme: DEFAULT_THEMES,
    });
    try {
      fileDiff.render({
        oldFile: { name: 'diffed.ts', contents: 'alpha\n' },
        newFile: { name: 'diffed.ts', contents: 'alpha\nbravo\n' },
        fileContainer: container,
        forceRender: true,
      });
      editor.edit(fileDiff);
      // Attach work settles asynchronously; give it time to (incorrectly)
      // move the viewport before asserting it stayed put.
      await wait(50);
      expect(viewport.scrollTop).toBe(40);
    } finally {
      editor.cleanUp();
      fileDiff.cleanUp();
      dom.cleanup();
    }
  });

  test('a record without scrollTop leaves the viewport scroll alone', async () => {
    const dom = installDom();
    const storage: IStateStorage = {
      // A record persisted before scrollTop existed: setState still honors
      // scrollLeft exactly but must not move the viewport vertically.
      get: () => ({ ...savedCaret(3), view: { scrollLeft: 0 } }),
      set() {},
    };
    const editor = new Editor<undefined>({
      persistState: true,
      persistStateStorage: storage,
    });
    let attached: (AttachedFile & { viewport: HTMLElement }) | undefined;

    try {
      attached = attachFileInScrolledViewport(editor, {
        ...ORIGINAL_FILE,
      });
      const { viewport } = attached;
      await waitFor(
        () => editor.getState().selections?.[0]?.start.character === 3
      );
      expect(viewport.scrollTop).toBe(40);
      expect(viewport.scrollLeft).toBe(8);
    } finally {
      editor.cleanUp();
      attached?.file.cleanUp();
      dom.cleanup();
    }
  });
});
