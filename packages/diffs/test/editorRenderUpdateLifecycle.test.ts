import { afterAll, beforeAll, describe, expect, spyOn, test } from 'bun:test';
import { createTwoFilesPatch } from 'diff';
import type { ThemeRegistration } from 'shiki';

import {
  disposeHighlighter,
  FileDiff,
  getSharedHighlighter,
  parseDiffFromFile,
  parsePatchFiles,
  registerCustomTheme,
  VirtualizedFile,
  VirtualizedFileDiff,
  Virtualizer,
} from '../src';
import { Editor } from '../src/editor/editor';
import type { EditorChangeEvent } from '../src/editor/types';
import type {
  FileContents,
  FileDiffLoadedFiles,
  FileDiffMetadata,
  SupportedLanguages,
} from '../src/types';
import { createRoot, installDom, waitFor } from './domHarness';
import { assertDefined, createDeferred } from './testUtils';

beforeAll(async () => {
  await disposeHighlighter();
  await getSharedHighlighter({
    preferredHighlighter: 'shiki-js',
    themes: [],
    langs: [],
  });
});

afterAll(async () => {
  await disposeHighlighter();
});

class TestFileDiff extends FileDiff<undefined> {
  getInputDiffForTest(): FileDiffMetadata | undefined {
    return this.getInputDiff();
  }

  getRenderedDiffForTest(): FileDiffMetadata | undefined {
    return this.getRenderedDiff();
  }

  getSessionDiff(): FileDiffMetadata | undefined {
    return this.getWorkingDiff();
  }
}

function createDiff({
  cacheKey,
  name = 'session.ts',
  oldContents = 'base\n',
  newContents,
  lang,
  type,
}: {
  cacheKey?: string;
  name?: string;
  oldContents?: string;
  newContents: string;
  lang?: SupportedLanguages;
  type?: FileDiffMetadata['type'];
}): FileDiffMetadata {
  const diff = parseDiffFromFile(
    { name, contents: oldContents },
    { name, contents: newContents }
  );
  diff.cacheKey = cacheKey;
  diff.lang = lang;
  diff.type = type ?? diff.type;
  return diff;
}

async function createFixture(options?: {
  initialCacheKey?: string | null;
  initialOldContents?: string;
  initialType?: FileDiffMetadata['type'];
  loadDiffFiles?: (fileDiff: FileDiffMetadata) => Promise<FileDiffLoadedFiles>;
  onChange?: (contents: string) => void;
}) {
  const dom = installDom();
  const fileContainer = document.createElement('div');
  document.body.appendChild(fileContainer);
  const initialDiff = createDiff({
    cacheKey:
      options?.initialCacheKey === null
        ? undefined
        : (options?.initialCacheKey ?? 'session:v1'),
    oldContents: options?.initialOldContents ?? 'base\n',
    newContents: 'alpha\n',
    type: options?.initialType,
  });
  const instance = new TestFileDiff({
    disableErrorHandling: true,
    disableFileHeader: true,
    loadDiffFiles: options?.loadDiffFiles,
  });
  const editor = new Editor('file-diff', {
    onChange: (event) => options?.onChange?.(event.file.contents),
  });

  instance.render({
    fileDiff: initialDiff,
    fileContainer,
    forceRender: true,
  });
  editor.edit(instance);
  await waitFor(() => editor.getText() === 'alpha\n', { timeout: 4_000 });

  return {
    dom,
    editor,
    fileContainer,
    initialDiff,
    instance,
    cleanup() {
      editor.cleanUp();
      instance.cleanUp();
      dom.cleanup();
    },
  };
}

function createPartialDiff(
  oldContents: string,
  newContents: string
): FileDiffMetadata {
  const patch = createTwoFilesPatch(
    'session.ts',
    'session.ts',
    oldContents,
    newContents
  );
  const diff = parsePatchFiles(patch, {
    cacheKeyPrefix: 'partial',
    throwOnError: true,
  })[0]?.files[0];
  assertDefined(diff, 'expected a parsed partial diff');
  diff.cacheKey = 'session:partial-v2';
  return diff;
}

function replaceDocument(
  editor: Editor<'file-diff', undefined>,
  contents: string
): void {
  editor.applyEdits([
    {
      range: {
        start: { line: 0, character: 0 },
        end: {
          line: Number.MAX_SAFE_INTEGER,
          character: Number.MAX_SAFE_INTEGER,
        },
      },
      newText: contents,
    },
  ]);
}

