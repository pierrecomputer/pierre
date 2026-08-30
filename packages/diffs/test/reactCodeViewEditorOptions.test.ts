import { afterAll, describe, expect, mock, test } from 'bun:test';
import {
  act,
  type ComponentType,
  createElement,
  createRef,
  type PropsWithChildren,
  type ReactElement,
  type Ref,
  StrictMode,
} from 'react';
import { createRoot as createReactRoot, type Root } from 'react-dom/client';

import type { CodeViewLineSelection } from '../src/components/CodeView';
import type { File, FileEditCompleteEvent } from '../src/components/File';
import type {
  FileDiff,
  FileDiffEditCompleteEvent,
} from '../src/components/FileDiff';
import { DEFAULT_THEMES } from '../src/constants';
import { Editor, type EditorOptions } from '../src/editor/editor';
import type {
  EditCompletionDecision,
  EditorChangeEvent,
  EditorDocumentKind,
  EditorFactory,
} from '../src/editor/types';
import { disposeHighlighter } from '../src/highlighter/shared_highlighter';
import {
  CodeView,
  type CodeViewHandle,
  type CodeViewProps,
  type CodeViewReactOptions,
  EditProvider,
  type EditProviderProps,
} from '../src/react';
import type { CodeViewItem } from '../src/types';
import { parseDiffFromFile } from '../src/utils/parseDiffFromFile';
import {
  dispatchScroll,
  installDom,
  makeFile,
  wait,
  waitFor,
} from './domHarness';

afterAll(async () => {
  await disposeHighlighter();
});

const ReactCodeViewComponent = CodeView as ComponentType<
  CodeViewProps<undefined> & {
    ref?: Ref<CodeViewHandle<undefined>>;
  }
>;
const EditProviderComponent = EditProvider as ComponentType<
  PropsWithChildren<EditProviderProps<undefined>>
>;

const CODE_VIEW_OPTIONS = {
  disableFileHeader: true,
  theme: DEFAULT_THEMES,
} as const;
const CODE_VIEW_STYLE = { height: 800, overflow: 'auto' } as const;

type TestEditorComponent<TDocumentKind extends EditorDocumentKind> =
  TDocumentKind extends 'file' ? File<undefined> : FileDiff<undefined>;

interface TrackedCodeViewEditorState {
  edits: Array<File<undefined> | FileDiff<undefined>>;
  fullCleanUps: number;
  recycleCleanUps: number;
}

type TrackedCodeViewEditor<TDocumentKind extends EditorDocumentKind> = Editor<
  TDocumentKind,
  undefined
> &
  TrackedCodeViewEditorState;

type AnyTrackedCodeViewEditor =
  | TrackedCodeViewEditor<'file'>
  | TrackedCodeViewEditor<'file-diff'>;

function createTrackedEditor<TDocumentKind extends EditorDocumentKind>(
  documentKind: TDocumentKind,
  options: EditorOptions<TDocumentKind, undefined>,
  attachmentError?: Error
): TrackedCodeViewEditor<TDocumentKind> {
  const editor = new Editor(
    documentKind,
    options
  ) as TrackedCodeViewEditor<TDocumentKind>;
  editor.edits = [];
  editor.fullCleanUps = 0;
  editor.recycleCleanUps = 0;

  const edit = editor.edit.bind(editor);
  editor.edit = ((instance: TestEditorComponent<TDocumentKind>) => {
    editor.edits.push(instance);
    const complete =
      instance.type === 'file'
        ? (edit as (file: File<undefined>) => () => void)(instance)
        : (edit as (fileDiff: FileDiff<undefined>) => () => void)(instance);
    if (attachmentError != null) {
      throw attachmentError;
    }
    return complete;
  }) as typeof editor.edit;

  const cleanUp = editor.cleanUp.bind(editor);
  editor.cleanUp = (reason) => {
    if (reason === 'recycle') {
      editor.recycleCleanUps += 1;
    } else {
      editor.fullCleanUps += 1;
    }
    cleanUp(reason);
  };

  return editor;
}

