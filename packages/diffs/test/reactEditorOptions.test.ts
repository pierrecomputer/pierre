import { afterAll, describe, expect, mock, spyOn, test } from 'bun:test';
import { createTwoFilesPatch } from 'diff';
import {
  act,
  type ComponentType,
  createElement,
  type PropsWithChildren,
  type ReactElement,
  StrictMode,
} from 'react';
import { createRoot as createReactRoot, type Root } from 'react-dom/client';

import {
  type FileEditCompleteEvent,
  type FileEditCompleteHandler,
  File as FileInstance,
  type FileOptions,
} from '../src/components/File';
import {
  type FileDiffEditCompleteEvent,
  type FileDiffEditCompleteHandler,
  FileDiff as FileDiffInstance,
  type FileDiffOptions,
} from '../src/components/FileDiff';
import { DEFAULT_THEMES } from '../src/constants';
import { Editor, type EditorOptions } from '../src/editor/editor';
import { EditStateManager } from '../src/editor/EditStateManager';
import { disposeHighlighter } from '../src/highlighter/shared_highlighter';
import {
  MultiFileDiff,
  type MultiFileDiffProps,
  PatchDiff,
  type PatchDiffProps,
  File as ReactFile,
  FileDiff as ReactFileDiff,
  type FileProps as ReactFileProps,
  Virtualizer,
} from '../src/react';
import {
  type CreateEditor,
  EditProvider,
  type EditProviderProps,
} from '../src/react/EditContext';
import { type FileDiffProps as ReactFileDiffProps } from '../src/react/FileDiff';
import type {
  DiffsEditableComponent,
  DiffsEditor,
  EditableInstance,
  EditorChangeEvent,
  EditorDocumentKind,
  FileContents,
  LineAnnotation,
} from '../src/types';
import { parseDiffFromFile } from '../src/utils/parseDiffFromFile';
import { installDom, wait, waitFor } from './domHarness';

afterAll(async () => {
  await disposeHighlighter();
});

const ReactFileComponent = ReactFile as ComponentType<
  ReactFileProps<undefined>
>;
const ReactFileDiffComponent = ReactFileDiff as ComponentType<
  ReactFileDiffProps<undefined>
>;
const EditProviderComponent = EditProvider as ComponentType<
  PropsWithChildren<EditProviderProps<undefined>>
>;
const MultiFileDiffComponent = MultiFileDiff as ComponentType<
  MultiFileDiffProps<undefined>
>;
const PatchDiffComponent = PatchDiff as ComponentType<
  PatchDiffProps<undefined>
>;

function createEditor(
  documentKind: EditorDocumentKind,
  options: EditorOptions<undefined>
): Editor<undefined> {
  return new Editor(documentKind, options);
}

class TrackedEditor extends Editor<undefined> {
  cleanUpCount = 0;

  override cleanUp(reason?: 'discard' | 'recycle' | 'complete'): void {
    this.cleanUpCount += 1;
    super.cleanUp(reason);
  }
}

class AttachmentFailingEditor extends TrackedEditor {
  constructor(
    documentKind: EditorDocumentKind,
    options: EditorOptions<undefined>,
    private readonly attachmentError: Error
  ) {
    super(documentKind, options);
  }

  override edit<T extends DiffsEditableComponent<undefined>>(
    _fileInstance: EditableInstance<T>
  ): () => void {
    throw this.attachmentError;
  }
}

