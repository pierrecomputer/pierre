import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createTwoFilesPatch } from 'diff';

import {
  CodeView,
  type CodeViewCoordinator,
  type CodeViewCreateEditorOptions,
  type CodeViewSlotSnapshot,
} from '../src/components/CodeView';
import type { File, FileEditCompleteEvent } from '../src/components/File';
import type {
  FileDiff,
  FileDiffEditCompleteEvent,
} from '../src/components/FileDiff';
import { Editor } from '../src/editor/editor';
import { TextDocument } from '../src/editor/textDocument';
import type {
  EditCompletionDecision,
  EditorType,
  EditorViewState,
} from '../src/editor/types';
import {
  disposeHighlighter,
  getSharedHighlighter,
} from '../src/highlighter/shared_highlighter';
import type {
  CodeViewItem,
  DiffLineAnnotation,
  FileContents,
  FileDiffLoadedFiles,
  FileDiffMetadata,
  HighlightedToken,
  LineAnnotation,
} from '../src/types';
import { parseDiffFromFile } from '../src/utils/parseDiffFromFile';
import { parsePatchFiles } from '../src/utils/parsePatchFiles';
import {
  createRoot,
  dispatchScroll,
  installDom,
  makeFile,
  renderItems,
  wait,
  waitFor,
} from './domHarness';

type TestEditorComponent<EType extends EditorType> = EType extends 'file'
  ? File<undefined>
  : FileDiff<undefined>;

interface TrackedEditorState {
  /** Instances passed to edit(), in order. */
  edits: Array<File<undefined> | FileDiff<undefined>>;
  fullCleanUps: number;
  recycleCleanUps: number;
}

type TrackedEditor<EType extends EditorType> = Editor<EType, undefined> &
  TrackedEditorState;

type AnyTrackedEditor = TrackedEditor<'file'> | TrackedEditor<'file-diff'>;

// Creates real editors and records lifecycle calls made by CodeView.
function createEditorHarness({
  attachmentError,
}: {
  attachmentError?: Error;
} = {}) {
  const editors: AnyTrackedEditor[] = [];
  const editStateKeys: Array<string | undefined> = [];
  const createEditor = <EType extends EditorType>(
    editorType: EType,
    options: CodeViewCreateEditorOptions<EType, undefined, undefined>,
    editStateKey?: string
  ): Editor<EType, undefined> => {
    editStateKeys.push(editStateKey);
    const editor = new Editor(
      editorType,
      options,
      editStateKey
    ) as TrackedEditor<EType>;
    editor.edits = [];
    editor.fullCleanUps = 0;
    editor.recycleCleanUps = 0;

    const edit = editor.edit.bind(editor);
    editor.edit = (instance: TestEditorComponent<EType>) => {
      editor.edits.push(instance);
      const complete =
        instance.type === 'file'
          ? (edit as (file: File<undefined>) => () => void)(instance)
          : (edit as (fileDiff: FileDiff<undefined>) => () => void)(instance);
      if (attachmentError != null) {
        throw attachmentError;
      }
      return complete;
    };

    const cleanUp = editor.cleanUp.bind(editor);
    editor.cleanUp = (reason) => {
      if (reason === 'recycle') {
        editor.recycleCleanUps += 1;
      } else {
        editor.fullCleanUps += 1;
      }
      cleanUp(reason);
    };

    editors.push(editor as unknown as AnyTrackedEditor);
    return editor;
  };
  return { editors, createEditor, editStateKeys };
}

// Replaces the attached document through the editor's public editing API.
function setSessionText(editor: AnyTrackedEditor, contents: string): void {
  const currentLines = editor.getText().split('\n');
  editor.applyEdits([
    {
      range: {
        start: { line: 0, character: 0 },
        end: {
          line: currentLines.length - 1,
          character: currentLines.at(-1)?.length ?? 0,
        },
      },
      newText: contents,
    },
  ]);
}

function insertAtStart(
  editor: Editor<'file', undefined> | Editor<'file-diff', undefined>,
  text: string
): void {
  editor.applyEdits([
    {
      range: {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 0 },
      },
      newText: text,
    },
  ]);
}

function getEditSessionDiff(instance: unknown): FileDiffMetadata | undefined {
  return (instance as { editSession?: { diff: FileDiffMetadata } }).editSession
    ?.diff;
}

function getEditSessionFile(instance: unknown): FileContents | undefined {
  return (instance as { editSession?: { file: FileContents } }).editSession
    ?.file;
}

function getExternalFile(instance: unknown): FileContents | undefined {
  return (instance as { file?: FileContents }).file;
}

function getRendererDiff(instance: unknown): FileDiffMetadata | undefined {
  return (
    instance as {
      hunksRenderer?: { diffCache?: FileDiffMetadata };
    }
  ).hunksRenderer?.diffCache;
}

function getCachedRenderTarget(
  instance: unknown
): FileContents | FileDiffMetadata | undefined {
  const renderers = instance as {
    fileRenderer?: { renderCache?: { file: FileContents } };
    hunksRenderer?: { renderCache?: { diff: FileDiffMetadata } };
  };
  return (
    renderers.fileRenderer?.renderCache?.file ??
    renderers.hunksRenderer?.renderCache?.diff
  );
}

function makeEditFileItem(
  id: string,
  edit = true,
  lineCount = 20
): CodeViewItem<undefined> {
  return {
    id,
    type: 'file',
    file: makeFile(`${id}.ts`, lineCount),
    version: 0,
    edit,
  };
}

function makeTextEditFileItem(
  id: string,
  edit = true,
  lineCount = 20
): CodeViewItem<undefined> {
  return {
    id,
    type: 'file',
    file: { ...makeFile(`${id}.txt`, lineCount), lang: 'text' },
    version: 0,
    edit,
  };
}

function makeEditDiffItem(id: string, edit = true): CodeViewItem<undefined> {
  return {
    id,
    type: 'diff',
    fileDiff: parseDiffFromFile(
      { name: `${id}.txt`, contents: 'one\ntwo\nthree\n' },
      { name: `${id}.txt`, contents: 'one\ntwo changed\nthree\n' }
    ),
    version: 0,
    edit,
  };
}

// Applies an item update and flushes the render pass that performs editor
// attachment.
async function applyItemUpdate(
  viewer: CodeView,
  item: CodeViewItem<undefined>
): Promise<void> {
  expect(viewer.updateItem(item)).toBe(true);
  viewer.render(true);
  await wait(0);
}

async function expectMissingEditorFactoryOnRender(
  prepare: (viewer: CodeView) => void
): Promise<void> {
  const { cleanup } = installDom();
  const viewer = new CodeView();
  try {
    viewer.setup(createRoot());
    prepare(viewer);
    expect(() => viewer.render(true)).toThrow(
      'CodeView: createEditor is required for items with edit: true'
    );
  } finally {
    await wait(0);
    viewer.cleanUp();
    cleanup();
  }
}

beforeAll(async () => {
  await getSharedHighlighter({
    themes: ['pierre-dark', 'pierre-light'],
    langs: ['typescript'],
    preferredHighlighter: 'shiki-js',
  });
});