// Write text into an attached instance's private session file, standing in
// for real editor document changes; completion events are built from it.
type ItemCompletionEvent =
  | FileEditCompleteEvent<undefined>
  | FileDiffEditCompleteEvent<undefined>;

// The completed file contents of a file completion event, for assertions on
// union-typed mock calls.
function fileEventContents(event: ItemCompletionEvent | undefined) {
  return event != null && 'file' in event ? event.file.contents : undefined;
}

async function setSessionText(
  editor: AnyTrackedCodeViewEditor,
  contents: string
): Promise<void> {
  await waitFor(() => editor.getFile() !== undefined);
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

function createEditorHarness(attachmentError?: Error) {
  const editors: AnyTrackedCodeViewEditor[] = [];
  const receivedDocumentKinds: EditorDocumentKind[] = [];
  const receivedOptions: EditorOptions<EditorDocumentKind, undefined>[] = [];
  const receivedEditStateKeys: Array<string | undefined> = [];
  const createEditor: EditorFactory = (documentKind, options, editStateKey) => {
    receivedDocumentKinds.push(documentKind);
    receivedOptions.push(
      options as EditorOptions<EditorDocumentKind, undefined>
    );
    receivedEditStateKeys.push(editStateKey);
    const editor = createTrackedEditor(documentKind, options, attachmentError);
    editors.push(editor as unknown as AnyTrackedCodeViewEditor);
    return editor;
  };
  return {
    createEditor,
    editors,
    receivedDocumentKinds,
    receivedEditStateKeys,
    receivedOptions,
  };
}

function makeFileItem(
  id: string,
  {
    collapsed,
    edit = false,
    lineCount = 20,
    version = 0,
  }: {
    collapsed?: boolean;
    edit?: boolean;
    lineCount?: number;
    version?: number;
  } = {}
): CodeViewItem<undefined> {
  return {
    id,
    type: 'file',
    file: makeFile(`${id}.ts`, lineCount),
    collapsed,
    edit,
    version,
  };
}

function makeDiffItem(id: string, edit = false): CodeViewItem<undefined> {
  return {
    id,
    type: 'diff',
    fileDiff: parseDiffFromFile(
      { name: `${id}.ts`, contents: 'const value = 1;\n' },
      { name: `${id}.ts`, contents: 'const value = 2;\n' }
    ),
    edit,
    version: 0,
  };
}

function createCodeViewElement(
  props: CodeViewProps<undefined> & {
    ref?: Ref<CodeViewHandle<undefined>>;
  }
): ReactElement {
  return createElement(ReactCodeViewComponent, {
    disableWorkerPool: true,
    options: CODE_VIEW_OPTIONS,
    style: CODE_VIEW_STYLE,
    ...props,
  });
}

async function renderRoot(root: Root, element: ReactElement): Promise<void> {
  await act(async () => {
    root.render(element);
    await wait(10);
  });
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
    await renderRoot(root, element);
  } catch (error) {
    return error;
  }
  return undefined;
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

function installCodeViewDom() {
  const dom = installDom();
  const getBoundingClientRect = HTMLElement.prototype.getBoundingClientRect;
  Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
    configurable: true,
    value(this: HTMLElement) {
      if (this.style.height === '800px') {
        return {
          bottom: 800,
          height: 800,
          left: 0,
          right: 1000,
          top: 0,
          width: 1000,
          x: 0,
          y: 0,
          toJSON() {
            return {};
          },
        };
      }
      return getBoundingClientRect.call(this);
    },
  });
  return dom;
}

function withProvider(
  createEditor: EditorFactory,
  child: ReactElement
): ReactElement {
  return createElement(EditProviderComponent, { createEditor }, child);
}