function installReactActEnvironment(): () => void {
  const hadValue = Reflect.has(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
  const previousValue = Reflect.get(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
  return () => {
    if (hadValue) {
      Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', previousValue);
    } else {
      Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
    }
  };
}

interface AnimationFrameController {
  flush(): void;
  pendingCount(): number;
  restore(): void;
}

// Holds frame callbacks so a test can end an edit session after attachment
// synchronization but before the deferred onAttach notification runs.
function holdAnimationFrames(): AnimationFrameController {
  const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
  const originalCancelAnimationFrame = globalThis.cancelAnimationFrame;
  const callbacks = new Map<number, FrameRequestCallback>();
  let nextFrameId = 0;

  globalThis.requestAnimationFrame = (callback: FrameRequestCallback) => {
    const frameId = ++nextFrameId;
    callbacks.set(frameId, callback);
    return frameId;
  };
  globalThis.cancelAnimationFrame = (frameId: number) => {
    callbacks.delete(frameId);
  };

  return {
    flush() {
      const pendingCallbacks = [...callbacks.values()];
      callbacks.clear();
      for (const callback of pendingCallbacks) {
        callback(performance.now());
      }
    },
    pendingCount() {
      return callbacks.size;
    },
    restore() {
      globalThis.requestAnimationFrame = originalRequestAnimationFrame;
      globalThis.cancelAnimationFrame = originalCancelAnimationFrame;
    },
  };
}

async function unmountRoot(root: Root | undefined): Promise<void> {
  if (root == null) {
    return;
  }
  await act(async () => {
    root.unmount();
    await wait(0);
  });
}

async function captureRenderError(
  root: Root,
  element: ReactElement
): Promise<unknown> {
  try {
    await act(async () => {
      root.render(element);
      await wait(10);
    });
  } catch (error) {
    return unwrapRenderError(error);
  }
  return undefined;
}

function unwrapRenderError(error: unknown): unknown {
  if (!(error instanceof AggregateError)) {
    return error;
  }
  for (const nestedError of error.errors) {
    const unwrapped = unwrapRenderError(nestedError);
    if (unwrapped instanceof Error && unwrapped.message !== '') {
      return unwrapped;
    }
  }
  return error;
}

function insertAtStart(editor: Editor<undefined>, newText: string): void {
  editor.applyEdits([
    {
      range: {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 0 },
      },
      newText,
    },
  ]);
}

type ReactEditableSurface = 'File' | 'FileDiff';
type ReactEditableSurfaceInstance =
  | FileInstance<undefined>
  | FileDiffInstance<undefined>;

function createEditableSurfaceElement(
  surface: ReactEditableSurface,
  edit = true,
  editorOptions?: EditorOptions<undefined>,
  onInstance?: (instance: ReactEditableSurfaceInstance) => void,
  editStateKey?: string
): ReactElement {
  const oldFile = { name: 'edit.ts', contents: 'const value = 1;\n' };
  if (surface === 'File') {
    const options: FileOptions<undefined> = {
      disableFileHeader: true,
      theme: DEFAULT_THEMES,
      onPostRender(_node, instance, phase) {
        if (phase !== 'unmount') {
          onInstance?.(instance);
        }
      },
    };
    return createElement(ReactFileComponent, {
      disableWorkerPool: true,
      edit,
      editStateKey,
      editorOptions,
      file: oldFile,
      options,
    });
  }
  const options: FileDiffOptions<undefined> = {
    disableFileHeader: true,
    theme: DEFAULT_THEMES,
    onPostRender(_node, instance, phase) {
      if (phase !== 'unmount') {
        onInstance?.(instance);
      }
    },
  };
  return createElement(ReactFileDiffComponent, {
    disableWorkerPool: true,
    edit,
    editStateKey,
    editorOptions,
    fileDiff: parseDiffFromFile(oldFile, {
      name: 'edit.ts',
      contents: 'const value = 2;\n',
    }),
    options,
  });
}

// Custom elements isolate rendered markup behind a shadow root; find it
// under the React container for markup assertions.
function shadowHTML(container: HTMLElement): string {
  for (const el of Array.from(container.querySelectorAll('*'))) {
    if (el.shadowRoot != null) {
      return el.shadowRoot.innerHTML;
    }
  }
  return '';
}

describe('React edit surfaces', () => {
  test('File renders editor token markup without mutating options', async () => {
    const { cleanup } = installDom();
    const cleanupActEnvironment = installReactActEnvironment();
    const container = document.createElement('div');
    document.body.appendChild(container);
    let instance: FileInstance<undefined> | undefined;
    let root: Root | undefined;
    let updates = 0;
    const options: FileOptions<undefined> = {
      disableFileHeader: true,
      theme: DEFAULT_THEMES,
      useTokenTransformer: false,
      onPostRender(_node, current, phase) {
        if (phase !== 'unmount') {
          instance = current;
        }
        if (phase === 'update') {
          updates++;
        }
      },
    };
    try {
      root = createReactRoot(container);
      await act(async () => {
        root!.render(
          createElement(
            EditProviderComponent,
            { createEditor },
            createElement(ReactFileComponent, {
              disableWorkerPool: true,
              edit: true,
              file: { name: 'edit.ts', contents: 'const value = 1;\n' },
              options,
            })
          )
        );
        await wait(10);
      });

      expect(instance).toBeDefined();
      // The attach-time session render supplies the token markup; public
      // options are never rewritten for the editor.
      await waitFor(() => shadowHTML(container).includes('data-char'), {
        timeout: 4000,
      });
      // waitFor times out silently; this is the real assertion.
      expect(shadowHTML(container)).toContain('data-char');
      expect(instance!.options.useTokenTransformer).toBe(false);
      // Mounting straight into edit renders once without a session and again
      // at editor attach — the accepted pre-paint cost of mount-into-edit.
      expect(updates).toBeGreaterThanOrEqual(1);
    } finally {
      await unmountRoot(root);
      cleanupActEnvironment();
      cleanup();
    }
  });

  test('FileDiff renders editor token markup without mutating options', async () => {
    const { cleanup } = installDom();
    const cleanupActEnvironment = installReactActEnvironment();
    const container = document.createElement('div');
    document.body.appendChild(container);
    let instance: FileDiffInstance<undefined> | undefined;
    let root: Root | undefined;
    const options: FileDiffOptions<undefined> = {
      disableFileHeader: true,
      theme: DEFAULT_THEMES,
      useTokenTransformer: false,
      onPostRender(_node, current, phase) {
        if (phase !== 'unmount') {
          instance = current;
        }
      },
    };
    const fileDiff = parseDiffFromFile(
      { name: 'edit.ts', contents: 'const value = 1;\n' },
      { name: 'edit.ts', contents: 'const value = 2;\n' }
    );
    try {
      root = createReactRoot(container);
      await act(async () => {
        root!.render(
          createElement(
            EditProviderComponent,
            { createEditor },
            createElement(ReactFileDiffComponent, {
              disableWorkerPool: true,
              edit: true,
              fileDiff,
              options,
            })
          )
        );
        await wait(10);
      });

      expect(instance).toBeDefined();
      // The attach-time session render supplies the token markup; public
      // options are never rewritten for the editor.
      await waitFor(() => shadowHTML(container).includes('data-char'), {
        timeout: 4000,
      });
      // waitFor times out silently; this is the real assertion.
      expect(shadowHTML(container)).toContain('data-char');
      expect(instance!.options.useTokenTransformer).toBe(false);
    } finally {
      await unmountRoot(root);
      cleanupActEnvironment();
      cleanup();
    }
  });

  test('an unchanged commit does not force-render an optionless edit surface', async () => {
    const { cleanup } = installDom();
    const cleanupActEnvironment = installReactActEnvironment();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const renderSpy = spyOn(FileInstance.prototype, 'render');
    let root: Root | undefined;
    const file = { name: 'edit.ts', contents: 'const value = 1;\n' };
    // A fresh element per commit: rendering an identical element reference
    // makes React bail out entirely, which would skip the layout effects
    // this test exists to observe.
    const makeElement = () =>
      createElement(
        EditProviderComponent,
        { createEditor },
        createElement(ReactFileComponent, {
          disableWorkerPool: true,
          edit: true,
          file,
        })
      );
    try {
      root = createReactRoot(container);
      await act(async () => {
        root!.render(makeElement());
        await wait(10);
      });
      await wait(50);
      const forcedRenders = () =>
        renderSpy.mock.calls.filter((call) => call[0]?.forceRender === true)
          .length;
      const forcedBefore = forcedRenders();

      // With no options prop the merged options are undefined every commit;
      // that must compare clean instead of force-rendering the edited file.
      await act(async () => {
        root!.render(makeElement());
        await wait(10);
      });
      expect(forcedRenders()).toBe(forcedBefore);
    } finally {
      renderSpy.mockRestore();
      await unmountRoot(root);
      cleanupActEnvironment();
      cleanup();
    }
  });
});

describe('React editor factory lifecycle', () => {
  for (const surface of ['File', 'FileDiff'] as const) {
    test(`${surface} creates editors only for edit sessions and preserves the surface`, async () => {
      const { cleanup } = installDom();
      const cleanupActEnvironment = installReactActEnvironment();
      const container = document.createElement('div');
      document.body.appendChild(container);
      const editors: TrackedEditor[] = [];
      let instance: ReactEditableSurfaceInstance | undefined;
      let root: Root | undefined;
      const firstOnChange = mock(
        (_event: EditorChangeEvent<undefined, 'file' | 'diff'>) => {}
      );
      const secondOnChange = mock(
        (_event: EditorChangeEvent<undefined, 'file' | 'diff'>) => {}
      );
      const firstFactory = mock((documentKind, options) => {
        const editor = new TrackedEditor(documentKind, options);
        editors.push(editor);
        return editor;
      });
      const secondFactory = mock((documentKind, options) => {
        const editor = new TrackedEditor(documentKind, options);
        editors.push(editor);
        return editor;
      });
      const render = async (
        edit: boolean,
        factory: CreateEditor<undefined>,
        onChange: NonNullable<EditorOptions<undefined>['onChange']>
      ) => {
        await act(async () => {
          root!.render(
            createElement(
              EditProviderComponent,
              { createEditor: factory },
              createEditableSurfaceElement(
                surface,
                edit,
                { onChange },
                (current) => {
                  instance = current;
                }
              )
            )
          );
          await wait(10);
        });
      };

      try {
        root = createReactRoot(container);
        await render(false, firstFactory, firstOnChange);
        const host = container.firstElementChild;
        const initialInstance = instance;
        expect(host).not.toBeNull();
        expect(initialInstance).toBeDefined();
        expect(editors).toHaveLength(0);
        expect(firstFactory).not.toHaveBeenCalled();

        await render(true, firstFactory, firstOnChange);
        expect(editors).toHaveLength(1);
        expect(firstFactory).toHaveBeenCalledTimes(1);
        expect(firstFactory.mock.calls[0]?.[0]).toBe(
          surface === 'File' ? 'file' : 'file-diff'
        );
        expect(firstFactory.mock.calls[0]?.[1].onChange).toBe(firstOnChange);
        expect(editors[0]?.cleanUpCount).toBe(0);
        expect(container.firstElementChild).toBe(host);
        expect(instance).toBe(initialInstance);

        await render(true, secondFactory, secondOnChange);
        expect(editors).toHaveLength(1);
        expect(firstFactory).toHaveBeenCalledTimes(1);
        expect(secondFactory).not.toHaveBeenCalled();
        insertAtStart(editors[0], '/* first session */');
        expect(firstOnChange).toHaveBeenCalledTimes(1);
        expect(secondOnChange).not.toHaveBeenCalled();

        await render(false, secondFactory, secondOnChange);
        expect(editors[0]?.cleanUpCount).toBe(1);
        expect(container.firstElementChild).toBe(host);
        expect(instance).toBe(initialInstance);

        await render(true, secondFactory, secondOnChange);
        expect(editors).toHaveLength(2);
        expect(editors[1]).not.toBe(editors[0]);
        expect(firstFactory).toHaveBeenCalledTimes(1);
        expect(secondFactory).toHaveBeenCalledTimes(1);
        expect(secondFactory.mock.calls[0]?.[0]).toBe(
          surface === 'File' ? 'file' : 'file-diff'
        );
        expect(secondFactory.mock.calls[0]?.[1].onChange).toBe(secondOnChange);
        expect(editors[1]?.cleanUpCount).toBe(0);
        expect(container.firstElementChild).toBe(host);
        expect(instance).toBe(initialInstance);
        insertAtStart(editors[1], '/* second session */');
        expect(firstOnChange).toHaveBeenCalledTimes(1);
        expect(secondOnChange).toHaveBeenCalledTimes(1);

        await unmountRoot(root);
        root = undefined;
        expect(editors[1]?.cleanUpCount).toBeGreaterThan(0);
      } finally {
        await unmountRoot(root);
        cleanupActEnvironment();
        cleanup();
      }
    });
  }

  for (const surface of ['File', 'FileDiff'] as const) {
    test(`${surface} forwards editStateKey when creating its editor`, async () => {
      const { cleanup } = installDom();
      const cleanupActEnvironment = installReactActEnvironment();
      const container = document.createElement('div');
      document.body.appendChild(container);
      const editStateKey = `${surface}-history`;
      const editors: TrackedEditor[] = [];
      const factory = mock(
        (
          documentKind: EditorDocumentKind,
          options: EditorOptions<undefined>,
          historyKey?: string
        ) => {
          const editor = new TrackedEditor(documentKind, options, historyKey);
          editors.push(editor);
          return editor;
        }
      );
      let root: Root | undefined;

      try {
        root = createReactRoot(container);
        await act(async () => {
          root!.render(
            createElement(
              EditProviderComponent,
              { createEditor: factory },
              createEditableSurfaceElement(
                surface,
                true,
                {},
                undefined,
                editStateKey
              )
            )
          );
          await wait(10);
        });
        await waitFor(() => editors[0]?.getFile() !== undefined);
        expect(factory).toHaveBeenCalledTimes(1);
        expect(factory.mock.calls[0]?.[2]).toBe(editStateKey);
        expect(editors[0]?.cleanUpCount).toBe(0);
      } finally {
        await unmountRoot(root);
        if (surface === 'File') {
          EditStateManager.clear('file', editStateKey);
        } else {
          EditStateManager.clear('file-diff', editStateKey);
        }
        cleanupActEnvironment();
        cleanup();
      }
    });
  }

  for (const surface of ['File', 'FileDiff'] as const) {
    test(`${surface} rejects concurrent surfaces using the same editStateKey`, async () => {
      const { cleanup } = installDom();
      const cleanupActEnvironment = installReactActEnvironment();
      const container = document.createElement('div');
      document.body.appendChild(container);
      const editStateKey = `${surface}-shared-history`;
      const editorOptions: EditorOptions<undefined> = {};
      const editors: TrackedEditor[] = [];
      const factory: CreateEditor<undefined> = (
        documentKind,
        options,
        historyKey
      ) => {
        const editor = new TrackedEditor(documentKind, options, historyKey);
        editors.push(editor);
        return editor;
      };
      let root: Root | undefined;

      try {
        root = createReactRoot(container);
        const renderError = await captureRenderError(
          root,
          createElement(
            EditProviderComponent,
            { createEditor: factory },
            createElement(
              'div',
              null,
              createEditableSurfaceElement(
                surface,
                true,
                editorOptions,
                undefined,
                editStateKey
              ),
              createEditableSurfaceElement(
                surface,
                true,
                editorOptions,
                undefined,
                editStateKey
              )
            )
          )
        );
        expect(renderError).toBeInstanceOf(Error);
        expect((renderError as Error).message).toBe(
          `Editor: editStateKey "${editStateKey}" is already attached to another editor`
        );
        expect(editors.length).toBeGreaterThan(1);
        expect(new Set(editors).size).toBe(editors.length);
      } finally {
        await unmountRoot(root);
        if (surface === 'File') {
          EditStateManager.clear('file', editStateKey);
        } else {
          EditStateManager.clear('file-diff', editStateKey);
        }
        cleanupActEnvironment();
        cleanup();
      }
    });
  }

  for (const surface of ['File', 'FileDiff'] as const) {
    test(`${surface} onEditChange prop receives editor change events and swaps mid-session`, async () => {
      const { cleanup } = installDom();
      const cleanupActEnvironment = installReactActEnvironment();
      const container = document.createElement('div');
      document.body.appendChild(container);
      const editors: TrackedEditor[] = [];
      const factory: CreateEditor<undefined> = (documentKind, options) => {
        const editor = new TrackedEditor(documentKind, options);
        editors.push(editor);
        return editor;
      };
      const editorOnChange = mock(
        (_event: EditorChangeEvent<undefined, 'file' | 'diff'>) => {}
      );
      const firstOnEditChange = mock(
        (_event: EditorChangeEvent<undefined, 'file' | 'diff'>) => {}
      );
      const secondOnEditChange = mock(
        (_event: EditorChangeEvent<undefined, 'file' | 'diff'>) => {}
      );
      // Stable inputs across renders (real callers memoize their diff), so a
      // re-render only swaps the onEditChange prop instead of also delivering
      // a compatible external update over the edited session.
      const oldFile = { name: 'edit.ts', contents: 'const value = 1;\n' };
      const pristineDiff = parseDiffFromFile(oldFile, {
        name: 'edit.ts',
        contents: 'const value = 2;\n',
      });
      const surfaceOptions = {
        disableFileHeader: true,
        theme: DEFAULT_THEMES,
      };
      const makeSurface = (
        onEditChange: (
          event: EditorChangeEvent<undefined, 'file' | 'diff'>
        ) => void
      ): ReactElement =>
        surface === 'File'
          ? createElement(ReactFileComponent, {
              disableWorkerPool: true,
              edit: true,
              editorOptions: { onChange: editorOnChange },
              file: oldFile,
              onEditChange,
              options: surfaceOptions,
            })
          : createElement(ReactFileDiffComponent, {
              disableWorkerPool: true,
              edit: true,
              editorOptions: { onChange: editorOnChange },
              fileDiff: pristineDiff,
              onEditChange,
              options: surfaceOptions,
            });
      let root: Root | undefined;
      const render = async (
        onEditChange: (
          event: EditorChangeEvent<undefined, 'file' | 'diff'>
        ) => void
      ) => {
        await act(async () => {
          root!.render(
            createElement(
              EditProviderComponent,
              { createEditor: factory },
              makeSurface(onEditChange)
            )
          );
          await wait(10);
        });
      };

      try {
        root = createReactRoot(container);
        await render(firstOnEditChange);
        await waitFor(() => editors[0]?.getFile() !== undefined);
        insertAtStart(editors[0], '/* one */');
        expect(editorOnChange).toHaveBeenCalledTimes(1);
        expect(firstOnEditChange).toHaveBeenCalledTimes(1);
        expect(firstOnEditChange.mock.calls[0]?.[0]).toBe(
          editorOnChange.mock.calls[0]?.[0]
        );
        expect(firstOnEditChange.mock.calls[0]?.[0].editor).toBe(editors[0]);
        expect(editorOnChange.mock.calls[0]?.[0].editor).toBe(editors[0]);

        await render(secondOnEditChange);
        expect(editors).toHaveLength(1);
        insertAtStart(editors[0], '/* two */');
        expect(firstOnEditChange).toHaveBeenCalledTimes(1);
        expect(secondOnEditChange).toHaveBeenCalledTimes(1);
        expect(secondOnEditChange.mock.calls[0]?.[0].editor).toBe(editors[0]);
      } finally {
        await unmountRoot(root);
        cleanupActEnvironment();
        cleanup();
      }
    });
  }

  test('File annotation slots stay projected through a remap without prop feedback', async () => {
    const { cleanup } = installDom();
    const cleanupActEnvironment = installReactActEnvironment();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const editors: TrackedEditor[] = [];
    const factory: CreateEditor<undefined> = (documentKind, options) => {
      const editor = new TrackedEditor(documentKind, options);
      editors.push(editor);
      return editor;
    };
    const lineAnnotations = [{ lineNumber: 2 }];
    let root: Root | undefined;

    try {
      root = createReactRoot(container);
      await act(async () => {
        root!.render(
          createElement(
            EditProviderComponent,
            { createEditor: factory },
            createElement(ReactFileComponent, {
              disableWorkerPool: true,
              edit: true,
              file: { name: 'edit.ts', contents: 'alpha\nbravo\ncharlie\n' },
              lineAnnotations,
              options: { disableFileHeader: true, theme: DEFAULT_THEMES },
              renderAnnotation: () => createElement('div', null, 'note'),
            })
          )
        );
        await wait(10);
      });
      await waitFor(() => editors[0]?.getFile() !== undefined);

      const findShadowRoot = (): ShadowRoot | undefined => {
        for (const el of Array.from(container.querySelectorAll('*'))) {
          if (el.shadowRoot != null) {
            return el.shadowRoot;
          }
        }
        return undefined;
      };
      const rowInfo = (): {
        slotName: string | undefined;
        dataLine: string | undefined;
      } => {
        const row = findShadowRoot()?.querySelector('[data-line-annotation]');
        const line = row?.previousElementSibling;
        return {
          slotName:
            row?.querySelector('slot')?.getAttribute('name') ?? undefined,
          dataLine: line instanceof HTMLElement ? line.dataset.line : undefined,
        };
      };
      await waitFor(() => rowInfo().slotName === 'annotation-2');
      expect(rowInfo().dataLine).toBe('2');
      expect(container.querySelector('[slot="annotation-2"]')).not.toBeNull();

      editors[0].applyEdits([
        {
          range: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 0 },
          },
          newText: 'pad\n',
        },
      ]);

      // The shadow row moved with the remap while its frozen slot name — and
      // therefore the untouched React light-DOM child — kept projecting.
      expect(rowInfo()).toEqual({ slotName: 'annotation-2', dataLine: '3' });
      expect(container.querySelector('[slot="annotation-2"]')).not.toBeNull();
    } finally {
      await unmountRoot(root);
      cleanupActEnvironment();
      cleanup();
    }
  });

  for (const wrapper of ['MultiFileDiff', 'PatchDiff'] as const) {
    test(`${wrapper} forwards editor options to its FileDiff instance`, async () => {
      const { cleanup } = installDom();
      const cleanupActEnvironment = installReactActEnvironment();
      const container = document.createElement('div');
      document.body.appendChild(container);
      const editors: TrackedEditor[] = [];
      const onChange = mock(
        (_event: EditorChangeEvent<undefined, 'file' | 'diff'>) => {}
      );
      let root: Root | undefined;
      const editStateKey = `${wrapper}-history`;
      const factory = mock((documentKind, options, historyKey?: string) => {
        const editor = new TrackedEditor(documentKind, options, historyKey);
        editors.push(editor);
        return editor;
      });
      const oldFile = { name: 'edit.ts', contents: 'const value = 1;\n' };
      const newFile = { name: 'edit.ts', contents: 'const value = 2;\n' };
      const sharedProps = {
        disableWorkerPool: true,
        edit: true,
        editStateKey,
        editorOptions: { onChange },
        options: {
          disableFileHeader: true,
          theme: DEFAULT_THEMES,
          ...(wrapper === 'PatchDiff'
            ? {
                loadDiffFiles: () => Promise.resolve({ newFile, oldFile }),
              }
            : null),
        },
      };
      const surface =
        wrapper === 'MultiFileDiff'
          ? createElement(MultiFileDiffComponent, {
              ...sharedProps,
              newFile,
              oldFile,
            })
          : createElement(PatchDiffComponent, {
              ...sharedProps,
              patch:
                '--- a/edit.ts\n+++ b/edit.ts\n@@ -1 +1 @@\n-const value = 1;\n+const value = 2;\n',
            });

      try {
        root = createReactRoot(container);
        await act(async () => {
          root!.render(
            createElement(
              EditProviderComponent,
              { createEditor: factory },
              surface
            )
          );
          await wait(20);
        });
        await waitFor(() => editors[0]?.getFile() !== undefined);

        expect(editors).toHaveLength(1);
        expect(factory).toHaveBeenCalledTimes(1);
        expect(factory.mock.calls[0]?.[0]).toBe('file-diff');
        expect(factory.mock.calls[0]?.[1].onChange).toBe(onChange);
        expect(factory.mock.calls[0]?.[2]).toBe(editStateKey);
        insertAtStart(editors[0], '/* wrapper */');
        expect(onChange).toHaveBeenCalledTimes(1);
        expect(onChange.mock.calls[0]?.[0].file.contents).toBe(
          '/* wrapper */const value = 2;\n'
        );

        await unmountRoot(root);
        root = undefined;
        expect(editors[0]?.cleanUpCount).toBeGreaterThan(0);
      } finally {
        await unmountRoot(root);
        EditStateManager.clear('file-diff', editStateKey);
        cleanupActEnvironment();
        cleanup();
      }
    });
  }

  test('keeps simultaneous sibling callbacks isolated', async () => {
    const { cleanup } = installDom();
    const cleanupActEnvironment = installReactActEnvironment();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const callbacks = Array.from({ length: 2 }, () =>
      mock((_event: EditorChangeEvent<undefined, 'file' | 'diff'>) => {})
    );
    const siblingEditors: (TrackedEditor | undefined)[] = [
      undefined,
      undefined,
    ];
    const editorOptions: EditorOptions<undefined>[] = callbacks.map(
      (onChange, index) => ({
        onAttach(editor) {
          siblingEditors[index] = editor as TrackedEditor;
        },
        onChange,
      })
    );
    const editors: TrackedEditor[] = [];
    let root: Root | undefined;
    const factory: CreateEditor<undefined> = (documentKind, options) => {
      const editor = new TrackedEditor(documentKind, options);
      editors.push(editor);
      return editor;
    };
    const oldFile = { name: 'edit.ts', contents: 'const value = 1;\n' };
    const newFile = { name: 'edit.ts', contents: 'const value = 2;\n' };

    try {
      root = createReactRoot(container);
      await act(async () => {
        root!.render(
          createElement(
            EditProviderComponent,
            { createEditor: factory },
            createElement(
              'div',
              null,
              createElement(ReactFileComponent, {
                disableWorkerPool: true,
                edit: true,
                editorOptions: editorOptions[0],
                file: newFile,
                options: {
                  disableFileHeader: true,
                  theme: DEFAULT_THEMES,
                },
              }),
              createElement(ReactFileDiffComponent, {
                disableWorkerPool: true,
                edit: true,
                editorOptions: editorOptions[1],
                fileDiff: parseDiffFromFile(oldFile, newFile),
                options: {
                  disableFileHeader: true,
                  theme: DEFAULT_THEMES,
                },
              })
            )
          )
        );
        await wait(20);
      });

      await waitFor(() =>
        siblingEditors.every((editor) => editor?.getFile() !== undefined)
      );
      expect(editors).toHaveLength(2);
      expect(siblingEditors.every(Boolean)).toBe(true);
      expect(
        siblingEditors.every((editor) => editor?.getFile() !== undefined)
      ).toBe(true);
      expect(new Set(siblingEditors).size).toBe(2);
      expect(siblingEditors.every((editor) => editors.includes(editor!))).toBe(
        true
      );

      const callbackCounts = () =>
        callbacks.map((callback) => callback.mock.calls.length);
      const callbackContents = () =>
        callbacks.map((callback) =>
          callback.mock.calls.map(([event]) => event.file.contents)
        );

      expect(callbackCounts()).toEqual([0, 0]);
      expect(callbackContents()).toEqual([[], []]);

      insertAtStart(siblingEditors[0]!, '/* sibling 0 */');
      expect(callbackCounts()).toEqual([1, 0]);
      expect(callbackContents()).toEqual([
        ['/* sibling 0 */const value = 2;\n'],
        [],
      ]);

      insertAtStart(siblingEditors[1]!, '/* sibling 1 */');
      expect(callbackCounts()).toEqual([1, 1]);
      expect(callbackContents()).toEqual([
        ['/* sibling 0 */const value = 2;\n'],
        ['/* sibling 1 */const value = 2;\n'],
      ]);

      await unmountRoot(root);
      root = undefined;
      expect(
        siblingEditors.every(
          (editor) => editor !== undefined && editor.cleanUpCount > 0
        )
      ).toBe(true);
    } finally {
      await unmountRoot(root);
      cleanupActEnvironment();
      cleanup();
    }
  });

  for (const surface of ['File', 'FileDiff'] as const) {
    test(`${surface} reports a missing provider`, async () => {
      const { cleanup } = installDom();
      const cleanupActEnvironment = installReactActEnvironment();
      const container = document.createElement('div');
      document.body.appendChild(container);
      let root: Root | undefined;

      try {
        root = createReactRoot(container);
        const missingProviderError = await captureRenderError(
          root,
          createEditableSurfaceElement(surface)
        );
        expect(missingProviderError).toBeInstanceOf(Error);
        expect((missingProviderError as Error).message).toBe(
          surface === 'File'
            ? 'File: EditContext is not attached'
            : 'FileDiff: EditContext is not attached'
        );
      } finally {
        await unmountRoot(root);
        cleanupActEnvironment();
        cleanup();
      }
    });

    test(`${surface} cleans an editor whose attachment fails`, async () => {
      const { cleanup } = installDom();
      const cleanupActEnvironment = installReactActEnvironment();
      const container = document.createElement('div');
      document.body.appendChild(container);
      const attachmentError = new Error(`${surface} attachment failed`);
      const editors: AttachmentFailingEditor[] = [];
      const onAttach = mock((_editor: Editor<undefined>) => {});
      let root: Root | undefined;
      const factory: CreateEditor<undefined> = (documentKind, options) => {
        const editor = new AttachmentFailingEditor(
          documentKind,
          options,
          attachmentError
        );
        editors.push(editor);
        return editor;
      };

      try {
        root = createReactRoot(container);
        const renderError = await captureRenderError(
          root,
          createElement(
            EditProviderComponent,
            { createEditor: factory },
            createEditableSurfaceElement(surface, true, { onAttach })
          )
        );
        expect(renderError).toBe(attachmentError);
        expect(editors.length).toBeGreaterThan(0);
        expect(editors.every((editor) => editor.cleanUpCount > 0)).toBe(true);
        const cleanUpCounts = editors.map((editor) => editor.cleanUpCount);
        await wait(0);
        expect(onAttach).not.toHaveBeenCalled();

        await unmountRoot(root);
        root = undefined;
        expect(editors.map((editor) => editor.cleanUpCount)).toEqual(
          cleanUpCounts
        );
      } finally {
        await unmountRoot(root);
        cleanupActEnvironment();
        cleanup();
      }
    });
  }

  for (const surface of ['File', 'FileDiff'] as const) {
    for (const termination of ['edit-off', 'unmount'] as const) {
      test(`${surface} cancels onAttach on ${termination} before the frame`, async () => {
        const { cleanup } = installDom();
        const cleanupActEnvironment = installReactActEnvironment();
        const frames = holdAnimationFrames();
        const container = document.createElement('div');
        document.body.appendChild(container);
        const editors: TrackedEditor[] = [];
        const onAttach = mock((_editor: Editor<undefined>) => {});
        const factory: CreateEditor<undefined> = (documentKind, options) => {
          const editor = new TrackedEditor(documentKind, options);
          editors.push(editor);
          return editor;
        };
        const renderSurface = (edit: boolean) =>
          createElement(
            EditProviderComponent,
            { createEditor: factory },
            createEditableSurfaceElement(surface, edit, { onAttach })
          );
        let root: Root | undefined;

        try {
          root = createReactRoot(container);
          await act(async () => {
            root!.render(renderSurface(true));
            await wait(0);
          });
          await waitFor(() => editors[0]?.getFile() !== undefined);

          expect(editors).toHaveLength(1);
          expect(editors[0]?.getFile()).toBeDefined();
          expect(onAttach).not.toHaveBeenCalled();
          expect(frames.pendingCount()).toBeGreaterThan(0);

          if (termination === 'edit-off') {
            await act(async () => {
              root!.render(renderSurface(false));
              await wait(0);
            });
          } else {
            await unmountRoot(root);
            root = undefined;
          }

          expect(() => frames.flush()).not.toThrow();
          expect(onAttach).not.toHaveBeenCalled();
          expect(editors[0]?.cleanUpCount).toBeGreaterThan(0);
        } finally {
          await unmountRoot(root);
          frames.restore();
          cleanupActEnvironment();
          cleanup();
        }
      });
    }
  }

  test('cleans StrictMode and virtualized edit passes without leaks', async () => {
    const { cleanup } = installDom();
    const cleanupActEnvironment = installReactActEnvironment();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const editors: TrackedEditor[] = [];
    const onAttach = mock((_editor: Editor<undefined>) => {});
    let root: Root | undefined;
    const factory: CreateEditor<undefined> = (documentKind, options) => {
      const editor = new TrackedEditor(documentKind, options);
      editors.push(editor);
      return editor;
    };
    const oldFile = { name: 'edit.ts', contents: 'const value = 1;\n' };
    const newFile = { name: 'edit.ts', contents: 'const value = 2;\n' };

    try {
      root = createReactRoot(container);
      await act(async () => {
        root!.render(
          createElement(
            StrictMode,
            null,
            createElement(
              EditProviderComponent,
              { createEditor: factory },
              createElement(
                Virtualizer,
                null,
                createElement(
                  'div',
                  null,
                  createElement(ReactFileComponent, {
                    disableWorkerPool: true,
                    edit: true,
                    editorOptions: { onAttach },
                    file: oldFile,
                    options: {
                      disableFileHeader: true,
                      theme: DEFAULT_THEMES,
                    },
                  }),
                  createElement(ReactFileDiffComponent, {
                    disableWorkerPool: true,
                    edit: true,
                    editorOptions: { onAttach },
                    fileDiff: parseDiffFromFile(oldFile, newFile),
                    options: {
                      disableFileHeader: true,
                      theme: DEFAULT_THEMES,
                    },
                  })
                )
              )
            )
          )
        );
        await wait(20);
      });

      await waitFor(() => onAttach.mock.calls.length >= 2);
      await wait(0);
      // StrictMode's simulated destroy/re-create pass gets fresh editors from
      // the owner factory. The first pair is cleaned before the committed pair
      // attaches, and the provider retains none of them.
      expect(editors).toHaveLength(4);
      expect(onAttach).toHaveBeenCalledTimes(2);
      const attachedEditors = onAttach.mock.calls.map(
        ([editor]) => editor as TrackedEditor
      );
      expect(new Set(attachedEditors).size).toBe(2);
      expect(attachedEditors.every((editor) => editors.includes(editor))).toBe(
        true
      );
      expect(
        editors
          .filter((editor) => !attachedEditors.includes(editor))
          .every((editor) => editor.cleanUpCount > 0)
      ).toBe(true);
      for (const editor of attachedEditors) {
        const character = editor.getText().indexOf('\n');
        expect(() =>
          editor.applyEdits([
            {
              range: {
                start: { line: 0, character },
                end: { line: 0, character },
              },
              newText: ' // strict replay',
            },
          ])
        ).not.toThrow();
      }

      await unmountRoot(root);
      root = undefined;
      expect(editors.every((editor) => editor.cleanUpCount > 0)).toBe(true);
      await wait(0);
      expect(onAttach).toHaveBeenCalledTimes(2);
    } finally {
      await unmountRoot(root);
      cleanupActEnvironment();
      cleanup();
    }
  });

  test('a factory returning an owner-constructed editor shares it as configured, ignoring surface editorOptions', async () => {
    const { cleanup } = installDom();
    const cleanupActEnvironment = installReactActEnvironment();
    const container = document.createElement('div');
    document.body.appendChild(container);
    // The owner-constructed editor is used exactly as constructed: its own
    // onAttach must fire, while the surface's editorOptions (including its
    // onAttach) only reach the factory, which discards them.
    let attachedEditor: Editor<undefined> | undefined;
    const sharedEditor = new Editor<undefined>('file', {
      onAttach(editor) {
        attachedEditor = editor;
      },
    });
    const factory = mock(
      (_documentKind: EditorDocumentKind, _options: EditorOptions<undefined>) =>
        sharedEditor
    );
    const surfaceOnAttach = mock((_editor: Editor<undefined>) => {});
    let root: Root | undefined;

    try {
      root = createReactRoot(container);
      await act(async () => {
        root!.render(
          createElement(
            EditProviderComponent,
            { createEditor: factory },
            createEditableSurfaceElement('File', true, {
              onAttach: surfaceOnAttach,
            })
          )
        );
        await wait(10);
      });
      await waitFor(() => attachedEditor !== undefined);

      expect(attachedEditor).toBe(sharedEditor);
      expect(factory).toHaveBeenCalled();
      expect(surfaceOnAttach).not.toHaveBeenCalled();
    } finally {
      await unmountRoot(root);
      cleanupActEnvironment();
      cleanup();
    }
  });
});