async function renderReplacement(
  fixture: Awaited<ReturnType<typeof createFixture>>,
  replacement: FileDiffMetadata,
  contents: string
): Promise<void> {
  fixture.instance.render({
    fileDiff: replacement,
    fileContainer: fixture.fileContainer,
    forceRender: true,
  });
  await waitFor(() => fixture.editor.getText() === contents, {
    timeout: 4_000,
  });
}

describe('calling back into the editor from onChange', () => {
  type ChangeEvent = EditorChangeEvent<'file-diff', undefined, undefined>;
  const setup = async (onChange: (event: ChangeEvent) => void) => {
    const consoleError = spyOn(console, 'error').mockImplementation(() => {});
    const dom = installDom();
    const fileContainer = document.createElement('div');
    document.body.appendChild(fileContainer);
    const instance = new TestFileDiff({
      disableErrorHandling: true,
      disableFileHeader: true,
    });
    const render = (contents: string) => {
      const file: FileContents = {
        name: 'callback.txt',
        lang: 'text',
        contents,
      };
      instance.render({
        fileDiff: parseDiffFromFile({ ...file, contents: 'base\n' }, file),
        fileContainer,
        forceRender: true,
      });
    };
    const editor = new Editor('file-diff', { onChange });
    render('alpha\n');
    editor.edit(instance);
    await waitFor(() => editor.getText() === 'alpha\n');
    return {
      instance,
      editor,
      fileContainer,
      render,
      // The first clause of each logged error.
      errors: () =>
        consoleError.mock.calls.map(([error]) =>
          error instanceof Error ? error.message.split(';')[0] : String(error)
        ),
      cleanup: () => {
        consoleError.mockRestore();
        editor.cleanUp();
        instance.cleanUp();
        dom.cleanup();
      },
    };
  };
  const insertX = (editor: Editor<'file-diff', undefined, undefined>) =>
    editor.applyEdits([
      {
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 0 },
        },
        newText: 'X',
      },
    ]);

  test('a new diff rendered from onChange is refused and the edit still renders', async () => {
    const notifications: string[] = [];
    const host: { render?: (contents: string) => void } = {};
    const fixture = await setup((event) => {
      notifications.push(event.file.contents);
      if (notifications.length === 1) {
        host.render?.('server\n');
      }
    });
    host.render = fixture.render;
    try {
      insertX(fixture.editor);
      expect(fixture.errors()).toEqual([
        'FileDiff.render: not allowed inside onChange or onEditChange',
      ]);
      expect(fixture.editor.getText()).toBe('Xalpha\n');
      expect(fixture.fileContainer.shadowRoot?.textContent).toContain('Xalpha');
      expect(fixture.instance.getSessionDiff()?.additionLines).toEqual([
        'Xalpha\n',
      ]);
      expect(notifications).toEqual(['Xalpha\n']);
    } finally {
      fixture.cleanup();
    }
  });

  test('an edit made from onChange is refused', async () => {
    let depth = 0;
    const fixture = await setup((event) => {
      depth++;
      if (depth === 1) {
        insertX(event.editor);
      }
    });
    try {
      insertX(fixture.editor);
      expect(fixture.errors()).toEqual([
        'Editor.applyEdits: not allowed inside onChange or onEditChange',
      ]);
      expect(fixture.editor.getText()).toBe('Xalpha\n');
      expect(depth).toBe(1);
    } finally {
      fixture.cleanup();
    }
  });

  test('a clean-up from onChange is refused', async () => {
    const fixture = await setup(() => {
      fixture.instance.cleanUp();
    });
    try {
      insertX(fixture.editor);
      expect(fixture.errors()).toEqual([
        'FileDiff.cleanUp: not allowed inside onChange or onEditChange',
      ]);
      expect(fixture.editor.getFile()?.contents).toBe('Xalpha\n');
    } finally {
      fixture.cleanup();
    }
  });
});