describe('programmatic edits on suspended CodeView editors', () => {
  for (const hydrateWhileSuspended of [false, true]) {
    test(`retained diff attaches after partial hydration ${hydrateWhileSuspended ? 'while offscreen' : 'while mounted'}`, async () => {
      const { cleanup } = installDom();
      const key = `partial-delayed-edit-${hydrateWhileSuspended}`;
      const initial = makeEditDiffItem('target');
      if (initial.type !== 'diff') throw new Error('Expected diff item');
      const createEditor = <EType extends EditorType>(
        type: EType,
        options: CodeViewCreateEditorOptions<EType, undefined, undefined>,
        editStateKey?: string
      ): Editor<EType, undefined> => new Editor(type, options, editStateKey);
      const firstViewer = new CodeView({
        createEditor,
        getEditStateKey: () => key,
      });
      let secondViewer: CodeView | undefined;
      try {
        firstViewer.setup(createRoot());
        await renderItems(firstViewer, [initial]);
        const firstEditor = firstViewer.getEditor('target');
        if (firstEditor == null) throw new Error('Expected initial editor');
        insertAtStart(firstEditor, '// prior\n');
        firstViewer.cleanUp();

        const loadedFiles: FileDiffLoadedFiles = {
          oldFile: { name: 'target.txt', contents: 'one\ntwo\nthree\n' },
          newFile: {
            name: 'target.txt',
            contents: 'one\ntwo changed\nthree\n',
          },
        };
        const patch = createTwoFilesPatch(
          'target.txt',
          'target.txt',
          loadedFiles.oldFile.contents,
          loadedFiles.newFile.contents
        );
        const partial = parsePatchFiles(patch, 'partial', true)[0]?.files[0];
        if (partial == null) throw new Error('Expected partial diff');
        let finishLoading: ((files: FileDiffLoadedFiles) => void) | undefined;
        const loadPromise = new Promise<FileDiffLoadedFiles>((resolve) => {
          finishLoading = resolve;
        });
        const changes: string[] = [];
        let attaches = 0;
        secondViewer = new CodeView({
          createEditor: (type, options, editStateKey) =>
            new Editor(
              type,
              {
                ...options,
                onAttach() {
                  attaches++;
                },
                onChange(event) {
                  changes.push(event.file.contents);
                },
              },
              editStateKey
            ),
          getEditStateKey: () => key,
          loadDiffFiles: () => loadPromise,
        });
        const root = createRoot();
        secondViewer.setup(root);
        await renderItems(secondViewer, [
          { ...initial, fileDiff: partial },
          ...Array.from({ length: 39 }, (_, index) =>
            makeEditFileItem(`filler-${index}`, false, 30)
          ),
        ]);
        expect(secondViewer.getEditor('target')).toBeUndefined();
        expect(attaches).toBe(0);
        const instance = secondViewer.getRenderedItems()[0]?.instance;
        expect(getEditSessionDiff(instance)).toBeUndefined();

        if (hydrateWhileSuspended) {
          root.scrollTop = 20_000;
          dispatchScroll(root);
          secondViewer.render(true);
          await wait(0);
          expect(
            secondViewer.getRenderedItems().some(({ id }) => id === 'target')
          ).toBe(false);
        }
        finishLoading?.(loadedFiles);
        if (hydrateWhileSuspended) {
          await wait(0);
          secondViewer.scrollTo({
            type: 'item',
            id: 'target',
            align: 'start',
            behavior: 'instant',
          });
        }
        await waitFor(() => partial.isPartial === false);
        secondViewer.render(true);
        await waitFor(() => secondViewer?.getEditor('target') != null);
        const editor = secondViewer.getEditor('target');
        if (editor == null) throw new Error('Expected hydrated editor');
        await waitFor(() => attaches === 1);
        expect(editor.getText()).toStartWith('// prior\n');
        expect(getEditSessionDiff(instance)?.additionLines.join('')).toBe(
          editor.getText()
        );
        insertAtStart(editor, '// after\n');
        expect(changes.at(-1)).toBe(editor.getText());
        expect(
          secondViewer.getRenderedItems()[0]?.element.shadowRoot?.textContent
        ).toContain('// after');
      } finally {
        secondViewer?.cleanUp();
        firstViewer.cleanUp();
        await wait(0);
        cleanup();
      }
    });
  }

  for (const suspension of ['mounted', 'offscreen'] as const) {
    test(`retained edits restore after a replacement hydrates while ${suspension}`, async () => {
      const { cleanup } = installDom();
      const key = `partial-replacement-${suspension}`;
      const initial = makeEditDiffItem('target');
      if (initial.type !== 'diff') throw new Error('Expected diff item');
      const createEditor = <EType extends EditorType>(
        type: EType,
        options: CodeViewCreateEditorOptions<EType, undefined, undefined>,
        editStateKey?: string
      ): Editor<EType, undefined> => new Editor(type, options, editStateKey);
      const firstViewer = new CodeView({
        createEditor,
        getEditStateKey: () => key,
      });
      let secondViewer: CodeView | undefined;
      try {
        firstViewer.setup(createRoot());
        await renderItems(firstViewer, [initial]);
        const firstEditor = firstViewer.getEditor('target');
        if (firstEditor == null) throw new Error('Expected initial editor');
        insertAtStart(firstEditor, '// prior\n');
        firstViewer.cleanUp();

        const oldFile = { name: 'target.txt', contents: 'one\ntwo\nthree\n' };
        const newFile = {
          name: 'target.txt',
          contents: 'one\ntwo changed\nthree\n',
        };
        const patch = createTwoFilesPatch(
          oldFile.name,
          newFile.name,
          oldFile.contents,
          newFile.contents
        );
        const partial = parsePatchFiles(patch, 'partial', true)[0]?.files[0];
        if (partial == null) throw new Error('Expected partial diff');
        const remoteFile = {
          name: newFile.name,
          contents: 'one\nremote value\nthree\n',
        };
        const replacementPatch = createTwoFilesPatch(
          oldFile.name,
          remoteFile.name,
          oldFile.contents,
          remoteFile.contents
        );
        const replacementPartial = parsePatchFiles(
          replacementPatch,
          'replacement',
          true
        )[0]?.files[0];
        if (replacementPartial == null) {
          throw new Error('Expected replacement partial diff');
        }
        secondViewer = new CodeView({
          createEditor,
          getEditStateKey: () => key,
          loadDiffFiles: (fileDiff) =>
            fileDiff === partial
              ? new Promise<FileDiffLoadedFiles>(() => {})
              : Promise.resolve({ oldFile, newFile: remoteFile }),
        });
        const root = createRoot();
        secondViewer.setup(root);
        await renderItems(secondViewer, [
          { ...initial, fileDiff: partial },
          ...Array.from({ length: 39 }, (_, index) =>
            makeEditFileItem(`filler-${index}`, false, 30)
          ),
        ]);
        expect(secondViewer.getEditor('target')).toBeUndefined();
        if (suspension === 'offscreen') {
          root.scrollTop = 20_000;
          dispatchScroll(root);
          secondViewer.render(true);
          await wait(0);
        }

        const replacement: CodeViewItem<undefined> = {
          ...initial,
          fileDiff: replacementPartial,
          version: 1,
        };
        await applyItemUpdate(secondViewer, replacement);
        if (suspension === 'offscreen') {
          secondViewer.scrollTo({
            type: 'item',
            id: 'target',
            align: 'start',
            behavior: 'instant',
          });
          secondViewer.render(true);
        }
        await waitFor(
          () =>
            secondViewer?.getEditor('target')?.getText() ===
            '// prior\n' + newFile.contents
        );
        const editor = secondViewer.getEditor('target');
        if (editor == null) throw new Error('Expected restored editor');
        expect(editor.getText()).toBe('// prior\n' + newFile.contents);
        expect(editor.canUndo).toBe(true);
        expect(replacementPartial.isPartial).toBe(false);
        expect(
          getEditSessionDiff(
            secondViewer.getRenderedItems()[0]?.instance
          )?.additionLines.join('')
        ).toBe(editor.getText());
        await waitFor(() =>
          Boolean(
            secondViewer
              ?.getRenderedItems()[0]
              ?.element.shadowRoot?.textContent?.includes('prior')
          )
        );
        expect(
          secondViewer.getRenderedItems()[0]?.element.shadowRoot?.textContent
        ).toContain('prior');
      } finally {
        secondViewer?.cleanUp();
        firstViewer.cleanUp();
        await wait(0);
        cleanup();
      }
    });
  }

  test('retained edits restore when a full diff replaces an item before its first attach', async () => {
    const { cleanup } = installDom();
    const key = 'full-replacement-before-attach';
    const initial = makeEditDiffItem('target');
    if (initial.type !== 'diff') throw new Error('Expected diff item');
    const createEditor = <EType extends EditorType>(
      type: EType,
      options: CodeViewCreateEditorOptions<EType, undefined, undefined>,
      editStateKey?: string
    ): Editor<EType, undefined> => new Editor(type, options, editStateKey);
    const firstViewer = new CodeView({
      createEditor,
      getEditStateKey: () => key,
    });
    let secondViewer: CodeView | undefined;
    try {
      firstViewer.setup(createRoot());
      await renderItems(firstViewer, [initial]);
      const firstEditor = firstViewer.getEditor('target');
      if (firstEditor == null) throw new Error('Expected initial editor');
      insertAtStart(firstEditor, '// prior\n');
      firstViewer.cleanUp();

      const replacement: CodeViewItem<undefined> = {
        ...initial,
        fileDiff: parseDiffFromFile(
          { name: 'target.txt', contents: 'one\ntwo\nthree\n' },
          { name: 'target.txt', contents: 'one\nremote value\nthree\n' }
        ),
        version: 1,
      };
      secondViewer = new CodeView({
        createEditor,
        getEditStateKey: () => key,
      });
      secondViewer.setup(createRoot());
      await renderItems(secondViewer, [replacement]);
      const editor = secondViewer.getEditor('target');
      if (editor == null) throw new Error('Expected restored editor');
      expect(editor.getText()).toBe('// prior\none\ntwo changed\nthree\n');
      expect(editor.canUndo).toBe(true);
      expect(
        getEditSessionDiff(
          secondViewer.getRenderedItems()[0]?.instance
        )?.additionLines.join('')
      ).toBe(editor.getText());
    } finally {
      secondViewer?.cleanUp();
      firstViewer.cleanUp();
      await wait(0);
      cleanup();
    }
  });

  for (const type of ['file', 'diff'] as const) {
    for (const suspension of ['scroll', 'collapse'] as const) {
      test(`${type} edits stay visible after ${suspension} suspension`, async () => {
        const { cleanup } = installDom();
        const item =
          type === 'file'
            ? makeEditFileItem('target', true, 30)
            : makeEditDiffItem('target', true);
        const fillers =
          suspension === 'scroll'
            ? Array.from({ length: 39 }, (_, index) =>
                makeEditFileItem(`filler-${index}`, false, 30)
              )
            : [];
        const changes: Array<{ document: string; session: string }> = [];
        let instance: unknown;
        const sessionText = (): string => {
          if (type === 'file') {
            return getEditSessionFile(instance)?.contents ?? '';
          }
          return getEditSessionDiff(instance)?.additionLines.join('') ?? '';
        };
        const viewer = new CodeView({
          createEditor: (editorType, options, key) =>
            new Editor(
              editorType,
              {
                ...options,
                onChange(event) {
                  changes.push({
                    document: event.file.contents,
                    session: sessionText(),
                  });
                },
              },
              key
            ),
        });
        const root = createRoot();
        try {
          viewer.setup(root);
          await renderItems(viewer, [item, ...fillers]);
          instance = viewer.getRenderedItems()[0]?.instance;
          const editor = viewer.getEditor('target');
          if (editor == null) throw new Error('Expected target editor');
          const insert = (text: string): void => {
            editor.applyEdits([
              {
                range: {
                  start: { line: 0, character: 0 },
                  end: { line: 0, character: 0 },
                },
                newText: text,
              },
            ]);
          };

          if (suspension === 'scroll') {
            root.scrollTop = 20_000;
            dispatchScroll(root);
            viewer.render(true);
            await wait(0);
            expect(
              viewer.getRenderedItems().some(({ id }) => id === 'target')
            ).toBe(false);
          } else {
            await applyItemUpdate(viewer, {
              ...item,
              collapsed: true,
              version: 1,
            });
            // Theme invalidation can leave a suspended session without a
            // highlighted result. Its source still has to accept edits.
            viewer.getRenderedItems()[0]?.instance.onThemeChange();
          }

          insert('// changed ');
          insert('// inserted\n');
          expect(editor.getText()).toStartWith('// inserted\n// changed ');
          expect(sessionText()).toStartWith('// inserted\n// changed ');
          expect(changes.at(-1)?.session).toStartWith(
            '// inserted\n// changed '
          );
          editor.undo();
          expect(sessionText()).toStartWith('// changed ');
          editor.redo();
          expect(sessionText()).toStartWith('// inserted\n// changed ');
          editor.applyEdits([
            {
              range: {
                start: { line: 0, character: 0 },
                end: { line: 1, character: 0 },
              },
              newText: '',
            },
          ]);
          expect(sessionText()).toStartWith('// changed ');
          editor.undo();
          expect(sessionText()).toStartWith('// inserted\n// changed ');
          expect(
            changes.every(({ document, session }) => document === session)
          ).toBe(true);
          expect(getCachedRenderTarget(instance)).toBeUndefined();

          if (suspension === 'scroll') {
            viewer.scrollTo({
              type: 'item',
              id: 'target',
              align: 'start',
              behavior: 'instant',
            });
            viewer.render(true);
            await waitFor(() =>
              viewer.getRenderedItems().some(({ id }) => id === 'target')
            );
          } else {
            await applyItemUpdate(viewer, {
              ...item,
              collapsed: false,
              version: 2,
            });
          }
          const remounted = viewer
            .getRenderedItems()
            .find(({ id }) => id === 'target');
          expect(remounted).toBeDefined();
          expect(remounted?.element.shadowRoot?.textContent).toContain(
            '// inserted'
          );
          expect(remounted?.element.shadowRoot?.textContent).toContain(
            '// changed'
          );
          expect(viewer.getEditor('target')).toBe(editor);
        } finally {
          viewer.cleanUp();
          await wait(0);
          cleanup();
        }
      });
    }
  }

  for (const type of ['file', 'diff'] as const) {
    for (const finish of ['edit off', 'removal'] as const) {
      test(`${type} completion after a suspended edit and ${finish} uses current text`, async () => {
        const { cleanup } = installDom();
        const item =
          type === 'file'
            ? makeEditFileItem('target')
            : makeEditDiffItem('target');
        const completions: string[] = [];
        const viewer = new CodeView({
          createEditor: (editorType, options, key) =>
            new Editor(editorType, options, key),
          onItemEditComplete(event) {
            const completedFile = 'file' in event ? event.file : event.newFile;
            if (completedFile == null) {
              throw new Error('Expected completed file contents');
            }
            completions.push(completedFile.contents);
            return 'reject';
          },
        });
        try {
          viewer.setup(createRoot());
          await renderItems(viewer, [item]);
          const instance = viewer.getRenderedItems()[0]?.instance;
          const sessionTarget =
            type === 'file'
              ? getEditSessionFile(instance)
              : getEditSessionDiff(instance);
          const editor = viewer.getEditor('target');
          if (editor == null) throw new Error('Expected target editor');
          await applyItemUpdate(viewer, {
            ...item,
            collapsed: true,
            version: 1,
          });
          editor.applyEdits([
            {
              range: {
                start: { line: 0, character: 0 },
                end: { line: 0, character: 0 },
              },
              newText: '// completion\n',
            },
          ]);
          expect(editor.getText()).toStartWith('// completion\n');

          if (finish === 'edit off') {
            await applyItemUpdate(viewer, {
              ...item,
              collapsed: true,
              edit: false,
              version: 2,
            });
          } else {
            await renderItems(viewer, []);
          }
          expect(completions).toHaveLength(1);
          expect(completions[0]).toStartWith('// completion\n');
          expect(viewer.getEditor('target')).toBeUndefined();
          expect(getCachedRenderTarget(instance)).not.toBe(sessionTarget);
        } finally {
          viewer.cleanUp();
          await wait(0);
          cleanup();
        }
      });
    }
  }
});