describe('React completion lifecycle', () => {
  const FILE_A: FileContents = {
    name: 'edit.ts',
    contents: 'const value = 1;\nconst other = 2;\n',
  };

  interface FileHarness {
    cleanup(): Promise<void>;
    container: HTMLElement;
    editors: TrackedEditor[];
    events: FileEditCompleteEvent<undefined>[];
    getInstance(): FileInstance<undefined> | undefined;
    render(props: FileHarnessProps): Promise<void>;
    renderError(props: { file: FileContents; edit: boolean }): Promise<unknown>;
  }

  interface FileHarnessProps {
    file: FileContents;
    edit: boolean;
    lineAnnotations?: LineAnnotation<undefined>[];
    onEditChange?(event: EditorChangeEvent<undefined, 'file'>): void;
  }

  function createFileHarness(
    onEditComplete: FileEditCompleteHandler<undefined>
  ): FileHarness {
    const { cleanup: cleanupDom } = installDom();
    const cleanupActEnvironment = installReactActEnvironment();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const editors: TrackedEditor[] = [];
    const events: FileEditCompleteEvent<undefined>[] = [];
    const factory: CreateEditor<undefined> = (documentKind, options) => {
      const editor = new TrackedEditor(documentKind, options);
      editors.push(editor);
      return editor;
    };
    let instance: FileInstance<undefined> | undefined;
    const root = createReactRoot(container);
    const element = (props: FileHarnessProps) =>
      createElement(
        EditProviderComponent,
        { createEditor: factory },
        createElement(ReactFileComponent, {
          disableWorkerPool: true,
          edit: props.edit,
          file: props.file,
          lineAnnotations: props.lineAnnotations,
          onEditChange: props.onEditChange,
          onEditComplete,
          options: {
            disableFileHeader: true,
            theme: DEFAULT_THEMES,
            onPostRender(_node, current, phase) {
              if (phase !== 'unmount') {
                instance = current;
              }
            },
          },
        })
      );
    return {
      container,
      editors,
      events,
      getInstance: () => instance,
      async render(props) {
        await act(async () => {
          root.render(element(props));
          await wait(10);
        });
      },
      renderError(props) {
        return captureRenderError(root, element(props));
      },
      async cleanup() {
        await unmountRoot(root);
        cleanupActEnvironment();
        cleanupDom();
      },
    };
  }

  test('accepting installs the completed file with no stale-prop repaint', async () => {
    const events: FileEditCompleteEvent<undefined>[] = [];
    const harness = createFileHarness((event) => {
      events.push(event);
      event.file.cacheKey = 'accepted:v2';
      return 'accept';
    });
    try {
      await harness.render({ file: FILE_A, edit: true });
      await waitFor(() => harness.editors[0]?.getText() === FILE_A.contents, {
        timeout: 4_000,
      });
      act(() => {
        insertAtStart(harness.editors[0], '/* edited */\n');
      });

      // The owner never updates its file prop: the accepted result must
      // still be what renders.
      await harness.render({ file: FILE_A, edit: false });
      expect(events).toHaveLength(1);
      const instance = harness.getInstance();
      expect(instance?.file).toBe(events[0].file);
      expect(shadowHTML(harness.container)).toContain('edited');

      // Repeated stale commits neither re-complete nor revert.
      await harness.render({ file: FILE_A, edit: false });
      expect(events).toHaveLength(1);
      expect(harness.getInstance()?.file).toBe(events[0].file);

      // A serialized copy carrying the accepted cache key matches the
      // accepted file: the exact accepted object stays installed.
      const serialized: FileContents = { ...events[0].file };
      await harness.render({ file: serialized, edit: false });
      expect(harness.getInstance()?.file).toBe(events[0].file);

      // A keyless equal-content rebuild is a new input: it replaces the
      // accepted object and repaints identical content.
      const rebuilt: FileContents = {
        name: events[0].file.name,
        contents: events[0].file.contents,
      };
      await harness.render({ file: rebuilt, edit: false });
      expect(harness.getInstance()?.file).toBe(rebuilt);
      expect(shadowHTML(harness.container)).toContain('edited');

      // A genuinely new file supersedes the accepted value.
      const superseding: FileContents = {
        name: 'edit.ts',
        contents: 'const value = 3;\n',
      };
      await harness.render({ file: superseding, edit: false });
      expect(harness.getInstance()?.file).toBe(superseding);
    } finally {
      await harness.cleanup();
    }
  });

  test('a re-serialized keyed file prop keeps the accepted file installed', async () => {
    const KEYED_FILE: FileContents = { ...FILE_A, cacheKey: 'file:v1' };
    const events: FileEditCompleteEvent<undefined>[] = [];
    const harness = createFileHarness((event) => {
      events.push(event);
      event.file.cacheKey = 'accepted:v2';
      return 'accept';
    });
    try {
      await harness.render({ file: KEYED_FILE, edit: true });
      await waitFor(
        () => harness.editors[0]?.getText() === KEYED_FILE.contents,
        { timeout: 4_000 }
      );
      act(() => {
        insertAtStart(harness.editors[0], '/* edited */\n');
      });

      // The stale prop arrives as a new object with the same cache key, as
      // a serialization boundary produces: the accepted file must still be
      // what renders.
      await harness.render({ file: { ...KEYED_FILE }, edit: false });
      expect(events).toHaveLength(1);
      expect(harness.getInstance()?.file).toBe(events[0].file);
      expect(shadowHTML(harness.container)).toContain('edited');
    } finally {
      await harness.cleanup();
    }
  });

  test('returning null reverts to the exact file prop', async () => {
    const events: FileEditCompleteEvent<undefined>[] = [];
    const harness = createFileHarness((event) => {
      events.push(event);
      return 'reject';
    });
    try {
      await harness.render({ file: FILE_A, edit: true });
      await waitFor(() => harness.editors[0]?.getText() === FILE_A.contents, {
        timeout: 4_000,
      });
      act(() => {
        insertAtStart(harness.editors[0], '/* edited */\n');
      });
      await harness.render({ file: FILE_A, edit: false });

      expect(events).toHaveLength(1);
      expect(harness.getInstance()?.file).toBe(FILE_A);
      expect(shadowHTML(harness.container)).not.toContain('edited');
    } finally {
      await harness.cleanup();
    }
  });

  test('unmount completes a changed session once without installing', async () => {
    const events: FileEditCompleteEvent<undefined>[] = [];
    const externalFile: FileContents = { ...FILE_A };
    const harness = createFileHarness((event) => {
      events.push(event);
      event.file.cacheKey = 'accepted:v2';
      return 'accept';
    });
    try {
      await harness.render({ file: externalFile, edit: true });
      await waitFor(
        () => harness.editors[0]?.getText() === externalFile.contents,
        { timeout: 4_000 }
      );
      act(() => {
        insertAtStart(harness.editors[0], '/* edited */\n');
      });
    } finally {
      await harness.cleanup();
    }
    expect(events).toHaveLength(1);
    expect(events[0].file.contents).toContain('/* edited */');
    expect(externalFile).toEqual(FILE_A);
  });

  test('accepted annotations keep their moved rows through stale commits', async () => {
    const annotations: LineAnnotation<undefined>[] = [{ lineNumber: 2 }];
    const events: FileEditCompleteEvent<undefined>[] = [];
    const harness = createFileHarness((event) => {
      events.push(event);
      event.file.cacheKey = 'accepted:v2';
      return 'accept';
    });
    try {
      await harness.render({
        file: FILE_A,
        edit: true,
        lineAnnotations: annotations,
      });
      await waitFor(() => harness.editors[0]?.getText() === FILE_A.contents, {
        timeout: 4_000,
      });
      act(() => {
        insertAtStart(harness.editors[0], 'one\ntwo\n');
      });
      await harness.render({
        file: FILE_A,
        edit: false,
        lineAnnotations: annotations,
      });

      expect(events).toHaveLength(1);
      expect(events[0].lineAnnotations).toEqual([{ lineNumber: 4 }]);
      let row: Element | null = null;
      for (const el of Array.from(harness.container.querySelectorAll('*'))) {
        row = el.shadowRoot?.querySelector('[data-line-annotation]') ?? row;
      }
      const line = row?.previousElementSibling;
      expect(line instanceof HTMLElement ? line.dataset.line : undefined).toBe(
        '4'
      );
    } finally {
      await harness.cleanup();
    }
  });
});