describe('callbacks during a virtualized external replacement', () => {
  for (const type of ['file', 'file-diff'] as const) {
    for (const observer of [
      'onChange',
      'onEditChange',
      'onPostRender',
    ] as const) {
      test(`${type} can dispose its host in ${observer} during an external replacement`, async () => {
        await getSharedHighlighter({
          themes: ['pierre-dark', 'pierre-light'],
          langs: ['text'],
        });
        const dom = installDom();
        const virtualizer = new Virtualizer();
        const root = createRoot();
        const fileContainer = document.createElement('diffs-container');
        root.appendChild(fileContainer);
        let armed = false;
        let notifications = 0;
        let renderReturned = false;
        const disposeHost = () => {
          if (!armed) return;
          armed = false;
          notifications++;
          expect(renderReturned).toBe(false);
          expect(editor.getText()).toBe('server\n');
          editor.cleanUp();
          instance.cleanUp();
        };
        const options = {
          disableFileHeader: true,
          disableErrorHandling: true,
          onEditChange: observer === 'onEditChange' ? disposeHost : undefined,
          onPostRender: observer === 'onPostRender' ? disposeHost : undefined,
        };
        const instance =
          type === 'file'
            ? new VirtualizedFile(options, virtualizer)
            : new VirtualizedFileDiff(options, virtualizer);
        const editorOptions = {
          onChange: observer === 'onChange' ? disposeHost : undefined,
        };
        const editor =
          type === 'file'
            ? new Editor('file', editorOptions)
            : new Editor('file-diff', editorOptions);
        const render = (contents: string) => {
          const file: FileContents = {
            name: 'lifecycle.txt',
            lang: 'text',
            contents,
          };
          return instance.type === 'file'
            ? instance.render({ file, fileContainer, forceRender: true })
            : instance.render({
                fileDiff: parseDiffFromFile(
                  { ...file, contents: 'base\n' },
                  file
                ),
                fileContainer,
                forceRender: true,
              });
        };

        try {
          virtualizer.setup(root);
          render('alpha\n');
          if (instance.type === 'file' && editor.type === 'file') {
            editor.edit(instance);
          } else if (
            instance.type === 'file-diff' &&
            editor.type === 'file-diff'
          ) {
            editor.edit(instance);
          }
          await waitFor(() => editor.getText() === 'alpha\n');
          armed = true;
          if (observer === 'onPostRender') {
            expect(render('server\n')).toBe(true);
            renderReturned = true;
            expect(notifications).toBe(1);
            expect(editor.getFile()).toBeUndefined();
          } else {
            // A change callback may not tear the component down: the attempt
            // is logged and the replacement still renders.
            const consoleError = spyOn(console, 'error').mockImplementation(
              () => {}
            );
            try {
              expect(render('server\n')).toBe(true);
              expect(consoleError).toHaveBeenCalledTimes(1);
            } finally {
              consoleError.mockRestore();
            }
            expect(notifications).toBe(1);
            expect(editor.getText()).toBe('server\n');
            expect(editor.getFile()?.contents).toBe('server\n');
          }
        } finally {
          armed = false;
          editor.cleanUp();
          instance.cleanUp();
          virtualizer.cleanUp();
          dom.cleanup();
        }
      });
    }
  }
});