afterAll(async () => {
  await disposeHighlighter();
});

describe('CodeView item edit mode', () => {
  test('releases an unhydratable partial item when editor preparation throws', () => {
    const { cleanup } = installDom();
    const root = createRoot();
    const viewer = new CodeView({
      createEditor: (type, options) => new Editor(type, options),
    });
    const partial = parsePatchFiles(
      [
        'diff --git a/new.txt b/new.txt\n',
        'new file mode 100644\n',
        'index 0000000..1111111\n',
        '--- /dev/null\n',
        '+++ b/new.txt\n',
        '@@ -0,0 +1 @@\n',
        '+hello\n',
      ].join(''),
      'new.txt',
      true
    )[0]?.files[0];
    if (partial == null) throw new Error('Expected partial diff');
    try {
      viewer.setup(root);
      viewer.setItems([
        { id: 'new', type: 'diff', fileDiff: partial, version: 0, edit: true },
      ]);
      expect(() => viewer.render(true)).toThrow(
        'this partial diff cannot be hydrated'
      );
      expect(root.querySelector('diffs-container')).toBeNull();
    } finally {
      viewer.cleanUp();
      cleanup();
    }
  });

  test('validates the factory only when a rendered item needs an editor', async () => {
    await expectMissingEditorFactoryOnRender((viewer) => {
      const initial = makeTextEditFileItem('initial', true, 2);
      expect(() => viewer.setItems([initial])).not.toThrow();
      expect(viewer.getItem(initial.id)).toBe(initial);
    });

    await expectMissingEditorFactoryOnRender((viewer) => {
      const existing = makeTextEditFileItem('existing', false, 2);
      viewer.setItems([existing]);
      viewer.render(true);
      const controlled = makeTextEditFileItem('controlled', true, 2);
      expect(() =>
        viewer.setItems([{ ...existing, version: 1 }, controlled])
      ).not.toThrow();
      expect(viewer.getItem(controlled.id)).toBe(controlled);
    });

    await expectMissingEditorFactoryOnRender((viewer) => {
      const addedReadOnly = makeTextEditFileItem('added-read-only', false, 2);
      const addedEdited = makeTextEditFileItem('added-edited', true, 2);
      expect(() => viewer.addItems([addedReadOnly, addedEdited])).not.toThrow();
      expect(viewer.getItem(addedReadOnly.id)).toBe(addedReadOnly);
      expect(viewer.getItem(addedEdited.id)).toBe(addedEdited);
    });

    await expectMissingEditorFactoryOnRender((viewer) => {
      const existing = makeTextEditFileItem('existing', false, 2);
      viewer.setItems([existing]);
      viewer.render(true);
      const updated = { ...existing, edit: true, version: 1 };
      expect(viewer.updateItem(updated)).toBe(true);
      expect(viewer.getItem(existing.id)).toBe(updated);
    });
  });

  test('does not validate an offscreen edited item until it is rendered', async () => {
    const { cleanup } = installDom();
    const viewer = new CodeView();
    const edited = makeTextEditFileItem('edited', true, 30);
    const items = [
      ...Array.from({ length: 39 }, (_, index) =>
        makeTextEditFileItem(`read-only-${index}`, false, 30)
      ),
      edited,
    ];

    try {
      viewer.setup(createRoot({ height: 200 }));
      viewer.setItems(items);

      expect(() => viewer.render(true)).not.toThrow();
      expect(
        viewer.getRenderedItems().some((item) => item.id === edited.id)
      ).toBe(false);

      viewer.scrollTo({
        type: 'item',
        id: edited.id,
        align: 'start',
        behavior: 'instant',
      });
      expect(() => viewer.render(true)).toThrow(
        'CodeView: createEditor is required for items with edit: true'
      );
    } finally {
      await wait(0);
      viewer.cleanUp();
      cleanup();
    }
  });

  test('uses the factory only when creating an edit session', async () => {
    const { cleanup } = installDom();
    const { editors, createEditor } = createEditorHarness();
    const viewer = new CodeView({ createEditor });
    const active = makeTextEditFileItem('active');

    try {
      viewer.setup(createRoot());
      await renderItems(viewer, [active]);
      const editor = editors[0];

      viewer.setOptions({});
      viewer.render(true);
      expect(viewer.getEditor(active.id)).toBe(editor);
      expect(editor.fullCleanUps).toBe(0);

      const readOnly = { ...active, edit: false, version: 1 };
      await applyItemUpdate(viewer, readOnly);
      expect(editor.fullCleanUps).toBe(1);

      expect(viewer.updateItem({ ...readOnly, edit: true, version: 2 })).toBe(
        true
      );
      expect(() => viewer.render(true)).toThrow(
        'CodeView: createEditor is required for items with edit: true'
      );
    } finally {
      await wait(0);
      viewer.cleanUp();
      cleanup();
    }
  });

  test('resolves an edit state key only when creating an item editor', async () => {
    const { cleanup } = installDom();
    const { createEditor, editStateKeys, editors } = createEditorHarness();
    const resolvedIds: string[] = [];
    let revision = 'first';
    const viewer = new CodeView({
      createEditor,
      getEditStateKey(item) {
        resolvedIds.push(item.id);
        return `${item.id}:${revision}`;
      },
    });
    const item = makeEditFileItem('a');

    try {
      viewer.setup(createRoot());
      await renderItems(viewer, [item]);
      expect(editStateKeys).toEqual(['a:first']);
      expect(resolvedIds).toEqual(['a']);

      expect(viewer.updateItemId('a', 'renamed')).toBe(true);
      const renamed = viewer.getItem('renamed')!;
      await applyItemUpdate(viewer, {
        ...renamed,
        collapsed: true,
        version: 1,
      });
      await applyItemUpdate(viewer, {
        ...renamed,
        collapsed: false,
        version: 2,
      });
      expect(editors).toHaveLength(1);
      expect(editStateKeys).toEqual(['a:first']);
      expect(resolvedIds).toEqual(['a']);

      await applyItemUpdate(viewer, {
        ...renamed,
        edit: false,
        version: 3,
      });
      revision = 'second';
      await applyItemUpdate(viewer, {
        ...renamed,
        edit: true,
        version: 4,
      });
      expect(editors).toHaveLength(2);
      expect(editStateKeys).toEqual(['a:first', 'renamed:second']);
      expect(resolvedIds).toEqual(['a', 'renamed']);
    } finally {
      viewer.cleanUp();
      await wait(0);
      cleanup();
    }
  });

  test('attaches factory editors to edit-mode items on mount', async () => {
    const { cleanup } = installDom();
    const { editors, createEditor } = createEditorHarness();
    const viewer = new CodeView({ createEditor });
    try {
      viewer.setup(createRoot());
      await renderItems(viewer, [
        makeEditFileItem('a'),
        makeEditFileItem('b', false),
      ]);

      expect(editors.length).toBe(1);
      const renderedA = viewer
        .getRenderedItems()
        .find((item) => item.id === 'a');
      expect(editors[0].edits).toEqual([renderedA!.instance]);
      expect(viewer.getEditor('a')).toBe(editors[0]);
      expect(viewer.getEditor('b')).toBeUndefined();
    } finally {
      viewer.cleanUp();
      await wait(0);
      cleanup();
    }
  });

  test('cleans a newly created editor when attachment fails', async () => {
    const { cleanup } = installDom();
    const attachmentError = new Error('attachment failed');
    const { editors, createEditor } = createEditorHarness({
      attachmentError,
    });
    const viewer = new CodeView({ createEditor });
    try {
      viewer.setup(createRoot());
      viewer.setItems([makeEditFileItem('a')]);

      expect(() => viewer.render(true)).toThrow(attachmentError);
      expect(editors).toHaveLength(1);
      expect(editors[0].fullCleanUps).toBe(1);
      expect(viewer.getEditor('a')).toBeUndefined();
    } finally {
      viewer.cleanUp();
      await wait(0);
      cleanup();
    }
  });

  test('supports multiple simultaneously edited items', async () => {
    const { cleanup } = installDom();
    const { editors, createEditor } = createEditorHarness();
    const viewer = new CodeView({ createEditor });
    try {
      viewer.setup(createRoot());
      await renderItems(viewer, [makeEditFileItem('a'), makeEditDiffItem('b')]);

      expect(editors.length).toBe(2);
      expect(viewer.getEditor('a')).toBeDefined();
      expect(viewer.getEditor('b')).toBeDefined();
      expect(viewer.getEditor('a')).not.toBe(viewer.getEditor('b')!);
    } finally {
      viewer.cleanUp();
      await wait(0);
      cleanup();
    }
  });

  test('edited items keep pass-through options untouched', async () => {
    const { cleanup } = installDom();
    const { createEditor } = createEditorHarness();
    const viewer = new CodeView({
      createEditor,
      enableLineSelection: true,
      enableGutterUtility: true,
      lineHoverHighlight: 'both',
      expandUnchanged: false,
      useTokenTransformer: false,
    });
    const editedFile = makeEditFileItem('a');
    try {
      viewer.setup(createRoot());
      await renderItems(viewer, [
        editedFile,
        makeEditDiffItem('b'),
        makeEditFileItem('c', false),
      ]);

      const [renderedA, renderedB, renderedC] = viewer.getRenderedItems();
      // Edited items keep the pass-through options untouched; the edit
      // session supplies token markup without rewriting them.
      for (const rendered of [renderedA, renderedB]) {
        expect(rendered.instance.options.useTokenTransformer).toBe(false);
        expect(rendered.instance.options.enableLineSelection).toBe(true);
        expect(rendered.instance.options.enableGutterUtility).toBe(true);
        expect(rendered.instance.options.lineHoverHighlight).toBe('both');
      }
      if (renderedB.type !== 'diff') {
        throw new Error('expected a rendered diff item');
      }
      // Collapsed unchanged regions stay collapsed during editing; the item
      // serves the pass-through value.
      expect(renderedB.instance.options.expandUnchanged).toBe(false);
      // ...while non-edited siblings keep the parent options.
      expect(renderedC.instance.options.useTokenTransformer).toBe(false);
      expect(renderedC.instance.options.enableLineSelection).toBe(true);
      expect(renderedC.instance.options.enableGutterUtility).toBe(true);
      expect(renderedC.instance.options.lineHoverHighlight).toBe('both');

      // Toggling edit off restores the pass-through values.
      await applyItemUpdate(viewer, { ...editedFile, edit: false, version: 1 });
      const restoredA = viewer.getRenderedItems()[0];
      expect(restoredA.instance.options.useTokenTransformer).toBe(false);
      expect(restoredA.instance.options.enableLineSelection).toBe(true);
      expect(restoredA.instance.options.enableGutterUtility).toBe(true);
      expect(restoredA.instance.options.lineHoverHighlight).toBe('both');
    } finally {
      viewer.cleanUp();
      await wait(0);
      cleanup();
    }
  });

  test('toggling edit off discards the editor; re-toggling creates a fresh one', async () => {
    const { cleanup } = installDom();
    const { editors, createEditor } = createEditorHarness();
    const viewer = new CodeView({ createEditor });
    const item = makeEditFileItem('a');
    try {
      viewer.setup(createRoot());
      await renderItems(viewer, [item]);
      expect(editors.length).toBe(1);

      await applyItemUpdate(viewer, { ...item, edit: false, version: 1 });
      expect(editors[0].fullCleanUps).toBe(1);
      expect(viewer.getEditor('a')).toBeUndefined();

      await applyItemUpdate(viewer, { ...item, edit: true, version: 2 });
      expect(editors.length).toBe(2);
      expect(viewer.getEditor('a')).toBe(editors[1]);
    } finally {
      viewer.cleanUp();
      await wait(0);
      cleanup();
    }
  });

  test('collapsed wins over edit', async () => {
    const { cleanup } = installDom();
    const { editors, createEditor } = createEditorHarness();
    const viewer = new CodeView({ createEditor });
    const item = makeEditFileItem('a');
    try {
      viewer.setup(createRoot());
      // A collapsed edit-mode item never attaches an editor.
      await renderItems(viewer, [{ ...item, collapsed: true }]);
      expect(editors.length).toBe(0);

      // Expanding it attaches; collapsing it again detaches the editor but
      // keeps it suspended for the next expand.
      await applyItemUpdate(viewer, { ...item, collapsed: false, version: 1 });
      expect(editors.length).toBe(1);
      expect(viewer.getEditor('a')).toBe(editors[0]);

      await applyItemUpdate(viewer, { ...item, collapsed: true, version: 2 });
      expect(editors[0].recycleCleanUps).toBe(1);
      expect(editors[0].fullCleanUps).toBe(0);
      expect(viewer.getEditor('a')).toBe(editors[0]);

      // Expanding re-attaches the same editor; no new editor is created.
      await applyItemUpdate(viewer, { ...item, collapsed: false, version: 3 });
      expect(editors.length).toBe(1);
      expect(editors[0].edits.length).toBe(2);
    } finally {
      viewer.cleanUp();
      await wait(0);
      cleanup();
    }
  });

  for (const [itemType, makeItem] of [
    ['file', () => makeEditFileItem('a')],
    ['diff', () => makeEditDiffItem('a')],
  ] as const) {
    test(`collapse preserves ${itemType} contents and undo history`, async () => {
      const { cleanup } = installDom();
      const viewer = new CodeView({
        createEditor: (editorType, options) => new Editor(editorType, options),
      });
      const item = makeItem();
      try {
        viewer.setup(createRoot());
        await renderItems(viewer, [item]);
        const editor = viewer.getEditor(item.id);
        if (editor == null) {
          throw new Error('Expected an editor for the expanded item');
        }
        const originalContents = editor.getText();

        editor.applyEdits([
          {
            range: {
              start: { line: 0, character: 0 },
              end: { line: 0, character: 0 },
            },
            newText: 'edited ',
          },
        ]);
        expect(editor.getText()).toBe(`edited ${originalContents}`);

        await applyItemUpdate(viewer, {
          ...item,
          collapsed: true,
          version: 1,
        });
        await applyItemUpdate(viewer, {
          ...item,
          collapsed: false,
          version: 2,
        });

        expect(viewer.getEditor(item.id)).toBe(editor);
        expect(editor.getText()).toBe(`edited ${originalContents}`);
        editor.undo();
        expect(editor.getText()).toBe(originalContents);
      } finally {
        viewer.cleanUp();
        await wait(0);
        cleanup();
      }
    });
  }

  test('entering edit mode preserves the item line selection', async () => {
    const { cleanup } = installDom();
    const { createEditor } = createEditorHarness();
    const viewer = new CodeView({
      createEditor,
      enableLineSelection: true,
      onLineSelectionChange() {},
    });
    const item = makeEditFileItem('a', false);
    try {
      viewer.setup(createRoot());
      await renderItems(viewer, [item]);

      viewer.setSelectedLines({ id: 'a', range: { start: 1, end: 2 } });
      expect(viewer.getSelectedLines()).not.toBeNull();
      const rendered = viewer.getRenderedItems()[0];
      expect(rendered.instance.options.onLineSelectionChange).toBeDefined();

      await applyItemUpdate(viewer, { ...item, edit: true, version: 1 });
      expect(viewer.getSelectedLines()).toEqual({
        id: 'a',
        range: { start: 1, end: 2 },
      });
      expect(rendered.instance.options.onLineSelectionChange).toBeDefined();

      rendered.instance.options.onLineSelectionChange?.({ start: 2, end: 3 });
      expect(viewer.getSelectedLines()).toEqual({
        id: 'a',
        range: { start: 2, end: 3 },
      });
    } finally {
      viewer.cleanUp();
      await wait(0);
      cleanup();
    }
  });

  test('removing an edited item cleans up its editor', async () => {
    const { cleanup } = installDom();
    const { editors, createEditor } = createEditorHarness();
    const viewer = new CodeView({ createEditor });
    const kept = makeEditFileItem('kept', false);
    try {
      viewer.setup(createRoot());
      await renderItems(viewer, [makeEditFileItem('a'), kept]);
      expect(editors.length).toBe(1);

      await renderItems(viewer, [kept]);
      expect(editors[0].fullCleanUps).toBeGreaterThanOrEqual(1);
      expect(viewer.getEditor('a')).toBeUndefined();
    } finally {
      viewer.cleanUp();
      await wait(0);
      cleanup();
    }
  });

  test('reuses the same editor across virtualization unmount and remount', async () => {
    const { cleanup } = installDom();
    const { editors, createEditor } = createEditorHarness();
    const viewer = new CodeView({ createEditor });
    const items: CodeViewItem<undefined>[] = [
      makeEditFileItem('edited', true, 30),
      ...Array.from({ length: 39 }, (_, index) =>
        makeEditFileItem(`file-${index}`, false, 30)
      ),
    ];
    try {
      const root = createRoot();
      viewer.setup(root);
      await renderItems(viewer, items);
      expect(editors.length).toBe(1);
      const [editor] = editors;
      expect(editor.edits.length).toBe(1);

      // Scroll the edited item out of the render window: the instance recycles
      // and detaches the editor non-destructively.
      root.scrollTop = 20_000;
      dispatchScroll(root);
      viewer.render(true);
      await wait(0);
      expect(editor.recycleCleanUps).toBe(1);
      expect(editor.fullCleanUps).toBe(0);
      expect(viewer.getEditor('edited')).toBe(editor);

      // Scrolling back re-attaches the same editor to the same instance.
      root.scrollTop = 0;
      dispatchScroll(root);
      viewer.render(true);
      await wait(0);
      expect(editors.length).toBe(1);
      expect(editor.edits.length).toBe(2);
      expect(editor.edits[1]).toBe(editor.edits[0]);
    } finally {
      viewer.cleanUp();
      await wait(0);
      cleanup();
    }
  });

  test('remounts an edited file whose document grew without crashing', async () => {
    const { cleanup } = installDom();
    const { createEditor } = createEditorHarness();
    const viewer = new CodeView({ createEditor });
    const items: CodeViewItem<undefined>[] = [
      makeEditFileItem('edited', true, 30),
      ...Array.from({ length: 39 }, (_, index) =>
        makeEditFileItem(`file-${index}`, false, 30)
      ),
    ];
    try {
      const root = createRoot();
      viewer.setup(root);
      await renderItems(viewer, items);

      // Mimic an edit session that grew the document: the editor pushes the
      // larger document into the host, which patches its render caches and
      // remembers the document's line count.
      const edited = viewer.getRenderedItems()[0];
      if (edited.type !== 'file') {
        throw new Error('Expected an edited file');
      }
      const lineCount = 40;
      const documentText = Array.from(
        { length: lineCount },
        (_, i) => `edited ${i}`
      ).join('\n');
      edited.instance.applyDocumentChange(
        new TextDocument<'file', undefined>(
          'inmemory://code-view-file',
          documentText
        )
      );

      // Scroll the edited item out (recycle) and back in. The private session
      // keeps its patched render cache, so the remount renders its grown
      // document without changing the caller-owned item.
      root.scrollTop = 20_000;
      dispatchScroll(root);
      viewer.render(true);
      await wait(0);

      root.scrollTop = 0;
      dispatchScroll(root);
      viewer.render(true);
      await wait(0);

      const remounted = viewer.getRenderedItems()[0];
      expect(remounted.id).toBe('edited');
      if (remounted.type !== 'file') {
        throw new Error('Expected the edited file to remount');
      }
      // Render errors are caught and rendered as an error wrapper instead of
      // propagating, so assert on the rendered result: no error panel, and
      // the session's 40 lines rendered.
      const shadowRoot = remounted.element.shadowRoot;
      expect(shadowRoot?.querySelector('[data-error-wrapper]')).toBeNull();
      expect(shadowRoot?.querySelectorAll('[data-line]').length).toBe(
        lineCount
      );
      expect(getEditSessionFile(remounted.instance)?.contents).toBe(
        documentText
      );
      expect(items[0].type === 'file' && items[0].file.contents).not.toBe(
        documentText
      );
    } finally {
      viewer.cleanUp();
      await wait(0);
      cleanup();
    }
  });

  test('a mid-session document change reconciles the file item layout', async () => {
    const { cleanup } = installDom();
    const { createEditor } = createEditorHarness();
    const viewer = new CodeView({ createEditor });
    const items: CodeViewItem<undefined>[] = [
      makeEditFileItem('edited', true, 200),
      makeEditFileItem('below', false, 10),
    ];
    try {
      const root = createRoot();
      viewer.setup(root);
      await renderItems(viewer, items);
      const heightBefore = viewer.getScrollHeight();
      const belowTopBefore = viewer.getTopForItem('below');
      if (belowTopBefore == null) {
        throw new Error('Expected a layout top for the below item.');
      }
      expect(
        viewer.getRenderedItems().some((rendered) => rendered.id === 'below')
      ).toBe(false);

      const edited = viewer.getRenderedItems()[0];
      if (edited.type !== 'file') {
        throw new Error('Expected an edited file');
      }
      edited.instance.applyDocumentChange(
        new TextDocument<'file', undefined>(
          'inmemory://code-view-shrunk',
          'only line'
        )
      );
      await wait(0);

      expect(viewer.getScrollHeight()).toBeLessThan(heightBefore);
      expect(viewer.getTopForItem('below')).toBeLessThan(belowTopBefore);
      // The shrunken item frees the window, so the next item mounts.
      expect(
        viewer.getRenderedItems().some((rendered) => rendered.id === 'below')
      ).toBe(true);
    } finally {
      viewer.cleanUp();
      await wait(0);
      cleanup();
    }
  });

  test('a mid-session document change reconciles a diff item that scrolls out', async () => {
    const { cleanup } = installDom();
    const { createEditor } = createEditorHarness();
    const viewer = new CodeView({ createEditor });
    const items: CodeViewItem<undefined>[] = [
      makeEditDiffItem('edited', true),
      ...Array.from({ length: 5 }, (_, index) =>
        makeEditFileItem(`file-${index}`, false, 100)
      ),
    ];
    try {
      const root = createRoot();
      viewer.setup(root);
      await renderItems(viewer, items);
      const heightBefore = viewer.getScrollHeight();

      const lineCount = 40;
      const documentText = Array.from(
        { length: lineCount },
        (_, i) => `edited ${i}`
      ).join('\n');
      const edited = viewer.getRenderedItems()[0];
      if (edited.type !== 'diff') {
        throw new Error('Expected an edited diff');
      }
      edited.instance.applyDocumentChange(
        new TextDocument<'file-diff', undefined>(
          'inmemory://code-view-diff',
          documentText
        )
      );
      // Scroll the edited item out before any render pass reconciles it: the
      // released item's cached layout height must still pick up the change.
      root.scrollTop = 10_000;
      dispatchScroll(root);
      viewer.render(true);
      await wait(0);

      expect(
        viewer.getRenderedItems().some((rendered) => rendered.id === 'edited')
      ).toBe(false);
      expect(viewer.getScrollHeight()).toBeGreaterThan(heightBefore);
    } finally {
      viewer.cleanUp();
      await wait(0);
      cleanup();
    }
  });

  test('remounts an edited file with the session text after a recycle', async () => {
    const { cleanup } = installDom();
    const { createEditor } = createEditorHarness();
    const viewer = new CodeView({ createEditor });
    const items: CodeViewItem<undefined>[] = [
      makeEditFileItem('edited', true, 30),
      ...Array.from({ length: 39 }, (_, index) =>
        makeEditFileItem(`file-${index}`, false, 30)
      ),
    ];
    try {
      const root = createRoot();
      viewer.setup(root);
      await renderItems(viewer, items);

      // Mimic a same-line-count edit: the editor pushes the dirty line's
      // tokens into the host render caches, exactly like #applyChange does
      // after a keystroke.
      const edited = viewer.getRenderedItems()[0];
      const tokens: HighlightedToken[] = [[0, '', 'edited marker line']];
      edited.instance.updateRenderCache(new Map([[0, tokens]]), 'light');

      // Scroll the edited item out (recycle) and back in. The private session
      // retains its patched render cache across the remount.
      root.scrollTop = 20_000;
      dispatchScroll(root);
      viewer.render(true);
      await wait(0);

      root.scrollTop = 0;
      dispatchScroll(root);
      viewer.render(true);
      await wait(0);

      const remounted = viewer.getRenderedItems()[0];
      expect(remounted.id).toBe('edited');
      if (remounted.type !== 'file') {
        throw new Error('Expected the edited file to remount');
      }
      const shadowRoot = remounted.element.shadowRoot;
      expect(shadowRoot?.querySelector('[data-error-wrapper]')).toBeNull();
      expect(shadowRoot?.textContent).toContain('edited marker line');
      // The remaining lines are untouched and the caller-owned item is not.
      const file = items[0].type === 'file' ? items[0].file : undefined;
      expect(getEditSessionFile(remounted.instance)?.contents).toStartWith(
        'edited marker line\n'
      );
      expect(getEditSessionFile(remounted.instance)?.contents).toContain(
        'line 2'
      );
      expect(file?.contents.startsWith('edited marker line\n')).toBe(false);
    } finally {
      viewer.cleanUp();
      await wait(0);
      cleanup();
    }
  });

  test('entering edit mode keeps the collapsed layout height', async () => {
    const { cleanup } = installDom();
    const { createEditor } = createEditorHarness();
    const viewer = new CodeView({ createEditor });
    // A diff with a large unchanged region: collapsed regions stay collapsed
    // during editing, so entering edit mode must not change the layout.
    const oldContents = Array.from(
      { length: 60 },
      (_, index) => `line ${index}`
    ).join('\n');
    const newContents = oldContents.replace('line 30', 'line 30 changed');
    const item: CodeViewItem<undefined> = {
      id: 'd',
      type: 'diff',
      fileDiff: parseDiffFromFile(
        { name: 'd.txt', contents: oldContents },
        { name: 'd.txt', contents: newContents }
      ),
      version: 0,
      edit: false,
    };
    try {
      viewer.setup(createRoot());
      await renderItems(viewer, [item]);
      const collapsedHeight = viewer.getScrollHeight();

      await applyItemUpdate(viewer, { ...item, edit: true, version: 1 });
      expect(viewer.getScrollHeight()).toBe(collapsedHeight);

      await applyItemUpdate(viewer, { ...item, edit: false, version: 2 });
      expect(viewer.getScrollHeight()).toBe(collapsedHeight);
    } finally {
      viewer.cleanUp();
      await wait(0);
      cleanup();
    }
  });

  test('user-space onItemEditComplete handler commits a finished session', async () => {
    const { cleanup } = installDom();
    // The recommended handler shape: stamp a fresh cacheKey on the completed
    // file and return the nextItem CodeView built. CodeView installs the
    // file and applies nextItem through updateItem itself.
    const viewer: CodeView = new CodeView({
      createEditor: (editorType, options) =>
        new Editor(editorType, { ...options }),
      onItemEditComplete(event, item, nextItem) {
        if (item.type !== 'file' || !('file' in event)) {
          return 'accept';
        }
        event.file.cacheKey = `${item.id}:v${nextItem.version}`;
        return 'accept';
      },
    });
    const item = makeEditFileItem('edited', true, 30);
    try {
      viewer.setup(createRoot());
      await renderItems(viewer, [item]);
      await wait(10);

      const editor = viewer.getEditor('edited') as
        | Editor<'file', undefined>
        | undefined;
      if (editor == null) {
        throw new Error('Expected an editor for the edited file');
      }
      // Insert ten lines at the top of the document.
      editor.applyEdits(
        [
          {
            range: {
              start: { line: 0, character: 0 },
              end: { line: 0, character: 0 },
            },
            newText:
              Array.from({ length: 10 }, (_, i) => `inserted ${i}`).join('\n') +
              '\n',
          },
        ],
        true
      );
      await wait(10);

      // Turning edit off ends the session; the completion handler above
      // commits the final contents back into the item.
      await applyItemUpdate(viewer, { ...item, edit: false, version: 1 });
      expect(viewer.getEditor('edited')).toBeUndefined();
      const committed = viewer.getItem('edited');
      expect(committed?.type === 'file' && committed.file.contents).toContain(
        'inserted 0'
      );

      // The committed contents render in review mode, error-free.
      viewer.render(true);
      await wait(10);
      const rendered = viewer.getRenderedItems()[0];
      const shadowRoot = rendered.element.shadowRoot;
      expect(shadowRoot?.querySelector('[data-error-wrapper]')).toBeNull();
      expect(shadowRoot?.querySelectorAll('[data-line]').length).toBe(40);
      expect(shadowRoot?.textContent).toContain('inserted 0');
    } finally {
      viewer.cleanUp();
      await wait(0);
      cleanup();
    }
  });

  test('a real editor restores horizontal state without moving the shared viewport', async () => {
    const { cleanup } = installDom();
    const completions: FileEditCompleteEvent<undefined, undefined>[] = [];
    const completionStates: EditorViewState[] = [];
    const viewer = new CodeView({
      createEditor: (editorType, options) => new Editor(editorType, options),
      onItemEditComplete(event) {
        if ('file' in event) {
          completions.push(event);
          completionStates.push(event.editor.getViewState());
        }
        return 'reject';
      },
    });
    const item = makeEditFileItem('recycled-state');
    if (item.type !== 'file') {
      throw new Error('Expected a file item');
    }
    const root = createRoot();

    try {
      viewer.setup(root);
      await renderItems(viewer, [item]);
      const editor = viewer.getEditor(item.id) as
        | Editor<'file', undefined>
        | undefined;
      await waitFor(() => editor?.getText() === item.file.contents);
      if (editor == null) {
        throw new Error('Expected an editor for the recycled file');
      }
      editor.applyEdits([
        {
          range: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 0 },
          },
          newText: 'X',
        },
      ]);
      editor.setSelections([
        {
          start: { line: 0, character: 3 },
          end: { line: 0, character: 3 },
          direction: 'none',
        },
      ]);
      const code = viewer
        .getRenderedItems()[0]
        ?.element.shadowRoot?.querySelector('[data-code]');
      expect(code).toBeInstanceOf(HTMLElement);
      (code as HTMLElement).scrollLeft = 24;
      root.scrollTop = 48;
      const finalState: EditorViewState = {
        selections: [
          {
            start: { line: 0, character: 3 },
            end: { line: 0, character: 3 },
            direction: 0,
          },
        ],
        view: { scrollLeft: 24 },
      };

      await applyItemUpdate(viewer, {
        ...item,
        collapsed: true,
        version: 1,
      });
      expect(completions).toHaveLength(0);
      expect(viewer.getEditor(item.id)?.getViewState()).toEqual(finalState);
      root.scrollTop = 72;
      await applyItemUpdate(viewer, {
        ...item,
        collapsed: false,
        version: 2,
      });
      const remountedCode = viewer
        .getRenderedItems()[0]
        ?.element.shadowRoot?.querySelector('[data-code]');
      expect(remountedCode).toBeInstanceOf(HTMLElement);
      await waitFor(() => (remountedCode as HTMLElement).scrollLeft === 24);
      expect(root.scrollTop).toBe(72);
      await applyItemUpdate(viewer, {
        ...item,
        collapsed: true,
        edit: false,
        version: 3,
      });

      expect(completions).toHaveLength(1);
      expect(completionStates[0]).toEqual(finalState);
    } finally {
      viewer.cleanUp();
      await wait(0);
      cleanup();
    }
  });

  test('updateItemId keeps the editor and routes changes to the renamed item', async () => {
    const { cleanup } = installDom();
    const { editors, createEditor } = createEditorHarness();
    const changes: string[] = [];
    const viewer = new CodeView({
      createEditor,
      onItemEditChange(_event, item) {
        changes.push(item.id);
      },
    });
    try {
      viewer.setup(createRoot());
      await renderItems(viewer, [makeEditFileItem('a')]);

      expect(viewer.updateItemId('a', 'a2')).toBe(true);
      expect(viewer.getEditor('a')).toBeUndefined();
      expect(viewer.getEditor('a2')).toBe(editors[0]);

      insertAtStart(editors[0], 'renamed:');
      expect(changes).toEqual(['a2']);
    } finally {
      viewer.cleanUp();
      await wait(0);
      cleanup();
    }
  });

  test('onItemEditChange receives the owning item and contents', async () => {
    const { cleanup } = installDom();
    const { editors, createEditor } = createEditorHarness();
    const changes: Array<[string, string, EditorViewState]> = [];
    const viewer = new CodeView({
      createEditor,
      onItemEditChange(event, item) {
        changes.push([
          item.id,
          event.file.contents,
          event.editor.getViewState(),
        ]);
      },
    });
    try {
      viewer.setup(createRoot());
      await renderItems(viewer, [makeEditFileItem('a')]);

      const state: EditorViewState = {
        selections: [
          {
            start: { line: 0, character: 1 },
            end: { line: 0, character: 1 },
            direction: 0,
          },
        ],
      };
      editors[0].setViewState(state);
      setSessionText(editors[0], 'edited');
      expect(changes).toEqual([
        [
          'a',
          'edited',
          {
            selections: [
              {
                start: { line: 0, character: 6 },
                end: { line: 0, character: 6 },
                direction: 0,
              },
            ],
            view: { scrollLeft: 0 },
          },
        ],
      ]);
    } finally {
      viewer.cleanUp();
      await wait(0);
      cleanup();
    }
  });

  test('an edited diff emits a change when it accepts a compatible item update', async () => {
    const { cleanup } = installDom();
    const editors: Array<
      Editor<'file', undefined> | Editor<'file-diff', undefined>
    > = [];
    const changes: string[] = [];
    const initial = makeEditDiffItem('active');
    if (initial.type !== 'diff') {
      throw new Error('Expected a diff item.');
    }
    initial.fileDiff.cacheKey = 'active:v1';
    const viewer = new CodeView({
      createEditor(editorType, options) {
        const editor = new Editor(editorType, options);
        editors.push(
          editor as Editor<'file', undefined> | Editor<'file-diff', undefined>
        );
        return editor;
      },
      onItemEditChange(event) {
        changes.push(event.file.contents);
      },
    });

    try {
      viewer.setup(createRoot());
      await renderItems(viewer, [initial]);
      await waitFor(
        () => editors[0]?.getText() === 'one\ntwo changed\nthree\n'
      );
      const editor = editors[0];

      editor.applyEdits([
        {
          range: {
            start: { line: 1, character: 0 },
            end: { line: 1, character: 'two changed'.length },
          },
          newText: 'local value',
        },
      ]);
      expect(changes).toEqual(['one\nlocal value\nthree\n']);

      const replacement: CodeViewItem<undefined> = {
        ...initial,
        fileDiff: parseDiffFromFile(
          { name: 'active.txt', contents: 'one\ntwo\nthree\n' },
          { name: 'active.txt', contents: 'one\nexternal value\nthree\n' }
        ),
        version: 1,
      };
      replacement.fileDiff.cacheKey = 'active:v2';
      await applyItemUpdate(viewer, replacement);
      await waitFor(() => editor.getText() === 'one\nexternal value\nthree\n', {
        timeout: 4_000,
      });

      expect(viewer.getEditor('active')).toBe(editor);
      expect(editors).toHaveLength(1);
      expect(changes).toEqual([
        'one\nlocal value\nthree\n',
        'one\nexternal value\nthree\n',
      ]);
      expect(
        viewer.getRenderedItems()[0]?.element.shadowRoot?.textContent
      ).toContain('external value');

      editor.undo();
      expect(editor.getText()).toBe('one\nlocal value\nthree\n');
      expect(changes).toEqual([
        'one\nlocal value\nthree\n',
        'one\nexternal value\nthree\n',
        'one\nlocal value\nthree\n',
      ]);
    } finally {
      viewer.cleanUp();
      await wait(0);
      cleanup();
    }
  });

  test('an edited diff accepts an external update received while recycled', async () => {
    const { cleanup } = installDom();
    const editors: Array<
      Editor<'file', undefined> | Editor<'file-diff', undefined>
    > = [];
    const changes: string[] = [];
    const initial = makeEditDiffItem('active');
    if (initial.type !== 'diff') {
      throw new Error('Expected a diff item.');
    }
    initial.fileDiff.cacheKey = 'active:v1';
    const items = [
      initial,
      ...Array.from({ length: 39 }, (_, index) =>
        makeEditFileItem(`file-${index}`, false, 30)
      ),
    ];
    const viewer = new CodeView({
      createEditor(editorType, options) {
        const editor = new Editor(editorType, options);
        editors.push(
          editor as Editor<'file', undefined> | Editor<'file-diff', undefined>
        );
        return editor;
      },
      onItemEditChange(event) {
        changes.push(event.file.contents);
      },
    });

    try {
      const root = createRoot();
      viewer.setup(root);
      await renderItems(viewer, items);
      await waitFor(
        () => editors[0]?.getText() === 'one\ntwo changed\nthree\n'
      );
      const editor = editors[0];
      editor.applyEdits([
        {
          range: {
            start: { line: 1, character: 0 },
            end: { line: 1, character: 'two changed'.length },
          },
          newText: 'local value',
        },
      ]);

      const rendered = viewer.getRenderedItems()[0];
      const previousSession = getEditSessionDiff(rendered.instance);
      root.scrollTop = 30_000;
      dispatchScroll(root);
      viewer.render(true);
      await wait(0);
      expect(
        viewer.getRenderedItems().some((item) => item.id === initial.id)
      ).toBe(false);

      const replacement: CodeViewItem<undefined> = {
        ...initial,
        fileDiff: parseDiffFromFile(
          { name: 'active.txt', contents: 'one\ntwo\nthree\n' },
          { name: 'active.txt', contents: 'one\nexternal value\nthree\n' }
        ),
        version: 1,
      };
      replacement.fileDiff.cacheKey = 'active:v2';
      await applyItemUpdate(viewer, replacement);

      const replacementSession = getEditSessionDiff(rendered.instance);
      expect(replacementSession).not.toBe(previousSession);
      expect(replacementSession?.additionLines.join('')).toBe(
        'one\nexternal value\nthree\n'
      );
      expect(changes).toEqual(['one\nlocal value\nthree\n']);

      root.scrollTop = 0;
      dispatchScroll(root);
      viewer.render(true);
      await waitFor(() => editor.getText() === 'one\nexternal value\nthree\n', {
        timeout: 4_000,
      });

      expect(viewer.getEditor('active')).toBe(editor);
      expect(editors).toHaveLength(1);
      expect(changes).toEqual([
        'one\nlocal value\nthree\n',
        'one\nexternal value\nthree\n',
      ]);
      editor.undo();
      expect(editor.getText()).toBe('one\nlocal value\nthree\n');
    } finally {
      viewer.cleanUp();
      await wait(0);
      cleanup();
    }
  });

  test('an edited file accepts an external update received while recycled', async () => {
    const { cleanup } = installDom();
    const editors: Array<
      Editor<'file', undefined> | Editor<'file-diff', undefined>
    > = [];
    const changes: string[] = [];
    const initial = makeEditFileItem('active');
    if (initial.type !== 'file') {
      throw new Error('Expected a file item.');
    }
    initial.file.cacheKey = 'active:v1';
    const items = [
      initial,
      ...Array.from({ length: 39 }, (_, index) =>
        makeEditFileItem(`file-${index}`, false, 30)
      ),
    ];
    const viewer = new CodeView({
      createEditor(editorType, options) {
        const editor = new Editor(editorType, options);
        editors.push(
          editor as Editor<'file', undefined> | Editor<'file-diff', undefined>
        );
        return editor;
      },
      onItemEditChange(event) {
        changes.push(event.file.contents);
      },
    });
    const localContents = 'local value\n';
    const externalContents = 'external value\n';

    try {
      const root = createRoot();
      viewer.setup(root);
      await renderItems(viewer, items);
      await waitFor(() => editors[0]?.getText() === initial.file.contents);
      const editor = editors[0];
      editor.applyEdits([
        {
          range: {
            start: { line: 0, character: 0 },
            end: {
              line: Number.MAX_SAFE_INTEGER,
              character: Number.MAX_SAFE_INTEGER,
            },
          },
          newText: localContents,
        },
      ]);

      const rendered = viewer.getRenderedItems()[0];
      const previousSession = getEditSessionFile(rendered.instance);
      root.scrollTop = 30_000;
      dispatchScroll(root);
      viewer.render(true);
      await wait(0);
      expect(
        viewer.getRenderedItems().some((item) => item.id === initial.id)
      ).toBe(false);

      const replacement: CodeViewItem<undefined> = {
        ...initial,
        file: {
          ...initial.file,
          contents: externalContents,
          cacheKey: 'active:v2',
        },
        version: 1,
      };
      await applyItemUpdate(viewer, replacement);

      const replacementSession = getEditSessionFile(rendered.instance);
      expect(replacementSession).not.toBe(previousSession);
      expect(replacementSession?.contents).toBe(externalContents);
      expect(changes).toEqual([localContents]);

      root.scrollTop = 0;
      dispatchScroll(root);
      viewer.render(true);
      await waitFor(() => editor.getText() === externalContents, {
        timeout: 4_000,
      });

      expect(viewer.getEditor('active')).toBe(editor);
      expect(editors).toHaveLength(1);
      expect(changes).toEqual([localContents, externalContents]);
      editor.undo();
      expect(editor.getText()).toBe(localContents);
    } finally {
      viewer.cleanUp();
      await wait(0);
      cleanup();
    }
  });

  test('an edited diff hydrates an external update received while recycled', async () => {
    const { cleanup } = installDom();
    const editors: Array<
      Editor<'file', undefined> | Editor<'file-diff', undefined>
    > = [];
    const loadedFiles: FileDiffLoadedFiles = {
      oldFile: { name: 'active.txt', contents: 'one\ntwo\nthree\n' },
      newFile: {
        name: 'active.txt',
        contents: 'one\nexternal value\nthree\n',
      },
    };
    const initial = makeEditDiffItem('active');
    if (initial.type !== 'diff') {
      throw new Error('Expected a diff item.');
    }
    initial.fileDiff.cacheKey = 'active:v1';
    const viewer = new CodeView({
      createEditor(editorType, options) {
        const editor = new Editor(editorType, options);
        editors.push(
          editor as Editor<'file', undefined> | Editor<'file-diff', undefined>
        );
        return editor;
      },
      loadDiffFiles: () => Promise.resolve(loadedFiles),
    });

    try {
      const root = createRoot();
      viewer.setup(root);
      await renderItems(viewer, [
        initial,
        ...Array.from({ length: 39 }, (_, index) =>
          makeEditFileItem(`file-${index}`, false, 30)
        ),
      ]);
      await waitFor(
        () => editors[0]?.getText() === 'one\ntwo changed\nthree\n'
      );
      const editor = editors[0];
      editor.applyEdits([
        {
          range: {
            start: { line: 1, character: 0 },
            end: { line: 1, character: 'two changed'.length },
          },
          newText: 'local value',
        },
      ]);

      root.scrollTop = 30_000;
      dispatchScroll(root);
      viewer.render(true);
      await wait(0);
      expect(
        viewer.getRenderedItems().some((item) => item.id === initial.id)
      ).toBe(false);

      const patch = createTwoFilesPatch(
        'active.txt',
        'active.txt',
        loadedFiles.oldFile.contents,
        loadedFiles.newFile.contents
      );
      const partial = parsePatchFiles(patch, 'partial', true)[0]?.files[0];
      if (partial == null) {
        throw new Error('Expected a partial diff.');
      }
      partial.cacheKey = 'active:v2';
      await applyItemUpdate(viewer, {
        ...initial,
        fileDiff: partial,
        version: 1,
      });

      root.scrollTop = 0;
      dispatchScroll(root);
      viewer.render(true);
      await waitFor(() => editor.getText() === 'one\nexternal value\nthree\n', {
        timeout: 4_000,
      });

      expect(partial.isPartial).toBe(false);
      expect(viewer.getEditor('active')).toBe(editor);
      expect(editors).toHaveLength(1);
      editor.undo();
      expect(editor.getText()).toBe('one\nlocal value\nthree\n');
    } finally {
      viewer.cleanUp();
      await wait(0);
      cleanup();
    }
  });

  test('forwards file and diff annotation collections by reference', async () => {
    const { cleanup } = installDom();
    const { editors, createEditor } = createEditorHarness();
    const changes: Array<{
      item: CodeViewItem<undefined>;
      lineAnnotations:
        | LineAnnotation<undefined>[]
        | DiffLineAnnotation<undefined>[]
        | undefined;
    }> = [];
    const viewer = new CodeView({
      createEditor,
      onItemEditChange(event, item) {
        changes.push({ item, lineAnnotations: event.lineAnnotations });
      },
    });
    try {
      viewer.setup(createRoot());
      const fileAnnotations: LineAnnotation<undefined>[] = [{ lineNumber: 2 }];
      const diffAnnotations: DiffLineAnnotation<undefined>[] = [
        { side: 'additions', lineNumber: 2 },
      ];
      const fileItem = makeEditFileItem('file');
      const diffItem = makeEditDiffItem('diff');
      fileItem.annotations = fileAnnotations;
      diffItem.annotations = diffAnnotations;
      await renderItems(viewer, [fileItem, diffItem]);

      insertAtStart(editors[0], 'file:');
      insertAtStart(editors[1], 'diff:');

      expect(changes.length).toBe(2);
      expect(changes[0].item.type).toBe('file');
      expect(changes[0].item.id).toBe('file');
      // The delivered collection is the exact array the editor reported, so
      // consumers can bail on reference equality for unaffected edits.
      expect(changes[0].lineAnnotations).toBe(fileAnnotations);
      expect(changes[1].item.type).toBe('diff');
      expect(changes[1].item.id).toBe('diff');
      expect(changes[1].lineAnnotations).toBe(diffAnnotations);
    } finally {
      viewer.cleanUp();
      await wait(0);
      cleanup();
    }
  });

  describe('edit-session hunks across virtualization', () => {
    // A diff item whose session state is observable: two separated changes
    // (lines 10 and 40 of 60) produce two hunks, and reverting one of them
    // mid-session leaves a context-only hunk that only the genuine-exit
    // recompute may collapse away.
    function makeSessionDiffItem(id: string): CodeViewItem<undefined> {
      const oldContents =
        Array.from({ length: 60 }, (_, index) => `line ${index}`).join('\n') +
        '\n';
      const newContents = oldContents
        .replace('line 10\n', 'line 10 changed\n')
        .replace('line 40\n', 'line 40 changed\n');
      return {
        id,
        type: 'diff',
        fileDiff: parseDiffFromFile(
          { name: `${id}.txt`, contents: oldContents, cacheKey: `${id}:old` },
          { name: `${id}.txt`, contents: newContents, cacheKey: `${id}:new` }
        ),
        version: 0,
        edit: true,
      };
    }

    function revertLineTen(item: CodeViewItem<undefined>, viewer: CodeView) {
      const rendered = viewer
        .getRenderedItems()
        .find((entry) => entry.id === item.id);
      expect(rendered).toBeDefined();
      const tokens: HighlightedToken[] = [[0, '', 'line 10']];
      rendered!.instance.updateRenderCache(new Map([[10, tokens]]), 'light');
    }

    test('a region-changing render flushes deferred line state', async () => {
      const { cleanup } = installDom();
      const { createEditor } = createEditorHarness();
      const viewer = new CodeView({ createEditor });
      const edited = makeSessionDiffItem('edited');
      if (edited.type !== 'diff') {
        throw new Error('Expected a diff edit-session item.');
      }
      try {
        viewer.setup(createRoot());
        await renderItems(viewer, [edited]);

        const rendered = viewer.getRenderedItems()[0];
        expect(rendered).toBeDefined();
        const externalBefore = structuredClone(edited.fileDiff);
        const externalHunks = edited.fileDiff.hunks;
        rendered.instance.updateRenderCache(
          new Map([[25, [[0, '', 'line 25 changed']]]]),
          'light'
        );
        expect(edited.fileDiff).toEqual(externalBefore);
        expect(edited.fileDiff.hunks).toBe(externalHunks);

        rendered.instance.setSelectedLines({ start: 26, end: 26 });
        rendered.instance.setEditorActiveLine(26);
        await wait(0);

        const shadowRoot = rendered.element.shadowRoot;
        const additions = shadowRoot?.querySelector(
          '[data-code]:not([data-deletions])'
        );
        const row = additions?.querySelector(
          '[data-content] > [data-line="26"]'
        );
        expect(row).not.toBeNull();
        expect(row?.hasAttribute('data-selected-line')).toBe(true);
        expect(row?.hasAttribute('data-editor-active-line')).toBe(true);

        // The completed render must also release later writes immediately.
        rendered.instance.setSelectedLines(null);
        rendered.instance.setEditorActiveLine(null);
        expect(row?.hasAttribute('data-selected-line')).toBe(false);
        expect(row?.hasAttribute('data-editor-active-line')).toBe(false);
      } finally {
        viewer.cleanUp();
        await wait(0);
        cleanup();
      }
    });

    test('session-shaped hunks survive a recycle and remount', async () => {
      const { cleanup } = installDom();
      const { editors, createEditor } = createEditorHarness();
      const viewer = new CodeView({ createEditor });
      const edited = makeSessionDiffItem('edited');
      if (edited.type !== 'diff') {
        throw new Error('Expected a diff edit-session item.');
      }
      const items: CodeViewItem<undefined>[] = [
        edited,
        ...Array.from({ length: 39 }, (_, index) =>
          makeEditFileItem(`file-${index}`, false, 30)
        ),
      ];
      try {
        const root = createRoot();
        viewer.setup(root);
        await renderItems(viewer, items);
        await wait(10);

        const rendered = viewer.getRenderedItems()[0];
        const externalBefore = structuredClone(edited.fileDiff);
        const externalHunks = edited.fileDiff.hunks;

        // Revert one hunk mid-session: it persists as a context-only region.
        revertLineTen(edited, viewer);
        const sessionDiff = getEditSessionDiff(rendered.instance);
        expect(sessionDiff?.hunks).toHaveLength(2);
        expect(sessionDiff?.hunks[0].hunkContent[0].type).toBe('context');
        expect(sessionDiff?.editSessionDirty).toBe(true);
        expect(edited.fileDiff).toEqual(externalBefore);
        expect(edited.fileDiff.hunks).toBe(externalHunks);

        // Scroll out (recycle): no exit recompute may run.
        root.scrollTop = 30_000;
        dispatchScroll(root);
        viewer.render(true);
        await wait(0);
        expect(editors[0].recycleCleanUps).toBe(1);
        expect(getEditSessionDiff(rendered.instance)).toBe(sessionDiff);
        expect(sessionDiff?.hunks).toHaveLength(2);
        expect(sessionDiff?.editSessionDirty).toBe(true);
        expect(edited.fileDiff).toEqual(externalBefore);

        // Scroll back: the same editor re-attaches and the session-shaped
        // hunks are still in place.
        root.scrollTop = 0;
        dispatchScroll(root);
        viewer.render(true);
        await wait(0);
        expect(editors[0].edits.length).toBe(2);
        const remounted = viewer
          .getRenderedItems()
          .find((entry) => entry.id === edited.id);
        expect(remounted).toBeDefined();
        expect(getEditSessionDiff(remounted?.instance)).toBe(sessionDiff);
        expect(getRendererDiff(remounted?.instance)).toBe(sessionDiff);
        expect(sessionDiff?.hunks).toHaveLength(2);
        expect(sessionDiff?.hunks[0].hunkContent[0].type).toBe('context');
        expect(edited.fileDiff).toEqual(externalBefore);
      } finally {
        viewer.cleanUp();
        await wait(0);
        cleanup();
      }
    });
  });

  describe('onItemEditComplete', () => {
    interface Completion {
      event:
        | FileEditCompleteEvent<undefined, undefined>
        | FileDiffEditCompleteEvent<undefined, undefined>;
      item: CodeViewItem<undefined>;
    }

    test('fires once with the completed session file when edit is turned off', async () => {
      const { cleanup } = installDom();
      const { editors, createEditor } = createEditorHarness();
      const completions: Completion[] = [];
      const viewer = new CodeView({
        createEditor,
        onItemEditComplete(event, item) {
          expect(event.editor).toBe(editors[0]);
          completions.push({ event, item });
          return 'reject';
        },
      });
      const item = makeEditFileItem('a');
      try {
        viewer.setup(createRoot());
        await renderItems(viewer, [item]);

        setSessionText(editors[0], 'draft');
        setSessionText(editors[0], 'final');
        expect(completions.length).toBe(0);

        await applyItemUpdate(viewer, { ...item, edit: false, version: 1 });
        expect(completions.length).toBe(1);
        const [{ event, item: completedItem }] = completions;
        if (!('file' in event)) {
          throw new Error('Expected a file completion event');
        }
        expect(event.file.contents).toBe('final');
        expect(event.file.cacheKey).toBeUndefined();
        if (item.type !== 'file') {
          throw new Error('Expected a file item');
        }
        // The event's original value is the item's exact external file, and
        // the item handed to the callback is the one that ended the session.
        expect(event.originalFile).toBe(item.file);
        expect(editors[0].getViewState()).toEqual({});
        expect(completedItem.edit).toBe(false);
        expect(completedItem.version).toBe(1);
      } finally {
        viewer.cleanUp();
        await wait(0);
        cleanup();
      }
    });

    test('returning nextItem accepts the edit and routes through updateItem', async () => {
      const { cleanup } = installDom();
      const { editors, createEditor } = createEditorHarness();
      const viewer = new CodeView({
        createEditor,
        onItemEditComplete(event, item, nextItem) {
          if (item.type !== 'file' || !('file' in event)) {
            return 'reject';
          }
          event.file.cacheKey = `${item.id}:v${nextItem.version}`;
          return 'accept';
        },
      });
      const item = makeEditFileItem('a');
      try {
        viewer.setup(createRoot());
        await renderItems(viewer, [item]);
        const instance = editors[0].edits[0];

        setSessionText(editors[0], 'accepted');
        await applyItemUpdate(viewer, { ...item, edit: false, version: 1 });

        const committed = viewer.getItem('a');
        expect(committed?.type === 'file' && committed.file.contents).toBe(
          'accepted'
        );
        expect(committed?.version).toBe(2);
        // The instance installed the exact accepted file at completion.
        expect(committed?.type === 'file' ? committed.file : undefined).toBe(
          getExternalFile(instance)
        );
      } finally {
        viewer.cleanUp();
        await wait(0);
        cleanup();
      }
    });

    test('returning null reverts the instance to the item file', async () => {
      const { cleanup } = installDom();
      const { editors, createEditor } = createEditorHarness();
      const viewer = new CodeView({
        createEditor,
        onItemEditComplete() {
          return 'reject';
        },
      });
      const item = makeEditFileItem('a');
      try {
        viewer.setup(createRoot());
        await renderItems(viewer, [item]);
        const instance = editors[0].edits[0];

        setSessionText(editors[0], 'rejected');
        await applyItemUpdate(viewer, { ...item, edit: false, version: 1 });

        expect(getExternalFile(instance)).toBe(
          item.type === 'file' ? item.file : undefined
        );
        expect(getEditSessionFile(instance)).toBeUndefined();
      } finally {
        viewer.cleanUp();
        await wait(0);
        cleanup();
      }
    });

    test('returning the given item reverts like null', async () => {
      const { cleanup } = installDom();
      const { editors, createEditor } = createEditorHarness();
      const viewer = new CodeView({
        createEditor,
        onItemEditComplete() {
          return 'reject';
        },
      });
      const item = makeEditFileItem('a');
      try {
        viewer.setup(createRoot());
        await renderItems(viewer, [item]);
        const instance = editors[0].edits[0];

        setSessionText(editors[0], 'rejected');
        await applyItemUpdate(viewer, { ...item, edit: false, version: 1 });

        expect(getExternalFile(instance)).toBe(
          item.type === 'file' ? item.file : undefined
        );
        expect(getEditSessionFile(instance)).toBeUndefined();
      } finally {
        viewer.cleanUp();
        await wait(0);
        cleanup();
      }
    });

    test('fires with the removal-time item and never reinserts it', async () => {
      const { cleanup } = installDom();
      const { editors, createEditor } = createEditorHarness();
      const completions: Completion[] = [];
      const viewer = new CodeView({
        createEditor,
        onItemEditComplete(event, item, _nextItem) {
          completions.push({ event, item });
          // Accepting a removed item records the result but must not put the
          // item back into the collection.
          return 'accept';
        },
      });
      const removed = makeEditFileItem('a');
      const kept = makeEditFileItem('kept', false);
      try {
        viewer.setup(createRoot());
        await renderItems(viewer, [removed, kept]);

        setSessionText(editors[0], 'unsaved');
        await renderItems(viewer, [kept]);

        expect(completions.length).toBe(1);
        expect(completions[0].item).toBe(removed);
        const { event } = completions[0];
        if (!('file' in event)) {
          throw new Error('Expected a file completion event');
        }
        expect(event.file.contents).toBe('unsaved');
        expect(viewer.getItem('a')).toBeUndefined();
      } finally {
        viewer.cleanUp();
        await wait(0);
        cleanup();
      }
    });

    test('collapse suspends the session and edit-off completes it later', async () => {
      const { cleanup } = installDom();
      const { editors, createEditor } = createEditorHarness();
      const completions: Completion[] = [];
      const viewer = new CodeView({
        createEditor,
        onItemEditComplete(event, item) {
          completions.push({ event, item });
          return 'reject';
        },
      });
      const item = makeEditFileItem('a');
      try {
        viewer.setup(createRoot());
        await renderItems(viewer, [item]);

        setSessionText(editors[0], 'kept across collapse');
        await applyItemUpdate(viewer, { ...item, collapsed: true, version: 1 });
        expect(completions.length).toBe(0);
        expect(editors[0].recycleCleanUps).toBe(1);
        expect(editors[0].fullCleanUps).toBe(0);
        expect(viewer.getEditor('a')).toBe(editors[0]);

        await applyItemUpdate(viewer, {
          ...item,
          collapsed: false,
          version: 2,
        });
        expect(editors.length).toBe(1);
        expect(editors[0].edits.length).toBe(2);

        await applyItemUpdate(viewer, { ...item, edit: false, version: 3 });
        expect(completions.length).toBe(1);
        const { event } = completions[0];
        if (!('file' in event)) {
          throw new Error('Expected a file completion event');
        }
        expect(event.file.contents).toBe('kept across collapse');
      } finally {
        viewer.cleanUp();
        await wait(0);
        cleanup();
      }
    });

    test('fires for sessions without changes', async () => {
      const { cleanup } = installDom();
      const { createEditor } = createEditorHarness();
      let completions = 0;
      const viewer = new CodeView({
        createEditor,
        onItemEditComplete() {
          completions += 1;
          return 'reject';
        },
      });
      const item = makeEditFileItem('a');
      try {
        viewer.setup(createRoot());
        await renderItems(viewer, [item]);

        await applyItemUpdate(viewer, { ...item, edit: false, version: 1 });
        expect(completions).toBe(1);
      } finally {
        viewer.cleanUp();
        await wait(0);
        cleanup();
      }
    });

    test('fires when a controlled empty list removes the edited item', async () => {
      const { cleanup } = installDom();
      const { editors, createEditor } = createEditorHarness();
      const completions: Array<{ id: string; contents: string }> = [];
      const snapshots: Array<
        CodeViewSlotSnapshot<undefined, undefined> | undefined
      > = [];
      const replacement = makeEditFileItem('a', false);
      const onItemEditComplete = (
        event:
          | FileEditCompleteEvent<undefined, undefined>
          | FileDiffEditCompleteEvent<undefined, undefined>,
        item: CodeViewItem<undefined>
      ): EditCompletionDecision => {
        if ('file' in event) {
          completions.push({ id: item.id, contents: event.file.contents });
        }
        viewer.addItems([replacement]);
        return 'reject';
      };
      const viewer = new CodeView({
        createEditor,
        onItemEditComplete,
      });
      const coordinator: CodeViewCoordinator<undefined, undefined> = {
        hasAnnotationRenderer: false,
        hasGutterRenderer: false,
        hasHeaderRenderers: true,
        onSnapshotChange(snapshot) {
          snapshots.push(snapshot);
        },
      };
      try {
        viewer.setSlotCoordinator(coordinator);
        viewer.setup(createRoot());
        await renderItems(viewer, [makeEditFileItem('a')]);
        const initialElement = viewer.getRenderedItems()[0]?.element;

        // setItems([]) is a removal like any other controlled update, so the
        // session completes with the session's contents.
        setSessionText(editors[0], 'unsaved');
        await renderItems(viewer, []);

        expect(completions).toEqual([{ id: 'a', contents: 'unsaved' }]);
        expect(editors[0].fullCleanUps).toBeGreaterThanOrEqual(1);
        expect(viewer.getItem(replacement.id)).toBe(replacement);
        const renderedReplacement = viewer.getRenderedItems()[0];
        expect(renderedReplacement?.element).toBe(initialElement);
        expect(snapshots).toHaveLength(2);
        expect(snapshots[1]?.items?.[0]?.instance).toBe(
          renderedReplacement?.instance
        );
      } finally {
        viewer.cleanUp();
        await wait(0);
        cleanup();
      }
    });

    test('a direct cleanUp completes changed sessions without installing', async () => {
      const { cleanup } = installDom();
      const { editors, createEditor } = createEditorHarness();
      const completions: Completion[] = [];
      const item = makeEditFileItem('a');
      const viewer = new CodeView({
        createEditor,
        onItemEditComplete(event, completing, _nextItem) {
          completions.push({ event, item: completing });
          return 'accept';
        },
      });
      try {
        viewer.setup(createRoot());
        await renderItems(viewer, [item]);
        const instance = editors[0].edits[0];

        setSessionText(editors[0], 'unsaved');
        viewer.cleanUp();
        await wait(0);

        expect(completions.length).toBe(1);
        const { event } = completions[0];
        if (!('file' in event)) {
          throw new Error('Expected a file completion event');
        }
        expect(event.file.contents).toBe('unsaved');
        if (item.type !== 'file') {
          throw new Error('Expected a file item');
        }
        expect(event.originalFile).toBe(item.file);
        // Teardown never installs the result: the session is settled and the
        // returned item is not applied anywhere.
        expect(getEditSessionFile(instance)).toBeUndefined();
        expect(editors[0].fullCleanUps).toBeGreaterThanOrEqual(1);
      } finally {
        viewer.cleanUp();
        await wait(0);
        cleanup();
      }
    });

    test('a direct reset discards accepted session output', async () => {
      const { cleanup } = installDom();
      const { editors, createEditor } = createEditorHarness();
      const completions: Completion[] = [];
      const viewer = new CodeView({
        createEditor,
        onItemEditComplete(event, item) {
          completions.push({ event, item });
          return 'accept';
        },
      });
      try {
        viewer.setup(createRoot());
        await renderItems(viewer, [makeEditFileItem('a')]);

        setSessionText(editors[0], 'unsaved');
        viewer.reset();
        await wait(0);

        expect(completions.length).toBe(1);
        expect(completions[0].item.id).toBe('a');
        expect(editors[0].fullCleanUps).toBeGreaterThanOrEqual(1);

        // Accepting cannot retain the removed item, and cleanUp after the reset
        // finds no session left to complete.
        viewer.cleanUp();
        await wait(0);
        expect(completions.length).toBe(1);
      } finally {
        viewer.cleanUp();
        await wait(0);
        cleanup();
      }
    });
  });
});
