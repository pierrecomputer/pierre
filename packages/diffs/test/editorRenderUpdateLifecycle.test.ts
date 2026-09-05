import { afterAll, describe, expect, test } from 'bun:test';
import { createTwoFilesPatch } from 'diff';

import {
  disposeHighlighter,
  File,
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
  ThemeRegistration,
} from '../src/types';
import { createRoot, installDom, waitFor } from './domHarness';
import { assertDefined, createDeferred } from './testUtils';

afterAll(async () => {
  await disposeHighlighter();
});

class TestFileDiff extends FileDiff<undefined> {
  getSessionDiff(): FileDiffMetadata | undefined {
    return this.getLatestDiff();
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
  const diff = parsePatchFiles(patch, 'partial', true)[0]?.files[0];
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

describe('external replacements from editor onChange', () => {
  for (const type of ['file', 'file-diff'] as const) {
    for (const deferredTheme of [false, true]) {
      test(`${type} retains a callback replacement with a ${deferredTheme ? 'loading' : 'ready'} theme`, async () => {
        await getSharedHighlighter({
          themes: ['pierre-dark', 'pierre-light'],
          langs: ['text'],
        });
        const themeName = `editor-callback-${type}-${deferredTheme}`;
        const theme: ThemeRegistration = {
          name: themeName,
          type: 'dark',
          colors: {
            'editor.background': '#000000',
            'editor.foreground': '#ffffff',
          },
          tokenColors: [],
        };
        const loadedTheme = createDeferred<ThemeRegistration>();
        registerCustomTheme(themeName, () => loadedTheme.promise);
        if (!deferredTheme) {
          loadedTheme.resolve(theme);
          await getSharedHighlighter({ themes: [themeName], langs: ['text'] });
        }

        const dom = installDom();
        const fileContainer = document.createElement('div');
        document.body.appendChild(fileContainer);
        const notifications: string[] = [];
        const onEditChange = (
          event: EditorChangeEvent<'file' | 'file-diff', undefined, undefined>
        ) => notifications.push(`component:${event.file.contents}`);
        const options = {
          disableErrorHandling: true,
          disableFileHeader: true,
          onEditChange,
        };
        const instance =
          type === 'file' ? new File(options) : new FileDiff(options);
        const render = (contents: string) => {
          const file: FileContents = {
            name: 'callback.txt',
            lang: 'text',
            contents,
          };
          if (instance.type === 'file') {
            instance.render({ file, fileContainer, forceRender: true });
          } else {
            instance.render({
              fileDiff: parseDiffFromFile(
                { ...file, contents: 'base\n' },
                file
              ),
              fileContainer,
              forceRender: true,
            });
          }
        };
        let replaced = false;
        const onChange = (
          event: EditorChangeEvent<'file' | 'file-diff', undefined, undefined>
        ) => {
          notifications.push(`editor:${event.file.contents}`);
          if (replaced) return;
          replaced = true;
          instance.setOptions({ ...options, theme: themeName });
          render('server\n');
        };
        const editor =
          type === 'file'
            ? new Editor('file', { onChange })
            : new Editor('file-diff', { onChange });

        try {
          render('alpha\n');
          if (instance.type === 'file' && editor.type === 'file') {
            editor.edit(instance);
          } else if (
            instance.type === 'file-diff' &&
            editor.type === 'file-diff'
          ) {
            editor.edit(instance);
          }
          expect(editor.getText()).toBe('alpha\n');
          editor.applyEdits([
            {
              range: {
                start: { line: 0, character: 0 },
                end: { line: 0, character: 0 },
              },
              newText: 'X',
            },
          ]);

          if (deferredTheme) {
            expect(editor.getText()).toBe('Xalpha\n');
            expect(notifications).toEqual([
              'editor:Xalpha\n',
              'component:Xalpha\n',
            ]);
            loadedTheme.resolve(theme);
            await waitFor(() => editor.getText() === 'server\n');
            expect(notifications).toEqual([
              'editor:Xalpha\n',
              'component:Xalpha\n',
              'editor:server\n',
              'component:server\n',
            ]);
          }
          // A ready theme must reconcile within applyEdits itself.
          expect(editor.getText()).toBe('server\n');
          const content = Array.from(
            fileContainer.shadowRoot?.querySelectorAll<HTMLElement>(
              '[data-content]'
            ) ?? []
          ).find((element) => element.contentEditable === 'true');
          expect(content?.textContent).toContain('server');
          editor.undo();
          expect(editor.getText()).toBe('Xalpha\n');
          editor.undo();
          expect(editor.getText()).toBe('alpha\n');
        } finally {
          loadedTheme.resolve(theme);
          editor.cleanUp();
          instance.cleanUp();
          await getSharedHighlighter({ themes: [themeName], langs: ['text'] });
          dom.cleanup();
        }
      });
    }
  }
});

describe('virtualized render completion before notifications', () => {
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
          expect(render('server\n')).toBe(true);
          renderReturned = true;
          expect(notifications).toBe(1);
          expect(editor.getFile()).toBeUndefined();
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