describe('external FileDiff updates during editing', () => {
  test('an observer that throws does not stop the replacement from rendering', async () => {
    const consoleError = spyOn(console, 'error').mockImplementation(() => {});
    const fixture = await createFixture({
      onChange: () => {
        throw new Error('observer failed');
      },
    });
    try {
      expect(
        fixture.instance.render({
          fileDiff: createDiff({
            cacheKey: 'session:v2',
            newContents: 'beta\n',
          }),
          fileContainer: fixture.fileContainer,
          forceRender: true,
        })
      ).toBe(true);
      expect(fixture.editor.getText()).toBe('beta\n');
      expect(fixture.fileContainer.shadowRoot?.textContent).toContain('beta');
      expect(
        consoleError.mock.calls.map(([error]) =>
          error instanceof Error ? error.message : String(error)
        )
      ).toEqual(['observer failed']);
    } finally {
      consoleError.mockRestore();
      fixture.cleanup();
    }
  });

  test('a replacement reports the new hunks in the edit state its onChange sees', async () => {
    const additionCounts: (number | undefined)[] = [];
    const host: { editor?: Editor<'file-diff', undefined, undefined> } = {};
    const fixture = await createFixture({
      onChange: () =>
        additionCounts.push(
          host.editor
            ?.getEditState()
            ?.diffSession.hunks.reduce(
              (total, hunk) => total + hunk.additionLines,
              0
            )
        ),
    });
    host.editor = fixture.editor;
    try {
      fixture.instance.render({
        fileDiff: createDiff({
          cacheKey: 'session:v2',
          newContents: 'beta\ngamma\n',
        }),
        fileContainer: fixture.fileContainer,
        forceRender: true,
      });
      expect(additionCounts).toEqual([2]);
    } finally {
      fixture.cleanup();
    }
  });

  test('an edit that changes the line counts updates the header', async () => {
    const dom = installDom();
    const fileContainer = document.createElement('div');
    document.body.appendChild(fileContainer);
    const instance = new TestFileDiff({ disableErrorHandling: true });
    const editor = new Editor('file-diff');
    const counts = () =>
      ['[data-deletions-count]', '[data-additions-count]'].map(
        (selector) =>
          fileContainer.shadowRoot?.querySelector(selector)?.textContent
      );
    try {
      instance.render({
        fileDiff: createDiff({
          cacheKey: 'session:v1',
          oldContents: 'alpha\nbeta\ngamma\n',
          newContents: 'ALPHA\nbeta\ngamma\n',
        }),
        fileContainer,
        forceRender: true,
      });
      editor.edit(instance);
      await waitFor(() => editor.getText() === 'ALPHA\nbeta\ngamma\n', {
        timeout: 4_000,
      });
      expect(counts()).toEqual(['-1', '+1']);
      editor.applyEdits([
        {
          range: {
            start: { line: 1, character: 0 },
            end: { line: 1, character: 4 },
          },
          newText: 'BETA',
        },
      ]);
      expect(editor.getText()).toBe('ALPHA\nBETA\ngamma\n');
      expect(counts()).toEqual(['-2', '+2']);
    } finally {
      editor.cleanUp();
      instance.cleanUp();
      dom.cleanup();
    }
  });

  test('a file-pair render refused inside onChange succeeds when retried', async () => {
    const dom = installDom();
    const fileContainer = document.createElement('div');
    document.body.appendChild(fileContainer);
    const instance = new TestFileDiff({
      disableErrorHandling: true,
      disableFileHeader: true,
    });
    const oldFile = { name: 'pair.txt', contents: 'base\n' };
    const render = (contents: string) =>
      instance.render({
        oldFile,
        newFile: { name: 'pair.txt', contents },
        fileContainer,
        forceRender: true,
      });
    const changes: string[] = [];
    let refused: unknown;
    const editor = new Editor('file-diff', {
      onChange: (event) => {
        changes.push(event.file.contents);
        if (changes.length === 1) {
          try {
            render('server\n');
          } catch (error) {
            refused = error;
          }
        }
      },
    });
    try {
      render('alpha\n');
      editor.edit(instance);
      await waitFor(() => editor.getText() === 'alpha\n', { timeout: 4_000 });
      editor.applyEdits([
        {
          range: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 0 },
          },
          newText: 'X',
        },
      ]);
      expect(refused).toBeInstanceOf(Error);
      expect(editor.getText()).toBe('Xalpha\n');
      expect(render('server\n')).toBe(true);
      expect(editor.getText()).toBe('server\n');
      expect(changes).toEqual(['Xalpha\n', 'server\n']);
    } finally {
      editor.cleanUp();
      instance.cleanUp();
      dom.cleanup();
    }
  });

  test('a compatible update becomes one undoable edit and emits its contents', async () => {
    const changes: string[] = [];
    const fixture = await createFixture({
      onChange: (contents) => changes.push(contents),
    });
    const replacement = createDiff({
      cacheKey: 'session:v2',
      newContents: 'charlie\n',
    });
    const replacementBefore = structuredClone(replacement);
    const replacementAdditionLines = replacement.additionLines;
    const replacementHunks = replacement.hunks;

    try {
      replaceDocument(fixture.editor, 'bravo\n');
      expect(changes).toEqual(['bravo\n']);

      await renderReplacement(fixture, replacement, 'charlie\n');

      const sessionDiff = fixture.instance.getSessionDiff();
      expect(fixture.instance.fileDiff).toBe(replacement);
      expect(fixture.instance.getRenderedDiffForTest()).toBe(sessionDiff);
      expect(fixture.instance.getInputDiffForTest()).toBe(replacement);
      expect(sessionDiff).not.toBe(replacement);
      expect(sessionDiff?.cacheKey).toBeUndefined();
      expect(changes).toEqual(['bravo\n', 'charlie\n']);

      fixture.editor.undo();
      expect(fixture.editor.getText()).toBe('bravo\n');
      fixture.editor.undo();
      expect(fixture.editor.getText()).toBe('alpha\n');
      fixture.editor.redo();
      expect(fixture.editor.getText()).toBe('bravo\n');
      fixture.editor.redo();
      expect(fixture.editor.getText()).toBe('charlie\n');
      expect(changes).toEqual([
        'bravo\n',
        'charlie\n',
        'bravo\n',
        'alpha\n',
        'bravo\n',
        'charlie\n',
      ]);
      expect(replacement).toEqual(replacementBefore);
      expect(replacement.additionLines).toBe(replacementAdditionLines);
      expect(replacement.hunks).toBe(replacementHunks);
    } finally {
      fixture.cleanup();
    }
  });

  test('a replacement is published at once with a loading theme', async () => {
    const dom = installDom();
    const fileContainer = document.createElement('div');
    document.body.appendChild(fileContainer);
    // Each notification's edits, which an observer replays in order.
    const published: string[][] = [];
    const instance = new TestFileDiff({
      disableErrorHandling: true,
      disableFileHeader: true,
    });
    const editor = new Editor('file-diff', {
      onChange: (event) =>
        published.push(event.changes.map((change) => change.text)),
    });
    const themeName = 'held-replacement-order';
    const loadedTheme = createDeferred<ThemeRegistration>();
    registerCustomTheme(themeName, () => loadedTheme.promise);
    try {
      instance.render({
        fileDiff: createDiff({
          cacheKey: 'session:v1',
          oldContents: 'base\n',
          newContents: 'alpha\n',
        }),
        fileContainer,
        forceRender: true,
      });
      editor.edit(instance);
      await waitFor(() => editor.getText() === 'alpha\n', { timeout: 4_000 });
      instance.setOptions({
        disableErrorHandling: true,
        disableFileHeader: true,
        theme: themeName,
      });
      instance.render({
        fileDiff: createDiff({
          cacheKey: 'session:v2',
          oldContents: 'base\n',
          newContents: 'server\n',
        }),
        fileContainer,
        forceRender: true,
      });
      // The replacement is published as the document takes it, theme or not.
      expect(editor.getText()).toBe('server\n');
      expect(published).toEqual([['server\n']]);
      editor.applyEdits([
        {
          range: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 0 },
          },
          newText: 'X',
        },
      ]);
      expect(published).toEqual([['server\n'], ['X']]);
      // The rows follow the document while the theme loads.
      const content = Array.from(
        fileContainer.shadowRoot?.querySelectorAll<HTMLElement>(
          '[data-content]'
        ) ?? []
      ).find((element) => element.contentEditable === 'true');
      expect(content?.textContent).toContain('Xserver');
      loadedTheme.resolve({
        name: themeName,
        type: 'dark',
        colors: {},
        tokenColors: [],
      });
      await waitFor(() => editor.__getDocumentSessionState() != null);
      expect(published).toEqual([['server\n'], ['X']]);
    } finally {
      editor.cleanUp();
      instance.cleanUp();
      dom.cleanup();
    }
  });

  test('replacements made back to back before the theme loads each notify', async () => {
    const dom = installDom();
    const fileContainer = document.createElement('div');
    document.body.appendChild(fileContainer);
    const published: string[][] = [];
    const instance = new TestFileDiff({
      disableErrorHandling: true,
      disableFileHeader: true,
    });
    const editor = new Editor('file-diff', {
      onChange: (event) =>
        published.push(event.changes.map((change) => change.text)),
    });
    const themeName = 'back-to-back-replacements';
    const loadedTheme = createDeferred<ThemeRegistration>();
    registerCustomTheme(themeName, () => loadedTheme.promise);
    const replace = (newContents: string, cacheKey: string) =>
      instance.render({
        fileDiff: createDiff({ cacheKey, oldContents: 'base\n', newContents }),
        fileContainer,
        forceRender: true,
      });
    try {
      replace('alpha\n', 'session:v1');
      editor.edit(instance);
      await waitFor(() => editor.getText() === 'alpha\n', { timeout: 4_000 });
      instance.setOptions({
        disableErrorHandling: true,
        disableFileHeader: true,
        theme: themeName,
      });
      replace('b\n', 'session:v2');
      replace('z\n', 'session:v3');
      expect(editor.getText()).toBe('z\n');
      // Each replacement reports from the text observers last saw.
      expect(published).toEqual([['b\n'], ['z\n']]);
      loadedTheme.resolve({
        name: themeName,
        type: 'dark',
        colors: {},
        tokenColors: [],
      });
      await waitFor(() => editor.__getDocumentSessionState() != null);
      expect(published).toEqual([['b\n'], ['z\n']]);
    } finally {
      editor.cleanUp();
      instance.cleanUp();
      dom.cleanup();
    }
  });

  test("a replacement's annotations follow edits made before the theme loads", async () => {
    const dom = installDom();
    const fileContainer = document.createElement('div');
    document.body.appendChild(fileContainer);
    const events: EditorChangeEvent<'file-diff', string, undefined>[] = [];
    const instance = new FileDiff<string>({
      disableErrorHandling: true,
      disableFileHeader: true,
    });
    const editor = new Editor<'file-diff', string>('file-diff', {
      onChange: (event) => events.push(event),
    });
    const themeName = 'held-replacement-annotations';
    const loadedTheme = createDeferred<ThemeRegistration>();
    registerCustomTheme(themeName, () => loadedTheme.promise);
    try {
      instance.render({
        fileDiff: createDiff({
          cacheKey: 'session:v1',
          oldContents: 'base\n',
          newContents: 'alpha\n',
        }),
        fileContainer,
        forceRender: true,
        lineAnnotations: [
          { side: 'additions', lineNumber: 1, metadata: 'OLD' },
        ],
      });
      editor.edit(instance);
      await waitFor(() => editor.getText() === 'alpha\n', { timeout: 4_000 });
      instance.setOptions({
        disableErrorHandling: true,
        disableFileHeader: true,
        theme: themeName,
      });
      instance.render({
        fileDiff: createDiff({
          cacheKey: 'session:v2',
          oldContents: 'base\n',
          newContents: 'one\ntwo\nthree\n',
        }),
        fileContainer,
        forceRender: true,
        lineAnnotations: [
          { side: 'additions', lineNumber: 2, metadata: 'NEW' },
        ],
      });
      editor.applyEdits([
        {
          range: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 0 },
          },
          newText: 'inserted\n',
        },
      ]);
      const edit = events.at(-1);
      expect(edit?.file.contents).toBe('inserted\none\ntwo\nthree\n');
      expect(
        edit?.lineAnnotations?.map((annotation) => [
          annotation.metadata,
          annotation.lineNumber,
        ])
      ).toEqual([['NEW', 3]]);
      loadedTheme.resolve({
        name: themeName,
        type: 'dark',
        colors: {},
        tokenColors: [],
      });
    } finally {
      editor.cleanUp();
      instance.cleanUp();
      dom.cleanup();
    }
  });

  for (const deferredTheme of [false, true]) {
    test(`an old-side-only replacement resets history once with a ${deferredTheme ? 'loading' : 'ready'} theme`, async () => {
      const changes: string[] = [];
      const fixture = await createFixture({
        onChange: (contents) => changes.push(contents),
      });
      const themeName = `old-side-replacement-${deferredTheme}`;
      const theme: ThemeRegistration = {
        name: themeName,
        type: 'dark',
        colors: {},
        tokenColors: [],
      };
      const loadedTheme = createDeferred<ThemeRegistration>();
      const replacement = createDiff({
        cacheKey: 'session:new-base',
        oldContents: 'different base\n',
        newContents: 'bravo\n',
      });

      try {
        replaceDocument(fixture.editor, 'bravo\n');
        expect(fixture.editor.canUndo).toBe(true);
        if (deferredTheme) {
          registerCustomTheme(themeName, () => loadedTheme.promise);
          fixture.instance.setOptions({
            disableErrorHandling: true,
            disableFileHeader: true,
            theme: themeName,
          });
        }
        fixture.instance.render({
          fileDiff: replacement,
          fileContainer: fixture.fileContainer,
          forceRender: true,
        });
        // A different old side resets history as soon as the replacement
        // renders, whether or not the theme has loaded; the session state is
        // captured once the editor syncs to the rendered rows.
        expect(fixture.editor.canUndo).toBe(false);
        if (deferredTheme) {
          loadedTheme.resolve(theme);
          await waitFor(
            () => fixture.editor.__getDocumentSessionState() != null
          );
        }
        expect(fixture.editor.canRedo).toBe(false);
        expect(changes).toEqual(['bravo\n']);
        expect(
          fixture.editor.__getDocumentSessionState()?.oldFile?.lines
        ).toEqual(['different base\n']);

        fixture.editor.setSelections([
          {
            start: { line: 0, character: 2 },
            end: { line: 0, character: 2 },
            direction: 'none',
          },
        ]);
        const selections = fixture.editor.getViewState().selections;
        expect(selections).toBeDefined();
        fixture.instance.rerender();
        fixture.instance.rerender();
        expect(fixture.editor.getViewState().selections).toEqual(selections);
        expect(changes).toEqual(['bravo\n']);

        replaceDocument(fixture.editor, 'charlie\n');
        fixture.instance.rerender();
        fixture.editor.undo();
        expect(fixture.editor.getText()).toBe('bravo\n');
        expect(fixture.editor.canUndo).toBe(false);
        fixture.editor.redo();
        expect(fixture.editor.getText()).toBe('charlie\n');
      } finally {
        loadedTheme.resolve(theme);
        if (deferredTheme) {
          await getSharedHighlighter({ themes: [themeName], langs: ['text'] });
        }
        fixture.cleanup();
      }
    });
  }

  test('an identical update changes external identity without adding history', async () => {
    const changes: string[] = [];
    const fixture = await createFixture({
      onChange: (contents) => changes.push(contents),
    });
    const replacement = createDiff({
      cacheKey: 'session:v2',
      newContents: 'bravo\n',
    });

    try {
      replaceDocument(fixture.editor, 'bravo\n');
      await renderReplacement(fixture, replacement, 'bravo\n');
      expect(changes).toEqual(['bravo\n']);

      fixture.editor.undo();
      expect(fixture.editor.getText()).toBe('alpha\n');
      expect(fixture.editor.canUndo).toBe(false);
      expect(changes).toEqual(['bravo\n', 'alpha\n']);
    } finally {
      fixture.cleanup();
    }
  });

  test('a distinct unkeyed update follows the same compatible history path', async () => {
    const fixture = await createFixture({ initialCacheKey: null });
    const replacement = createDiff({ newContents: 'charlie\n' });

    try {
      replaceDocument(fixture.editor, 'bravo\n');
      await renderReplacement(fixture, replacement, 'charlie\n');

      fixture.editor.undo();
      expect(fixture.editor.getText()).toBe('bravo\n');
      fixture.editor.undo();
      expect(fixture.editor.getText()).toBe('alpha\n');
    } finally {
      fixture.cleanup();
    }
  });

  test('a compatible partial update waits for hydration before joining history', async () => {
    const loaded = createDeferred<FileDiffLoadedFiles>();
    const changes: string[] = [];
    const fixture = await createFixture({
      loadDiffFiles: () => loaded.promise,
      onChange: (contents) => changes.push(contents),
    });
    const partial = createPartialDiff('base\n', 'charlie\n');

    try {
      replaceDocument(fixture.editor, 'bravo\n');
      fixture.instance.render({
        fileDiff: partial,
        fileContainer: fixture.fileContainer,
        forceRender: true,
      });

      expect(fixture.instance.fileDiff).toBe(partial);
      expect(fixture.instance.getRenderedDiffForTest()).toBe(
        fixture.instance.getSessionDiff()
      );
      expect(fixture.instance.getInputDiffForTest()).toBe(partial);
      expect(partial.isPartial).toBe(true);
      expect(fixture.editor.getText()).toBe('bravo\n');

      loaded.resolve({
        oldFile: { name: 'session.ts', contents: 'base\n' },
        newFile: { name: 'session.ts', contents: 'charlie\n' },
      });
      await waitFor(
        () => !partial.isPartial && fixture.editor.getText() === 'charlie\n',
        { timeout: 4_000 }
      );
      expect(changes).toEqual(['bravo\n', 'charlie\n']);

      fixture.editor.undo();
      expect(fixture.editor.getText()).toBe('bravo\n');
      fixture.editor.undo();
      expect(fixture.editor.getText()).toBe('alpha\n');
      expect(changes).toEqual(['bravo\n', 'charlie\n', 'bravo\n', 'alpha\n']);
    } finally {
      fixture.cleanup();
    }
  });

  test('an incompatible partial update resets history after hydration', async () => {
    const loaded = createDeferred<FileDiffLoadedFiles>();
    const changes: string[] = [];
    const fixture = await createFixture({
      loadDiffFiles: () => loaded.promise,
      onChange: (contents) => changes.push(contents),
    });
    const partial = createPartialDiff('different base\n', 'charlie\n');

    try {
      replaceDocument(fixture.editor, 'bravo\n');
      fixture.instance.render({
        fileDiff: partial,
        fileContainer: fixture.fileContainer,
        forceRender: true,
      });
      expect(fixture.editor.getText()).toBe('bravo\n');

      loaded.resolve({
        oldFile: { name: 'session.ts', contents: 'different base\n' },
        newFile: { name: 'session.ts', contents: 'charlie\n' },
      });
      await waitFor(
        () => !partial.isPartial && fixture.editor.getText() === 'charlie\n',
        { timeout: 4_000 }
      );

      expect(fixture.editor.canUndo).toBe(false);
      expect(fixture.editor.canRedo).toBe(false);
      expect(changes).toEqual(['bravo\n', 'charlie\n']);
    } finally {
      fixture.cleanup();
    }
  });

  for (const [name, initialType, replacementType] of [
    ['a new diff becomes a change with an empty old side', 'new', 'change'],
    ['a change with an empty old side becomes a new diff', 'change', 'new'],
  ] as const) {
    test(`${name} and starts fresh history`, async () => {
      const changes: string[] = [];
      const fixture = await createFixture({
        initialOldContents: '',
        initialType,
        onChange: (contents) => changes.push(contents),
      });
      const replacement = createDiff({
        cacheKey: 'session:v2',
        oldContents: '',
        newContents: 'charlie\n',
        type: replacementType,
      });

      try {
        expect(fixture.initialDiff.deletionLines).toEqual([]);
        expect(replacement.deletionLines).toEqual([]);
        expect(fixture.initialDiff.type).toBe(initialType);
        expect(replacement.type).toBe(replacementType);

        replaceDocument(fixture.editor, 'bravo\n');
        expect(fixture.instance.getSessionDiff()?.type).toBe(
          fixture.initialDiff.type
        );
        await renderReplacement(fixture, replacement, 'charlie\n');

        expect(fixture.editor.canUndo).toBe(false);
        expect(fixture.editor.canRedo).toBe(false);
        expect(changes).toEqual(['bravo\n', 'charlie\n']);
      } finally {
        fixture.cleanup();
      }
    });
  }

  test('two new-file diff updates retain compatible history', async () => {
    const fixture = await createFixture({
      initialOldContents: '',
      initialType: 'new',
    });
    const replacement = createDiff({
      cacheKey: 'session:v2',
      oldContents: '',
      newContents: 'charlie\n',
      type: 'new',
    });

    try {
      replaceDocument(fixture.editor, 'bravo\n');
      await renderReplacement(fixture, replacement, 'charlie\n');

      fixture.editor.undo();
      expect(fixture.editor.getText()).toBe('bravo\n');
      fixture.editor.undo();
      expect(fixture.editor.getText()).toBe('alpha\n');
    } finally {
      fixture.cleanup();
    }
  });

  for (const [name, replacement] of [
    [
      'file name changes',
      createDiff({
        cacheKey: 'session:renamed',
        name: 'renamed.ts',
        newContents: 'charlie\n',
      }),
    ],
    [
      'effective language changes',
      createDiff({
        cacheKey: 'session:javascript',
        lang: 'javascript',
        newContents: 'charlie\n',
      }),
    ],
    [
      'the old file changes',
      createDiff({
        cacheKey: 'session:new-base',
        oldContents: 'different base\n',
        newContents: 'charlie\n',
      }),
    ],
  ] as const) {
    test(`${name} start fresh history`, async () => {
      const changes: string[] = [];
      const fixture = await createFixture({
        onChange: (contents) => changes.push(contents),
      });

      try {
        replaceDocument(fixture.editor, 'bravo\n');
        await renderReplacement(fixture, replacement, 'charlie\n');

        expect(fixture.editor.canUndo).toBe(false);
        expect(fixture.editor.canRedo).toBe(false);
        expect(changes).toEqual(['bravo\n', 'charlie\n']);
      } finally {
        fixture.cleanup();
      }
    });
  }
});
