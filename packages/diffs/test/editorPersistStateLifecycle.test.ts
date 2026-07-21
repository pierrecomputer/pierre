import { afterAll, describe, expect, test } from 'bun:test';

import { File } from '../src/components/File';
import { DEFAULT_THEMES } from '../src/constants';
import { Editor, type IStateStorage } from '../src/editor';
import { disposeHighlighter } from '../src/highlighter/shared_highlighter';
import type { EditorState, FileContents } from '../src/types';
import { installDom, wait, waitFor } from './domHarness';

afterAll(async () => {
  await disposeHighlighter();
});

const ORIGINAL_FILE: FileContents = {
  name: 'persisted.ts',
  contents: 'alpha\nbravo\n',
  cacheKey: 'persisted.ts',
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

describe('Editor persisted state lifecycle', () => {
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
});