describe('React CodeView editor factory', () => {
  test('renders read-only without a provider and rejects a factory escape hatch', async () => {
    const { cleanup } = installCodeViewDom();
    const cleanupActEnvironment = installReactActEnvironment();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const handle = createRef<CodeViewHandle<undefined>>();
    const bypassFactory = mock(() => new Editor('file'));
    // Simulate an untyped JavaScript caller trying the removed options escape
    // hatch; the React adapter must still win at runtime.
    const optionsWithFactory = {
      ...CODE_VIEW_OPTIONS,
      createEditor: bypassFactory,
    } as CodeViewReactOptions<undefined>;
    const readOnly = makeFileItem('a');
    let root: Root | undefined;

    try {
      root = createReactRoot(container);
      await renderRoot(
        root,
        createCodeViewElement({
          ref: handle,
          items: [readOnly],
          options: optionsWithFactory,
        })
      );

      expect(handle.current?.getInstance()).toBeDefined();
      expect(handle.current?.getEditor('a')).toBeUndefined();
      expect(bypassFactory).not.toHaveBeenCalled();

      const missingProviderError = await captureRenderError(
        root,
        createCodeViewElement({
          ref: handle,
          items: [{ ...readOnly, edit: true, version: 1 }],
          options: optionsWithFactory,
        })
      );
      expect(missingProviderError).toBeInstanceOf(Error);
      expect((missingProviderError as Error).message).toBe(
        'CodeView: createEditor is required for items with edit: true'
      );
      expect(bypassFactory).not.toHaveBeenCalled();
    } finally {
      await unmountRoot(root);
      cleanupActEnvironment();
      cleanup();
    }
  });

  test('merges editor options and isolates simultaneous item callbacks', async () => {
    const { cleanup } = installCodeViewDom();
    const cleanupActEnvironment = installReactActEnvironment();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const {
      createEditor,
      editors,
      receivedDocumentKinds,
      receivedEditStateKeys,
      receivedOptions,
    } = createEditorHarness();
    const attemptedOnChange = mock(() => {});
    const onAttach = mock(() => {});
    const onItemEditChange = mock(
      (
        _event: EditorChangeEvent<'file' | 'file-diff', undefined>,
        _item: CodeViewItem<undefined>
      ) => {}
    );
    const editorOptions: EditorOptions<EditorDocumentKind, undefined> = {
      // A loosely typed caller can still carry onChange at runtime. CodeView's
      // item router must overwrite it before invoking the provider factory.
      historyMaxEntries: 17,
      onAttach,
      onChange: attemptedOnChange,
      roundedSelection: false,
    };
    let root: Root | undefined;

    try {
      root = createReactRoot(container);
      await renderRoot(
        root,
        withProvider(
          createEditor,
          createCodeViewElement({
            editorOptions,
            getEditStateKey: (item) => `history:${item.id}`,
            items: [makeFileItem('a', { edit: true }), makeDiffItem('b', true)],
            onItemEditChange,
          })
        )
      );

      expect(editors).toHaveLength(2);
      expect(new Set(editors).size).toBe(2);
      expect(receivedDocumentKinds).toEqual(['file', 'file-diff']);
      expect(receivedEditStateKeys).toEqual(['history:a', 'history:b']);
      expect(receivedOptions).toHaveLength(2);
      for (const options of receivedOptions) {
        expect(options.historyMaxEntries).toBe(17);
        expect(options.onAttach).toBe(onAttach);
        expect(options.roundedSelection).toBe(false);
        expect(options.onChange).toBeDefined();
        expect(options.onChange).not.toBe(attemptedOnChange);
      }

      await setSessionText(editors[0], 'edited a');
      await setSessionText(editors[1], 'edited b');

      expect(attemptedOnChange).not.toHaveBeenCalled();
      expect(onItemEditChange).toHaveBeenCalledTimes(2);
      expect(onItemEditChange.mock.calls[0]?.[1].id).toBe('a');
      expect(onItemEditChange.mock.calls[0]?.[0].file.contents).toBe(
        'edited a'
      );
      expect(onItemEditChange.mock.calls[0]?.[0].editor).toBe(editors[0]);
      expect(onItemEditChange.mock.calls[1]?.[1].id).toBe('b');
      expect(onItemEditChange.mock.calls[1]?.[0].file.contents).toBe(
        'edited b'
      );
      expect(onItemEditChange.mock.calls[1]?.[0].editor).toBe(editors[1]);
    } finally {
      await unmountRoot(root);
      cleanupActEnvironment();
      cleanup();
    }
  });

  test('uses replacement factories, options, and keys only for later sessions', async () => {
    const { cleanup } = installCodeViewDom();
    const cleanupActEnvironment = installReactActEnvironment();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const first = createEditorHarness();
    const second = createEditorHarness();
    const baseItem = makeFileItem('a', { edit: true });
    let root: Root | undefined;

    const render = async (
      item: CodeViewItem<undefined>,
      createEditor: EditorFactory,
      historyMaxEntries: number,
      getEditStateKey: (item: CodeViewItem<undefined>) => string
    ) => {
      await renderRoot(
        root!,
        withProvider(
          createEditor,
          createCodeViewElement({
            editorOptions: { historyMaxEntries },
            getEditStateKey,
            items: [item],
          })
        )
      );
    };

    try {
      root = createReactRoot(container);
      await render(
        baseItem,
        first.createEditor,
        10,
        (item) => `first:${item.id}`
      );
      expect(first.editors).toHaveLength(1);
      expect(first.receivedOptions[0]?.historyMaxEntries).toBe(10);
      expect(first.receivedEditStateKeys).toEqual(['first:a']);

      await render(
        baseItem,
        second.createEditor,
        20,
        (item) => `second:${item.id}`
      );
      expect(first.editors).toHaveLength(1);
      expect(second.editors).toHaveLength(0);
      expect(first.editors[0].fullCleanUps).toBe(0);

      await render(
        { ...baseItem, edit: false, version: 1 },
        second.createEditor,
        20,
        (item) => `second:${item.id}`
      );
      expect(first.editors[0].fullCleanUps).toBeGreaterThanOrEqual(1);

      await render(
        { ...baseItem, edit: true, version: 2 },
        second.createEditor,
        20,
        (item) => `second:${item.id}`
      );
      expect(second.editors).toHaveLength(1);
      expect(second.receivedOptions[0]?.historyMaxEntries).toBe(20);
      expect(second.receivedEditStateKeys).toEqual(['second:a']);

      await unmountRoot(root);
      root = undefined;
      expect(second.editors[0].fullCleanUps).toBeGreaterThanOrEqual(1);
    } finally {
      await unmountRoot(root);
      cleanupActEnvironment();
      cleanup();
    }
  });

  test('completes controlled sessions with their owning items', async () => {
    const { cleanup } = installCodeViewDom();
    const cleanupActEnvironment = installReactActEnvironment();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const handle = createRef<CodeViewHandle<undefined>>();
    const { createEditor, editors } = createEditorHarness();
    const onItemEditComplete = mock(
      (
        _event: ItemCompletionEvent,
        _item: CodeViewItem<undefined>,
        _nextItem: CodeViewItem<undefined>
      ): EditCompletionDecision => 'reject'
    );
    const editOffItem = makeFileItem('edit-off', {
      edit: true,
      lineCount: 2,
    });
    const collapsedItem = makeFileItem('collapsed', {
      edit: true,
      lineCount: 2,
    });
    const removedItem = makeFileItem('removed', {
      edit: true,
      lineCount: 2,
    });
    const unchangedItem = makeFileItem('unchanged', {
      edit: true,
      lineCount: 2,
    });
    let root: Root | undefined;

    const render = async (items: CodeViewItem<undefined>[]) => {
      await renderRoot(
        root!,
        withProvider(
          createEditor,
          createCodeViewElement({ items, onItemEditComplete, ref: handle })
        )
      );
    };

    try {
      root = createReactRoot(container);
      await render([editOffItem, collapsedItem, removedItem, unchangedItem]);
      expect(editors).toHaveLength(4);

      const getEditor = (id: string) =>
        handle.current?.getEditor(id) as AnyTrackedCodeViewEditor | undefined;
      const editOffEditor = getEditor('edit-off');
      const collapsedEditor = getEditor('collapsed');
      const removedEditor = getEditor('removed');
      const unchangedEditor = getEditor('unchanged');
      expect(editOffEditor).toBeDefined();
      expect(collapsedEditor).toBeDefined();
      expect(removedEditor).toBeDefined();
      expect(unchangedEditor).toBeDefined();

      await setSessionText(editOffEditor!, 'edit-off contents');
      await setSessionText(collapsedEditor!, 'collapsed contents');
      await setSessionText(removedEditor!, 'removed contents');

      const editOffEnd = { ...editOffItem, edit: false, version: 1 };
      const collapsedEnd = {
        ...collapsedItem,
        collapsed: true,
        version: 1,
      };
      const unchangedEnd = { ...unchangedItem, edit: false, version: 1 };
      await render([editOffEnd, collapsedEnd, unchangedEnd]);

      // Edit-off, removal, and the unchanged edit complete. Collapse suspends
      // its session.
      expect(onItemEditComplete).toHaveBeenCalledTimes(3);
      const completions = new Map(
        onItemEditComplete.mock.calls.map(([event, item]) => [
          item.id,
          { event, item },
        ])
      );
      expect([...completions.keys()].sort()).toEqual([
        'edit-off',
        'removed',
        'unchanged',
      ]);
      expect(fileEventContents(completions.get('edit-off')?.event)).toBe(
        'edit-off contents'
      );
      expect(completions.get('edit-off')?.item).toBe(editOffEnd);
      expect(fileEventContents(completions.get('removed')?.event)).toBe(
        'removed contents'
      );
      expect(completions.get('removed')?.item).toBe(removedItem);
      expect(completions.get('unchanged')?.item).toBe(unchangedEnd);
      expect(collapsedEditor!.recycleCleanUps).toBe(1);
      expect(collapsedEditor!.fullCleanUps).toBe(0);
      expect(handle.current?.getEditor('collapsed')).toBe(collapsedEditor);
    } finally {
      await unmountRoot(root);
      cleanupActEnvironment();
      cleanup();
    }
  });

  test('completes every session when a controlled empty list removes all items', async () => {
    const { cleanup } = installCodeViewDom();
    const cleanupActEnvironment = installReactActEnvironment();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const handle = createRef<CodeViewHandle<undefined>>();
    const { createEditor, editors } = createEditorHarness();
    const onItemEditComplete = mock(
      (
        _event: ItemCompletionEvent,
        _item: CodeViewItem<undefined>,
        _nextItem: CodeViewItem<undefined>
      ): EditCompletionDecision => 'reject'
    );
    const changedItem = makeFileItem('changed', { edit: true, lineCount: 2 });
    const unchangedItem = makeFileItem('unchanged', {
      edit: true,
      lineCount: 2,
    });
    let root: Root | undefined;

    const render = async (items: CodeViewItem<undefined>[]) => {
      await renderRoot(
        root!,
        withProvider(
          createEditor,
          createCodeViewElement({
            items,
            onItemEditComplete,
            ref: handle,
          })
        )
      );
    };

    try {
      root = createReactRoot(container);
      await render([changedItem, unchangedItem]);
      expect(editors).toHaveLength(2);

      const changedEditor = handle.current?.getEditor(changedItem.id) as
        | AnyTrackedCodeViewEditor
        | undefined;
      expect(changedEditor).toBeDefined();
      await setSessionText(changedEditor!, 'changed contents');
      await render([]);

      expect(editors.every((editor) => editor.fullCleanUps > 0)).toBe(true);
      expect(onItemEditComplete).toHaveBeenCalledTimes(2);
      const completions = new Map(
        onItemEditComplete.mock.calls.map(([event, item]) => [item.id, event])
      );
      expect(completions.get(changedItem.id)?.editor).toBe(changedEditor);
      expect(fileEventContents(completions.get(changedItem.id))).toBe(
        'changed contents'
      );
      expect(completions.has(unchangedItem.id)).toBe(true);
    } finally {
      await unmountRoot(root);
      cleanupActEnvironment();
      cleanup();
    }
  });

  test('uses the context factory for imperative item additions', async () => {
    const { cleanup } = installCodeViewDom();
    const cleanupActEnvironment = installReactActEnvironment();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const handle = createRef<CodeViewHandle<undefined>>();
    const { createEditor, editors } = createEditorHarness();
    let root: Root | undefined;

    try {
      root = createReactRoot(container);
      await renderRoot(
        root,
        withProvider(
          createEditor,
          createCodeViewElement({
            initialItems: [makeFileItem('read-only')],
            ref: handle,
          })
        )
      );

      await act(async () => {
        handle.current?.addItems([makeFileItem('edited', { edit: true })]);
        handle.current?.getInstance()?.render(true);
        await wait(10);
      });

      expect(editors).toHaveLength(1);
      expect(handle.current?.getEditor('edited')).toBe(editors[0]);
    } finally {
      await unmountRoot(root);
      cleanupActEnvironment();
      cleanup();
    }
  });

  test('removes initial items through the imperative handle', async () => {
    const { cleanup } = installCodeViewDom();
    const cleanupActEnvironment = installReactActEnvironment();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const handle = createRef<CodeViewHandle<undefined>>();
    let root: Root | undefined;

    try {
      root = createReactRoot(container);
      await renderRoot(
        root,
        createCodeViewElement({
          initialItems: [makeFileItem('first'), makeFileItem('last')],
          ref: handle,
        })
      );

      expect(handle.current?.removeItem('first')).toBe(true);
      expect(handle.current?.getItem('first')).toBeUndefined();
      expect(handle.current?.getItem('last')).toBeDefined();
    } finally {
      await unmountRoot(root);
      cleanupActEnvironment();
      cleanup();
    }
  });

  test('rejects imperative item removal in controlled mode', async () => {
    const { cleanup } = installCodeViewDom();
    const cleanupActEnvironment = installReactActEnvironment();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const handle = createRef<CodeViewHandle<undefined>>();
    let root: Root | undefined;

    try {
      root = createReactRoot(container);
      await renderRoot(
        root,
        createCodeViewElement({ items: [makeFileItem('a')], ref: handle })
      );

      expect(() => handle.current?.removeItem('a')).toThrow(
        'CodeView.removeItem cannot be used when CodeView is controlled. Use initialItems for imperative item updates.'
      );
      expect(handle.current?.getItem('a')).toBeDefined();
    } finally {
      await unmountRoot(root);
      cleanupActEnvironment();
      cleanup();
    }
  });

  test('retains an item editor across virtualization', async () => {
    const { cleanup } = installCodeViewDom();
    const cleanupActEnvironment = installReactActEnvironment();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const handle = createRef<CodeViewHandle<undefined>>();
    const { createEditor, editors } = createEditorHarness();
    const items = [
      makeFileItem('edited', { edit: true, lineCount: 30 }),
      ...Array.from({ length: 39 }, (_, index) =>
        makeFileItem(`file-${index}`, { lineCount: 30 })
      ),
    ];
    let root: Root | undefined;

    try {
      root = createReactRoot(container);
      await renderRoot(
        root,
        withProvider(
          createEditor,
          createCodeViewElement({ items, ref: handle })
        )
      );

      const viewer = handle.current?.getInstance();
      const scrollContainer = viewer?.getContainerElement();
      expect(viewer).toBeDefined();
      expect(scrollContainer).toBeDefined();
      expect(editors).toHaveLength(1);

      const editor = editors[0];
      scrollContainer!.scrollTop = 20_000;
      dispatchScroll(scrollContainer!);
      viewer!.render(true);
      await wait(0);
      expect(editor.recycleCleanUps).toBeGreaterThanOrEqual(1);
      expect(editor.fullCleanUps).toBe(0);
      expect(handle.current?.getEditor('edited')).toBe(editor);

      scrollContainer!.scrollTop = 0;
      dispatchScroll(scrollContainer!);
      viewer!.render(true);
      await wait(0);
      expect(editors).toHaveLength(1);
      expect(editor.edits.length).toBeGreaterThanOrEqual(2);
      expect(handle.current?.getEditor('edited')).toBe(editor);
    } finally {
      await unmountRoot(root);
      cleanupActEnvironment();
      cleanup();
    }
  });

  test('cleans a newly created editor when attachment fails', async () => {
    const { cleanup } = installCodeViewDom();
    const cleanupActEnvironment = installReactActEnvironment();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const attachmentError = new Error('CodeView attachment failed');
    const { createEditor, editors } = createEditorHarness(attachmentError);
    let root: Root | undefined;

    try {
      root = createReactRoot(container);
      const renderError = await captureRenderError(
        root,
        withProvider(
          createEditor,
          createCodeViewElement({
            items: [makeFileItem('a', { edit: true })],
          })
        )
      );
      expect(renderError).toBe(attachmentError);
      expect(editors).toHaveLength(1);
      expect(editors[0].fullCleanUps).toBe(1);
    } finally {
      await unmountRoot(root);
      cleanupActEnvironment();
      cleanup();
    }
  });

  test('cleans StrictMode replay editors without leaking the active session', async () => {
    const { cleanup } = installCodeViewDom();
    const cleanupActEnvironment = installReactActEnvironment();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const { createEditor, editors } = createEditorHarness();
    let root: Root | undefined;

    try {
      root = createReactRoot(container);
      await renderRoot(
        root,
        createElement(
          StrictMode,
          null,
          withProvider(
            createEditor,
            createCodeViewElement({
              items: [makeFileItem('a', { edit: true })],
            })
          )
        )
      );

      expect(editors.length).toBeGreaterThanOrEqual(2);
      expect(
        editors.slice(0, -1).every((editor) => editor.fullCleanUps > 0)
      ).toBe(true);
      expect(editors.at(-1)?.fullCleanUps).toBe(0);

      await unmountRoot(root);
      root = undefined;
      expect(editors.every((editor) => editor.fullCleanUps > 0)).toBe(true);
    } finally {
      await unmountRoot(root);
      cleanupActEnvironment();
      cleanup();
    }
  });
});