describe('React diff input bridges after acceptance', () => {
  const OLD_FILE: FileContents = {
    name: 'multi.ts',
    contents: 'old line;\ncommon;\n',
  };
  const NEW_FILE: FileContents = {
    name: 'multi.ts',
    contents: 'new line;\ncommon;\n',
  };

  function createDiffHarness() {
    const { cleanup: cleanupDom } = installDom();
    const cleanupActEnvironment = installReactActEnvironment();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const editors: TrackedEditor[] = [];
    const events: FileDiffEditCompleteEvent<undefined>[] = [];
    const completionEditors: DiffsEditor<undefined>[] = [];
    const factory: CreateEditor<undefined> = (documentKind, options) => {
      const editor = new TrackedEditor(documentKind, options);
      editors.push(editor);
      return editor;
    };
    let instance: FileDiffInstance<undefined> | undefined;
    const root = createReactRoot(container);
    const onEditComplete: FileDiffEditCompleteHandler<undefined> = (event) => {
      events.push(event);
      completionEditors.push(event.editor);
      event.fileDiff.cacheKey = 'accepted:v2';
      return 'accept';
    };
    const baseOptions = (extra?: Partial<FileDiffOptions<undefined>>) => ({
      disableFileHeader: true,
      theme: DEFAULT_THEMES,
      onPostRender(
        _node: HTMLElement,
        current: FileDiffInstance<undefined>,
        phase: 'mount' | 'update' | 'unmount'
      ) {
        if (phase !== 'unmount') {
          instance = current;
        }
      },
      ...extra,
    });
    return {
      container,
      editors,
      completionEditors,
      events,
      factory,
      root,
      onEditComplete,
      baseOptions,
      getInstance: () => instance,
      async cleanup() {
        await unmountRoot(root);
        cleanupActEnvironment();
        cleanupDom();
      },
    };
  }

  test('MultiFileDiff retains the accepted diff through stale and caught-up pairs', async () => {
    const harness = createDiffHarness();
    try {
      const render = async (
        oldFile: FileContents,
        newFile: FileContents,
        edit: boolean
      ) => {
        await act(async () => {
          harness.root.render(
            createElement(
              EditProviderComponent,
              { createEditor: harness.factory },
              createElement(MultiFileDiffComponent, {
                disableWorkerPool: true,
                edit,
                oldFile,
                newFile,
                onEditComplete: harness.onEditComplete,
                options: harness.baseOptions(),
              })
            )
          );
          await wait(10);
        });
      };
      await render(OLD_FILE, NEW_FILE, true);
      await waitFor(() => harness.editors[0]?.getText() === NEW_FILE.contents, {
        timeout: 4_000,
      });
      act(() => {
        insertAtStart(harness.editors[0], '/* edited */\n');
      });

      // Stale pair: the accepted diff stays installed.
      await render(OLD_FILE, NEW_FILE, false);
      expect(harness.events).toHaveLength(1);
      expect(harness.completionEditors).toEqual([harness.editors[0]]);
      const event = harness.events[0];
      expect(harness.getInstance()?.fileDiff).toBe(event.fileDiff);

      // The owner's state catches up with the event files: the pair matches
      // the completion files, so the accepted object is reused, not reparsed.
      if (event.oldFile == null || event.newFile == null) {
        throw new Error('Expected both completion files for a changed diff');
      }
      await render(event.oldFile, event.newFile, false);
      expect(harness.getInstance()?.fileDiff).toBe(event.fileDiff);

      // A genuinely new pair supersedes the accepted diff.
      await render(
        event.oldFile,
        { name: 'multi.ts', contents: 'different;\n' },
        false
      );
      expect(harness.getInstance()?.fileDiff).not.toBe(event.fileDiff);
      expect(harness.getInstance()?.fileDiff?.additionLines.join('')).toBe(
        'different;\n'
      );
    } finally {
      await harness.cleanup();
    }
  });

  test('a newer MultiFileDiff pair supersedes a pending bridge', async () => {
    const harness = createDiffHarness();
    try {
      const render = async (
        oldFile: FileContents,
        newFile: FileContents,
        edit: boolean
      ) => {
        await act(async () => {
          harness.root.render(
            createElement(
              EditProviderComponent,
              { createEditor: harness.factory },
              createElement(MultiFileDiffComponent, {
                disableWorkerPool: true,
                edit,
                oldFile,
                newFile,
                onEditComplete: harness.onEditComplete,
                options: harness.baseOptions(),
              })
            )
          );
          await wait(10);
        });
      };
      await render(OLD_FILE, NEW_FILE, true);
      await waitFor(() => harness.editors[0]?.getText() === NEW_FILE.contents, {
        timeout: 4_000,
      });
      act(() => {
        insertAtStart(harness.editors[0], '/* edited */\n');
      });
      await render(OLD_FILE, NEW_FILE, false);
      expect(harness.events).toHaveLength(1);

      // The owner never acknowledges; a new pair arrives directly.
      await render(
        OLD_FILE,
        { name: 'multi.ts', contents: 'moved on;\n' },
        false
      );
      expect(harness.getInstance()?.fileDiff?.additionLines.join('')).toBe(
        'moved on;\n'
      );
    } finally {
      await harness.cleanup();
    }
  });

  test('a re-serialized keyed pair keeps the accepted diff installed', async () => {
    const harness = createDiffHarness();
    const OLD_KEYED: FileContents = { ...OLD_FILE, cacheKey: 'old:v1' };
    const NEW_KEYED: FileContents = { ...NEW_FILE, cacheKey: 'new:v1' };
    try {
      const render = async (
        oldFile: FileContents,
        newFile: FileContents,
        edit: boolean
      ) => {
        await act(async () => {
          harness.root.render(
            createElement(
              EditProviderComponent,
              { createEditor: harness.factory },
              createElement(MultiFileDiffComponent, {
                disableWorkerPool: true,
                edit,
                oldFile,
                newFile,
                onEditComplete: harness.onEditComplete,
                options: harness.baseOptions(),
              })
            )
          );
          await wait(10);
        });
      };
      await render(OLD_KEYED, NEW_KEYED, true);
      await waitFor(
        () => harness.editors[0]?.getText() === NEW_KEYED.contents,
        { timeout: 4_000 }
      );
      act(() => {
        insertAtStart(harness.editors[0], '/* edited */\n');
      });

      // The stale pair arrives as new file objects with the same cache
      // keys, as a serialization boundary produces: the reparse matches the
      // replaced diff by its derived key and the accepted diff stays.
      await render({ ...OLD_KEYED }, { ...NEW_KEYED }, false);
      expect(harness.events).toHaveLength(1);
      expect(harness.getInstance()?.fileDiff).toBe(harness.events[0].fileDiff);
      expect(shadowHTML(harness.container)).toContain('edited');
    } finally {
      await harness.cleanup();
    }
  });

  test('PatchDiff keeps the accepted diff until the patch prop advances', async () => {
    const harness = createDiffHarness();
    const loadDiffFiles = () =>
      Promise.resolve({ oldFile: OLD_FILE, newFile: NEW_FILE });
    const patch1 = createTwoFilesPatch(
      OLD_FILE.name,
      NEW_FILE.name,
      OLD_FILE.contents,
      NEW_FILE.contents
    );
    try {
      const render = async (patch: string, edit: boolean) => {
        await act(async () => {
          harness.root.render(
            createElement(
              EditProviderComponent,
              { createEditor: harness.factory },
              createElement(PatchDiffComponent, {
                disableWorkerPool: true,
                edit,
                patch,
                onEditComplete: harness.onEditComplete,
                options: harness.baseOptions({ loadDiffFiles }),
              })
            )
          );
          await wait(10);
        });
      };
      await render(patch1, true);
      await waitFor(() => harness.editors[0]?.getText() === NEW_FILE.contents, {
        timeout: 4_000,
      });
      act(() => {
        insertAtStart(harness.editors[0], '/* edited */\n');
      });

      // Stale patch: the accepted diff stays installed, no old-patch flash.
      await render(patch1, false);
      expect(harness.events).toHaveLength(1);
      const event = harness.events[0];
      expect(harness.getInstance()?.fileDiff).toBe(event.fileDiff);
      expect(shadowHTML(harness.container)).toContain('edited');

      // A patch string has no identity linking it to the accepted diff:
      // when the patch prop advances, its parse replaces the accepted
      // object with identical content.
      const patch2 = createTwoFilesPatch(
        OLD_FILE.name,
        NEW_FILE.name,
        OLD_FILE.contents,
        `/* edited */\n${NEW_FILE.contents}`
      );
      await render(patch2, false);
      expect(harness.getInstance()?.fileDiff).not.toBe(event.fileDiff);
      expect(shadowHTML(harness.container)).toContain('edited');

      // A patch describing something else supersedes.
      const patch3 = createTwoFilesPatch(
        OLD_FILE.name,
        NEW_FILE.name,
        OLD_FILE.contents,
        'rewritten;\n'
      );
      await render(patch3, false);
      expect(harness.getInstance()?.fileDiff).not.toBe(event.fileDiff);
      expect(harness.getInstance()?.fileDiff?.additionLines.join('')).toContain(
        'rewritten;'
      );
    } finally {
      await harness.cleanup();
    }
  });
});
