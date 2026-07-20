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

function createEditableSurfaceElement(
  surface: ReactEditableSurface
): ReactElement {
  const oldFile = { name: 'edit.ts', contents: 'const value = 1;\n' };
  const options = { disableFileHeader: true, theme: DEFAULT_THEMES };
  if (surface === 'File') {
    return createElement(ReactFileComponent, {
      disableWorkerPool: true,
      edit: true,
      file: oldFile,
      options,
    });
  }
  return createElement(ReactFileDiffComponent, {
    disableWorkerPool: true,
    edit: true,
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
  test('creates editors only for edit sessions and preserves the surface', async () => {
    const { cleanup } = installDom();
    const cleanupActEnvironment = installReactActEnvironment();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const editors: TrackedEditor[] = [];
    let instance: FileInstance<undefined> | undefined;
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
    const file = { name: 'edit.ts', contents: 'const value = 1;\n' };
    const options: FileOptions<undefined> = {
      disableFileHeader: true,
      theme: DEFAULT_THEMES,
      onPostRender(_node, current, phase) {
        if (phase !== 'unmount') {
          instance = current;
        }
      },
    };
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
            createElement(ReactFileComponent, {
              disableWorkerPool: true,
              edit,
              editOptions: { onChange },
              file,
              options,
            })
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

  test('gives every editable surface independent options and editors', async () => {
    const { cleanup } = installDom();
    const cleanupActEnvironment = installReactActEnvironment();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const editors: TrackedEditor[] = [];
    const receivedOptions: EditorOptions<undefined>[] = [];
    const editorByOptions = new Map<EditorOptions<undefined>, TrackedEditor>();
    let root: Root | undefined;
    const callbacks = Array.from({ length: 4 }, () =>
      mock((_file: FileContents) => {})
    );
    const factory = (options: EditorOptions<undefined>) => {
      receivedOptions.push(options);
      const editor = new TrackedEditor(options);
      editors.push(editor);
      editorByOptions.set(options, editor);
      return editor;
    };
    const oldFile = { name: 'edit.ts', contents: 'const value = 1;\n' };
    const newFile = { name: 'edit.ts', contents: 'const value = 2;\n' };
    const fileDiff = parseDiffFromFile(oldFile, newFile);
    const sharedProps = {
      disableWorkerPool: true,
      edit: true,
      options: { disableFileHeader: true, theme: DEFAULT_THEMES },
    };
    const editOptions = callbacks.map((onChange) => ({ onChange }));

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
                ...sharedProps,
                editOptions: editOptions[0],
                file: newFile,
              }),
              createElement(ReactFileDiffComponent, {
                ...sharedProps,
                editOptions: editOptions[1],
                fileDiff,
              }),
              createElement(MultiFileDiffComponent, {
                ...sharedProps,
                editOptions: editOptions[2],
                newFile,
                oldFile,
              }),
              createElement(PatchDiffComponent, {
                ...sharedProps,
                editOptions: editOptions[3],
                patch:
                  '--- a/edit.ts\n+++ b/edit.ts\n@@ -1 +1 @@\n-const value = 1;\n+const value = 2;\n',
              })
            )
          )
        );
        await wait(20);
      });

      expect(editors).toHaveLength(4);
      expect(new Set(editors).size).toBe(4);
      expect(receivedOptions.map((options) => options.onChange)).toEqual(
        callbacks
      );
      const surfaceEditors = editOptions.map((options) =>
        editorByOptions.get(options)
      );
      expect(surfaceEditors.every(Boolean)).toBe(true);

      await unmountRoot(root);
      root = undefined;
      expect(editors.every((editor) => editor.cleanUpCount > 0)).toBe(true);
    } finally {
      await unmountRoot(root);
      cleanupActEnvironment();
      cleanup();
    }
  });

  test('keeps simultaneous sibling callbacks isolated', async () => {
    const { cleanup } = installDom();
    const cleanupActEnvironment = installReactActEnvironment();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const callbacks = Array.from({ length: 2 }, () =>
      mock((_file: FileContents) => {})
    );
    const editOptions: EditorOptions<undefined>[] = callbacks.map(
      (onChange) => ({ onChange })
    );
    const editorByOptions = new Map<EditorOptions<undefined>, TrackedEditor>();
    let root: Root | undefined;
    const factory = (options: EditorOptions<undefined>) => {
      const editor = new TrackedEditor(options);
      editorByOptions.set(options, editor);
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

      const siblingEditors = editOptions.map((options) =>
        editorByOptions.get(options)
      );
      await waitFor(() =>
        siblingEditors.every((editor) => editor?.getFile() !== undefined)
      );
      expect(siblingEditors.every(Boolean)).toBe(true);
      expect(
        siblingEditors.every((editor) => editor?.getFile() !== undefined)
      ).toBe(true);
      expect(new Set(siblingEditors).size).toBe(2);

      for (const [index, editor] of siblingEditors.entries()) {
        const marker = `/* sibling ${index} */`;
        insertAtStart(editor!, marker);
        expect(callbacks[index]).toHaveBeenCalledTimes(1);
        expect(callbacks[index]?.mock.calls[0]?.[0].contents).toStartWith(
          marker
        );
      }

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
            createEditableSurfaceElement(surface)
          )
        );
        expect(renderError).toBe(attachmentError);
        expect(editors).toHaveLength(1);
        expect(editors[0]?.cleanUpCount).toBe(1);

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

  test('cleans StrictMode and virtualized edit passes without leaks', async () => {
    const { cleanup } = installDom();
    const cleanupActEnvironment = installReactActEnvironment();
    const container = document.createElement('div');
    document.body.appendChild(container);
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
                    file: oldFile,
                    options: {
                      disableFileHeader: true,
                      theme: DEFAULT_THEMES,
                    },
                  }),
                  createElement(ReactFileDiffComponent, {
                    disableWorkerPool: true,
                    edit: true,
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

      expect(editors.length).toBeGreaterThanOrEqual(4);
      expect(
        editors.slice(0, -2).every((editor) => editor.cleanUpCount > 0)
      ).toBe(true);
      expect(
        editors.slice(-2).every((editor) => editor.cleanUpCount === 0)
      ).toBe(true);

      await unmountRoot(root);
      root = undefined;
      expect(editors.every((editor) => editor.cleanUpCount > 0)).toBe(true);
    } finally {
      await unmountRoot(root);
      cleanupActEnvironment();
      cleanup();
    }
  });
});