describe('React CodeView edit completion teardown', () => {
  for (const teardown of ['direct cleanup', 'React unmount'] as const) {
    test(`completes a changed session once on ${teardown}`, async () => {
      const { cleanup } = installCodeViewDom();
      const cleanupActEnvironment = installReactActEnvironment();
      const container = document.createElement('div');
      document.body.appendChild(container);
      const handle = createRef<CodeViewHandle<undefined>>();
      const { createEditor, editors } = createEditorHarness();
      const onItemEditComplete = mock(
        (
          _event: ItemCompletionEvent,
          _item: CodeViewItem<undefined>
        ): EditCompletionDecision => 'reject'
      );
      let root: Root | undefined;

      try {
        root = createReactRoot(container);
        await renderRoot(
          root,
          withProvider(
            createEditor,
            createCodeViewElement({
              items: [makeFileItem('a', { edit: true })],
              onItemEditComplete,
              ref: handle,
            })
          )
        );

        expect(editors).toHaveLength(1);
        await setSessionText(editors[0], 'unsaved');

        if (teardown === 'direct cleanup') {
          await act(async () => {
            handle.current?.getInstance()?.cleanUp();
            await wait(0);
          });
        } else {
          await unmountRoot(root);
          root = undefined;
        }

        // Teardown is a completion boundary like standalone unmount: the
        // changed session fires once, and nothing is installed.
        expect(onItemEditComplete).toHaveBeenCalledTimes(1);
        expect(fileEventContents(onItemEditComplete.mock.calls[0]?.[0])).toBe(
          'unsaved'
        );
        expect(editors[0].fullCleanUps).toBeGreaterThanOrEqual(1);
      } finally {
        await unmountRoot(root);
        cleanupActEnvironment();
        cleanup();
      }
    });
  }
});

