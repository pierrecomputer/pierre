import { afterAll, describe, expect, mock, test } from 'bun:test';
import {
  act,
  type ComponentType,
  createElement,
  type PropsWithChildren,
  type ReactElement,
  StrictMode,
} from 'react';
import { createRoot as createReactRoot, type Root } from 'react-dom/client';

import { File as FileInstance, type FileOptions } from '../src/components/File';
import {
  FileDiff as FileDiffInstance,
  type FileDiffOptions,
} from '../src/components/FileDiff';
import { DEFAULT_THEMES } from '../src/constants';
import { Editor, type EditorOptions } from '../src/editor/editor';
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
  EditableInstance,
  FileContents,
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

function createEditor(options: EditorOptions<undefined>): Editor<undefined> {
  return new Editor(options);
}

class TrackedEditor extends Editor<undefined> {
  cleanUpCount = 0;

  override cleanUp(recycle = false): void {
    this.cleanUpCount += 1;
    super.cleanUp(recycle);
  }
}

class AttachmentFailingEditor extends TrackedEditor {
  constructor(
    options: EditorOptions<undefined>,
    private readonly attachmentError: Error
  ) {
    super(options);
  }

  override edit<T extends DiffsEditableComponent<undefined>>(
    fileInstance: EditableInstance<T>
  ): () => void {
    super.edit(fileInstance);
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
    return error;
  }
  return undefined;
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
  editOptions?: EditorOptions<undefined>,
  onInstance?: (instance: ReactEditableSurfaceInstance) => void
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
      editOptions,
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
    editOptions,
    fileDiff: parseDiffFromFile(oldFile, {
      name: 'edit.ts',
      contents: 'const value = 2;\n',
    }),
    options,
  });
}

describe('React edit option normalization', () => {
  test('File enables the token transformer while editing', async () => {
    const { cleanup } = installDom();
    const cleanupActEnvironment = installReactActEnvironment();
    const container = document.createElement('div');
    document.body.appendChild(container);
    let instance: FileInstance<undefined> | undefined;
    let root: Root | undefined;
    const options: FileOptions<undefined> = {
      disableFileHeader: true,
      theme: DEFAULT_THEMES,
      useTokenTransformer: false,
      onPostRender(_node, current, phase) {
        if (phase !== 'unmount') {
          instance = current;
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
      expect(instance!.options.useTokenTransformer).toBe(true);
    } finally {
      await unmountRoot(root);
      cleanupActEnvironment();
      cleanup();
    }
  });

  test('FileDiff enables the token transformer while editing', async () => {
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
      expect(instance!.options.useTokenTransformer).toBe(true);
    } finally {
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
      const firstOnChange = mock((_file: FileContents) => {});
      const secondOnChange = mock((_file: FileContents) => {});
      const firstFactory = mock((options: EditorOptions<undefined>) => {
        const editor = new TrackedEditor(options);
        editors.push(editor);
        return editor;
      });
      const secondFactory = mock((options: EditorOptions<undefined>) => {
        const editor = new TrackedEditor(options);
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
        expect(firstFactory.mock.calls[0]?.[0].onChange).toBe(firstOnChange);
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
        expect(secondFactory.mock.calls[0]?.[0].onChange).toBe(secondOnChange);
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

  for (const wrapper of ['MultiFileDiff', 'PatchDiff'] as const) {
    test(`${wrapper} forwards edit options to its FileDiff instance`, async () => {
      const { cleanup } = installDom();
      const cleanupActEnvironment = installReactActEnvironment();
      const container = document.createElement('div');
      document.body.appendChild(container);
      const editors: TrackedEditor[] = [];
      const onChange = mock((_file: FileContents) => {});
      let root: Root | undefined;
      const factory = mock((options: EditorOptions<undefined>) => {
        const editor = new TrackedEditor(options);
        editors.push(editor);
        return editor;
      });
      const oldFile = { name: 'edit.ts', contents: 'const value = 1;\n' };
      const newFile = { name: 'edit.ts', contents: 'const value = 2;\n' };
      const sharedProps = {
        disableWorkerPool: true,
        edit: true,
        editOptions: { onChange },
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
        expect(factory.mock.calls[0]?.[0].onChange).toBe(onChange);
        insertAtStart(editors[0], '/* wrapper */');
        expect(onChange).toHaveBeenCalledTimes(1);
        expect(onChange.mock.calls[0]?.[0].contents).toBe(
          '/* wrapper */const value = 2;\n'
        );

        await unmountRoot(root);
        root = undefined;
        expect(editors[0]?.cleanUpCount).toBeGreaterThan(0);
      } finally {
        await unmountRoot(root);
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
      mock((_file: FileContents) => {})
    );
    const siblingEditors: (TrackedEditor | undefined)[] = [
      undefined,
      undefined,
    ];
    const editOptions: EditorOptions<undefined>[] = callbacks.map(
      (onChange, index) => ({
        onAttach(editor) {
          siblingEditors[index] = editor as TrackedEditor;
        },
        onChange,
      })
    );
    const editors: TrackedEditor[] = [];
    let root: Root | undefined;
    const factory = (options: EditorOptions<undefined>) => {
      const editor = new TrackedEditor(options);
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
                editOptions: editOptions[0],
                file: newFile,
                options: {
                  disableFileHeader: true,
                  theme: DEFAULT_THEMES,
                },
              }),
              createElement(ReactFileDiffComponent, {
                disableWorkerPool: true,
                edit: true,
                editOptions: editOptions[1],
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
          callback.mock.calls.map(([file]) => file.contents)
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
    test(`${surface} reports missing providers and invalid factories`, async () => {
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

        await unmountRoot(root);
        root = undefined;
        root = createReactRoot(container);
        const invalidFactoryError = await captureRenderError(
          root,
          createElement(
            EditProviderComponent,
            { createEditor: () => undefined as never },
            createEditableSurfaceElement(surface)
          )
        );
        expect(invalidFactoryError).toBeInstanceOf(Error);
        expect((invalidFactoryError as Error).message).toBe(
          `${surface}: EditProvider.createEditor must return an editor instance`
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
      const factory = (options: EditorOptions<undefined>) => {
        const editor = new AttachmentFailingEditor(options, attachmentError);
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
        expect(editors).toHaveLength(1);
        expect(editors[0]?.cleanUpCount).toBe(1);
        await wait(0);
        expect(onAttach).not.toHaveBeenCalled();

        await unmountRoot(root);
        root = undefined;
        expect(editors[0]?.cleanUpCount).toBe(1);
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
        const factory = (options: EditorOptions<undefined>) => {
          const editor = new TrackedEditor(options);
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
    const factory = (options: EditorOptions<undefined>) => {
      const editor = new TrackedEditor(options);
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
                    editOptions: { onAttach },
                    file: oldFile,
                    options: {
                      disableFileHeader: true,
                      theme: DEFAULT_THEMES,
                    },
                  }),
                  createElement(ReactFileDiffComponent, {
                    disableWorkerPool: true,
                    edit: true,
                    editOptions: { onAttach },
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
      const activeEditors = editors.filter(
        (editor) => editor.cleanUpCount === 0
      );
      expect(editors.length).toBeGreaterThanOrEqual(4);
      expect(editors.filter((editor) => editor.cleanUpCount > 0)).toHaveLength(
        editors.length - 2
      );
      expect(activeEditors).toHaveLength(2);
      expect(onAttach).toHaveBeenCalledTimes(2);
      expect(new Set(onAttach.mock.calls.map(([editor]) => editor))).toEqual(
        new Set(activeEditors)
      );

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
});