describe('React CodeView selection', () => {
  test('keeps selection controlled by props with a provider mounted', async () => {
    const { cleanup } = installCodeViewDom();
    const cleanupActEnvironment = installReactActEnvironment();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const handle = createRef<CodeViewHandle<undefined>>();
    const { createEditor, editors } = createEditorHarness();
    const items = [makeFileItem('a')];
    const initialSelection = {
      id: 'a',
      range: { start: 1, end: 1 },
    };
    const nextSelection = {
      id: 'a',
      range: { start: 2, end: 3 },
    };
    const onSelectedLinesChange = mock(
      (_selection: CodeViewLineSelection | null) => {}
    );
    let root: Root | undefined;

    const render = async (selectedLines: typeof initialSelection) => {
      await renderRoot(
        root!,
        withProvider(
          createEditor,
          createCodeViewElement({
            items,
            onSelectedLinesChange,
            ref: handle,
            selectedLines,
          })
        )
      );
    };

    try {
      root = createReactRoot(container);
      await render(initialSelection);

      expect(editors).toHaveLength(0);
      expect(handle.current?.getSelectedLines()).toEqual(initialSelection);

      const renderedItem = handle.current?.getInstance()?.getRenderedItems()[0];
      expect(renderedItem).toBeDefined();
      renderedItem?.instance.options.onLineSelectionChange?.(
        nextSelection.range
      );

      expect(onSelectedLinesChange).toHaveBeenLastCalledWith(nextSelection);
      expect(handle.current?.getSelectedLines()).toEqual(initialSelection);

      await render(nextSelection);
      expect(handle.current?.getSelectedLines()).toEqual(nextSelection);
    } finally {
      await unmountRoot(root);
      cleanupActEnvironment();
      cleanup();
    }
  });

  test('overwrites untyped selection options in uncontrolled mode', async () => {
    const { cleanup } = installCodeViewDom();
    const cleanupActEnvironment = installReactActEnvironment();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const handle = createRef<CodeViewHandle<undefined>>();
    const bypassOnSelectedLinesChange = mock(
      (_selection: CodeViewLineSelection | null) => {}
    );
    const optionsWithSelection = {
      ...CODE_VIEW_OPTIONS,
      controlledSelection: true,
      onSelectedLinesChange: bypassOnSelectedLinesChange,
    } as CodeViewReactOptions<undefined>;
    const expectedSelection = {
      id: 'a',
      range: { start: 2, end: 3 },
    };
    let root: Root | undefined;

    try {
      root = createReactRoot(container);
      await renderRoot(
        root,
        createCodeViewElement({
          initialItems: [makeFileItem('a')],
          options: optionsWithSelection,
          ref: handle,
        })
      );

      const renderedItem = handle.current?.getInstance()?.getRenderedItems()[0];
      expect(renderedItem).toBeDefined();
      renderedItem?.instance.options.onLineSelectionChange?.(
        expectedSelection.range
      );

      expect(handle.current?.getSelectedLines()).toEqual(expectedSelection);
      expect(bypassOnSelectedLinesChange).not.toHaveBeenCalled();
    } finally {
      await unmountRoot(root);
      cleanupActEnvironment();
      cleanup();
    }
  });
});
