import type { PreloadFileOptions } from '@pierre/diffs/ssr';

import { CustomScrollbarCSS } from '@/components/CustomScrollbarCSS';

const options = {
  theme: { dark: 'pierre-dark', light: 'pierre-light' },
  disableFileHeader: true,
  unsafeCSS: CustomScrollbarCSS,
} as const;

export const EDIT_VANILLA_FILE_EXAMPLE: PreloadFileOptions<undefined> = {
  file: {
    name: 'editor_vanilla_file.ts',
    contents: `import {
  Virtualizer,
  VirtualizedFile,
  type FileContents,
} from '@pierre/diffs';
import { Editor } from '@pierre/diffs/edit';

const root = document.getElementById('file-scroll-root');
const content = document.getElementById('file-scroll-content');
if (root == null || content == null) {
  throw new Error('Expected virtualized file containers to exist');
}

let file: FileContents = {
  name: 'example.ts',
  contents: 'export function greet(name: string) {\\n  return name;\\n}',
};

const virtualizer = new Virtualizer();
virtualizer.setup(root, content);

const fileInstance = new VirtualizedFile(
  {
    theme: { dark: 'pierre-dark', light: 'pierre-light' },
    // Fired any time there's an edit to the document
    onEditChange(event) {
      console.log('change', event.file.name, event.lineAnnotations);
    },
    // Runs once when a session ends. Return 'accept' to install the event's
    // file and annotations, or 'reject' to revert.
    onEditComplete(event) {
      // Store the edited file so later renders use it, and don't reset back to
      // the stale original.
      file = event.file;
      return 'accept';
    },
  },
  virtualizer
);
fileInstance.render({ file, containerWrapper: content });

const editor = new Editor('file');
// Start an edit session
const dispose = editor.edit(fileInstance);

// Later, complete the session and install an accepted result while the
// component is still mounted.
dispose();`,
  },
  options,
};

export const EDIT_VANILLA_FILE_DIFF_EXAMPLE: PreloadFileOptions<undefined> = {
  file: {
    name: 'editor_vanilla_file_diff.ts',
    contents: `import {
  parseDiffFromFile,
  Virtualizer,
  VirtualizedFileDiff,
  type DiffLineAnnotation,
  type FileDiffMetadata,
} from '@pierre/diffs';
import { Editor } from '@pierre/diffs/edit';

interface ThreadMetadata {
  id: string;
}

const root = document.getElementById('diff-scroll-root');
const content = document.getElementById('diff-scroll-content');
if (root == null || content == null) {
  throw new Error('Expected virtualized diff containers to exist');
}
const contentWrapper = content;

let fileDiff: FileDiffMetadata = parseDiffFromFile(
  {
    name: 'example.ts',
    contents: 'export function greet(name: string) {\\n  return name;\\n}',
  },
  {
    name: 'example.ts',
    contents:
      'export function greet(name: string) {\\n  return "Hello, " + name;\\n}',
  }
);

let lineAnnotations: DiffLineAnnotation<ThreadMetadata>[] = [
  {
    side: 'additions',
    lineNumber: 2,
    metadata: { id: 'greeting-review' },
  },
];

const virtualizer = new Virtualizer();
virtualizer.setup(root, contentWrapper);

const fileDiffInstance = new VirtualizedFileDiff<ThreadMetadata>(
  {
    theme: { dark: 'pierre-dark', light: 'pierre-light' },
    renderAnnotation(annotation) {
      const element = document.createElement('div');
      element.textContent = 'Thread ' + annotation.metadata.id;
      return element;
    },
    // Edit mode owns annotation positions during the session; you do not sync
    // them back. Store the completed diff and its final annotations so later
    // renders stay in sync, then return 'accept'; return 'reject' to revert.
    onEditComplete(event) {
      fileDiff = event.fileDiff;
      if (event.lineAnnotations != null) {
        lineAnnotations = event.lineAnnotations;
      }
      return 'accept';
    },
  },
  virtualizer
);

function renderFromApplicationState() {
  fileDiffInstance.render({
    fileDiff,
    lineAnnotations,
    containerWrapper: contentWrapper,
  });
}

renderFromApplicationState();

const editor = new Editor<'file-diff', ThreadMetadata>('file-diff');
const dispose = editor.edit(fileDiffInstance);

// Later, complete the session and install an accepted result while the
// component is still mounted.
dispose();`,
  },
  options,
};

export const EDIT_VANILLA_CODE_VIEW_EXAMPLE: PreloadFileOptions<undefined> = {
  file: {
    name: 'editor_vanilla_code_view.ts',
    contents: `import {
  CodeView,
  parseDiffFromFile,
  type CodeViewItem,
} from '@pierre/diffs';
import { Editor } from '@pierre/diffs/edit';

interface ThreadMetadata {
  id: string;
}

const oldFile = {
  name: 'example.ts',
  contents: 'export const answer = 41;',
};
const newFile = {
  name: 'example.ts',
  contents: 'export const answer = 42;',
};

const root = document.getElementById('code-view');
const toggleButton = document.getElementById('toggle-editing');
if (root == null || toggleButton == null) {
  throw new Error('Expected CodeView containers to exist');
}

root.style.height = '24rem';
root.style.overflow = 'auto';

const viewer = new CodeView<ThreadMetadata>({
  theme: { dark: 'pierre-dark', light: 'pierre-light' },
  createEditor(editorType, options, editStateKey) {
    return new Editor(editorType, {
      ...options,
      onAttach(editor) {
        editor.focus({ lineNumber: 'first-visible', preventScroll: true });
      },
    }, editStateKey);
  },
  // nextItem is the accepted replacement CodeView built — new fileDiff and
  // annotations, edit: false, bumped version. Re-key the frozen event's value,
  // then return 'accept' (CodeView applies nextItem for you) or 'reject'. Edit
  // mode manages annotation positions during the session, so there is no
  // onItemEditChange sync.
  onItemEditComplete(event, item, nextItem) {
    // Often a good idea to update the cacheKey for a new diff or file to
    // prevent needless extra highlighting
    if ('fileDiff' in event) {
      event.fileDiff.cacheKey = item.id + ':v' + nextItem.version;
    }
    return 'accept';
  },
  renderAnnotation(annotation) {
    const element = document.createElement('div');
    element.textContent = 'Thread ' + annotation.metadata.id;
    return element;
  },
});

viewer.setup(root);

const item: CodeViewItem<ThreadMetadata> = {
  id: 'example.ts',
  type: 'diff',
  fileDiff: parseDiffFromFile(oldFile, newFile),
  annotations: [
    {
      side: 'additions',
      lineNumber: 1,
      metadata: { id: 'answer-review' },
    },
  ],
  edit: true,
  version: 0,
};

viewer.setItems([item]);

toggleButton.addEventListener('click', () => {
  const current = viewer.getItem(item.id);
  if (current == null) {
    return;
  }
  viewer.updateItem({
    ...current,
    edit: current.edit !== true,
    version: (current.version ?? 0) + 1,
  });
});

window.addEventListener('beforeunload', () => {
  viewer.cleanUp();
});`,
  },
  options,
};

export const EDIT_LAZY_FILE_EXAMPLE: PreloadFileOptions<undefined> = {
  file: {
    name: 'editor_lazy_file.ts',
    contents: `import type { VirtualizedFile } from '@pierre/diffs';

const button = document.getElementById('edit-button');

async function edit(fileInstance: VirtualizedFile): Promise<() => void> {
  const { Editor } = await import('@pierre/diffs/edit');
  const editor = new Editor('file');
  return editor.edit(fileInstance);
}

// Click to edit and lazy-load the editor bundle only when it is needed.
button.addEventListener('click', () => {
  void edit(fileInstance);
});`,
  },
  options,
};

export const EDIT_SELECTION_ACTION_EXAMPLE: PreloadFileOptions<undefined> = {
  file: {
    name: 'editor_selection_action.ts',
    contents: `import { Editor } from '@pierre/diffs/edit';

const editor = new Editor('file', {
  enabledSelectionAction: true,
  // The popover appears after a user-created ranged selection.
  renderSelectionAction: (context) => {
    const container = document.createElement('div');
    const button = document.createElement('button');

    button.type = 'button';
    button.textContent = 'Wrap selection in TODO()';
    button.addEventListener('click', () => {
      context.replaceSelectionText(\`TODO(\${context.getSelectionText()})\`);
      context.close();
    });

    container.appendChild(button);
    return container;
  },
});`,
  },
  options,
};

export const EDIT_SELECTION_ACTION_CONTEXT_TYPE: PreloadFileOptions<undefined> =
  {
    file: {
      name: 'selection_action_context.ts',
      contents: `export interface SelectionActionContext<
  EType extends EditorType,
  LAnnotation
> {
  /** The current selection. */
  selection: EditorSelection;
  /** The text document. */
  textDocument: TextDocument<EType, LAnnotation>;
  /** Applies the edits to the text document. */
  applyEdits: (edits: TextEdit[]) => void;
  /** Gets the text of the current selection. */
  getSelectionText: () => string;
  /** Replaces the text of the current selection. */
  replaceSelectionText: (text: string) => void;
  /** Closes the selection action. */
  close: () => void;
}`,
    },
    options,
  };

export const EDIT_CARET_TYPE: PreloadFileOptions<undefined> = {
  file: {
    name: 'editor_caret.ts',
    contents: `interface CaretMetadata {
  /** Caret color, also used for the derived highlight tint. */
  color: string;
}

interface EditorCaret<T> {
  /** Fixed edge of the remote selection. */
  anchor: { line: number; character: number };
  /** Active edge where the remote caret renders. */
  focus: { line: number; character: number };
  /** Application metadata plus the required caret color. */
  metadata: T & CaretMetadata;
}`,
  },
  options,
};

export const EDIT_CARET_EXAMPLE: PreloadFileOptions<undefined> = {
  file: {
    name: 'editor_carets.ts',
    contents: `import { Editor, type EditorOptions } from '@pierre/diffs/edit';

interface Collaborator {
  name: string;
}

const editorOptions: EditorOptions<'file', undefined, Collaborator> = {
  renderCaret({ metadata }) {
    const caret = document.createElement('span');
    caret.ariaLabel = metadata.name + "'s caret";
    caret.textContent = metadata.name;
    // The element is mounted inside the editor's shadow root.
    caret.style.cssText =
      'display:block;border-left:2px solid ' +
      metadata.color +
      ';padding-left:4px;color:' +
      metadata.color +
      ';white-space:nowrap';
    return caret;
  },
};

const editor = new Editor<'file', undefined, Collaborator>(
  'file',
  editorOptions
);
editor.edit(fileInstance);

// Replace the complete presence snapshot. Equal positions render a caret;
// different positions also render a highlight between anchor and focus.
editor.setCarets([
  {
    anchor: { line: 2, character: 4 },
    focus: { line: 2, character: 4 },
    metadata: { name: 'Ada', color: '#7c3aed' },
  },
  {
    anchor: { line: 5, character: 12 },
    focus: { line: 5, character: 2 },
    metadata: { name: 'Lin', color: '#0284c7' },
  },
]);

editor.setCarets([]);`,
  },
  options,
};

export const EDIT_MARKER_TYPE: PreloadFileOptions<undefined> = {
  file: {
    name: 'marker.ts',
    contents: `type MarkerSeverity = 'error' | 'warning' | 'info' | 'hint';

interface Marker {
  /** Controls the marker color and popover styling. */
  severity: MarkerSeverity;
  /** Popover content. Pass trusted HTML with \`{ html }\`. */
  message: string | { html: string } | HTMLElement;
  /** Start position (zero-based line and character). */
  start: { line: number; character: number };
  /** End position (zero-based line and character). */
  end: { line: number; character: number };
  /** Optional origin label shown in the popover, e.g. "eslint". */
  source?: string;
  /** Optional arbitrary data carried alongside the marker. */
  metadata?: Record<string, unknown>;
}`,
  },
  options,
};

export const EDIT_MARKER_EXAMPLE: PreloadFileOptions<undefined> = {
  file: {
    name: 'editor_markers.ts',
    contents: `import { Editor } from '@pierre/diffs/edit';

const editor = new Editor('file');
editor.edit(fileInstance);

// Apply diagnostics, e.g. from a linter or language server. Inlining the array
// lets TypeScript check the severity literals against the Marker type without
// importing it (the type is reached through editor.setMarkers).
editor.setMarkers([
  {
    severity: 'error',
    source: 'eslint',
    message: 'Expected === and instead saw ==.',
    start: { line: 9, character: 12 },
    end: { line: 9, character: 14 },
  },
  {
    severity: 'warning',
    source: 'eslint',
    message: 'Unexpected var, use let or const instead.',
    start: { line: 1, character: 2 },
    end: { line: 1, character: 5 },
  },
]);

// Pass an empty array to clear all markers.
editor.setMarkers([]);`,
  },
  options,
};

export const EDIT_UNDO_REDO_EXAMPLE: PreloadFileOptions<undefined> = {
  file: {
    name: 'editor_undo_redo.tsx',
    contents: `import type { FileContents } from '@pierre/diffs';
import {
  Editor,
  type EditorFactory,
  type EditorOptions,
} from '@pierre/diffs/edit';
import {
  EditProvider,
  File,
} from '@pierre/diffs/react';
import { useMemo, useRef, useState } from 'react';

const file: FileContents = {
  name: 'example.ts',
  contents: 'export const x = 1;',
};

const createEditor: EditorFactory = (
  editorType,
  options,
  editStateKey
) => new Editor(editorType, options, editStateKey);

export function EditableFileWithHistoryToolbar() {
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  const editorRef = useRef<Editor<'file'> | null>(null);
  // Creation-time options: capture the editor for the toolbar's imperative
  // calls. The change stream lives on the component's onEditChange prop.
  const editorOptions = useMemo<EditorOptions<'file'>>(
    () => ({
      historyMaxEntries: 100,
      onAttach(editor) {
        editorRef.current = editor;
      },
    }),
    []
  );

  return (
    <EditProvider createEditor={createEditor}>
      <div className="toolbar">
        <button type="button" disabled={!canUndo} onClick={() => editorRef.current?.undo()}>
          Undo
        </button>
        <button type="button" disabled={!canRedo} onClick={() => editorRef.current?.redo()}>
          Redo
        </button>
      </div>
      <File
        file={file}
        edit
        editorOptions={editorOptions}
        onEditChange={() => {
          // Undo and redo run through the same change path as edits, so
          // refresh toolbar state on every change, not only on button clicks.
          setCanUndo(editorRef.current?.canUndo ?? false);
          setCanRedo(editorRef.current?.canRedo ?? false);
        }}
      />
    </EditProvider>
  );
}`,
  },
  options,
};

export const EDIT_REACT_CREATE_EDITOR_EXAMPLE: PreloadFileOptions<undefined> = {
  file: {
    name: 'editor_react_create_editor.tsx',
    contents: `const createEditor = useCallback<EditorFactory>(
  (editorType, editorOptions, editStateKey) =>
    new Editor(editorType, {
      ...defaultEditorOptions,
      ...editorOptions,
    }, editStateKey),
  []
);

const editorOptions = useMemo<EditorOptions<'file'>>(
  () => ({
    onAttach(editor) {
      editorRef.current = editor;
    },
  }),
  []
);

// Mount EditProvider near the root so its editors are available to every
// editable File, diff, and CodeView.
return (
  <EditProvider createEditor={createEditor}>
    <File
      file={file}
      edit={editing}
      editStateKey="review:example.ts"
      editorOptions={editorOptions}
      onEditChange={handleChange}
    />
  </EditProvider>
);`,
  },
  options,
};

export const EDIT_REACT_EXAMPLE: PreloadFileOptions<undefined> = {
  file: {
    name: 'editor_react.tsx',
    contents: `import type {
  FileContents,
  FileEditCompleteHandler,
  FileOptions,
} from '@pierre/diffs';
import { Editor, type EditorFactory } from '@pierre/diffs/edit';
import {
  EditProvider,
  File,
  Virtualizer,
} from '@pierre/diffs/react';
import { useCallback, useRef, useState } from 'react';

const initialFile: FileContents = {
  name: 'example.ts',
  contents: \`function greet(name: string) {
  console.log(\\\`Hello, \\\${name}!\\\`);
}

export { greet };\`,
};

const fileOptions: FileOptions<undefined> = {
  theme: { dark: 'pierre-dark', light: 'pierre-light' },
};

const virtualizerStyle = {
  maxHeight: '16rem',
  overflow: 'auto',
  borderRadius: '0.5rem',
} as const;

const createEditor: EditorFactory = (
  editorType,
  options,
  editStateKey
) => new Editor(editorType, options, editStateKey);

export function EditableFile() {
  const [file, setFile] = useState(initialFile);
  const [editing, setEditing] = useState(false);
  // Cancel marks the session so onEditComplete reverts instead of accepting.
  const cancelled = useRef(false);
  const version = useRef(0);

  // Runs once when a session ends. Return 'accept' to install the event's file
  // and annotations, or 'reject' to revert.
  const handleEditComplete = useCallback<FileEditCompleteHandler<undefined>>(
    (event) => {
      if (cancelled.current) {
        cancelled.current = false;
        return 'reject';
      }
      // Accepting: stamp the new contents with a fresh cacheKey, store them,
      // then accept; the component installs the event's file.
      version.current += 1;
      event.file.cacheKey = 'example:v' + version.current;
      setFile(event.file);
      return 'accept';
    },
    []
  );

  // This example is self-contained. Apps should usually mount EditProvider near
  // the root so its factory is available to every editable File, diff, and
  // CodeView.
  return (
    <EditProvider createEditor={createEditor}>
      {editing ? (
        <>
          <button
            type="button"
            onClick={() => {
              cancelled.current = true;
              setEditing(false);
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => {
              cancelled.current = false;
              setEditing(false);
            }}
          >
            Save
          </button>
        </>
      ) : (
        <button
          type="button"
          onClick={() => {
            cancelled.current = false;
            setEditing(true);
          }}
        >
          Edit
        </button>
      )}

      <Virtualizer style={virtualizerStyle}>
        <File
          file={file}
          options={fileOptions}
          edit={editing}
          onEditComplete={handleEditComplete}
        />
      </Virtualizer>
    </EditProvider>
  );
}`,
  },
  options,
};

export const EDIT_REACT_FILE_DIFF_EXAMPLE: PreloadFileOptions<undefined> = {
  file: {
    name: 'editor_react_file_diff.tsx',
    contents: `import {
  parseDiffFromFile,
  type DiffLineAnnotation,
  type FileDiffEditCompleteHandler,
  type FileDiffMetadata,
  type FileDiffOptions,
} from '@pierre/diffs';
import { Editor, type EditorFactory } from '@pierre/diffs/edit';
import {
  EditProvider,
  FileDiff,
  Virtualizer,
} from '@pierre/diffs/react';
import { useCallback, useRef, useState } from 'react';

interface ThreadMetadata {
  id: string;
}

const initialAnnotations: DiffLineAnnotation<ThreadMetadata>[] = [
  {
    side: 'additions',
    lineNumber: 1,
    metadata: { id: 'updated-message-review' },
  },
];

// FileDiff takes a pre-parsed FileDiffMetadata object.
const initialDiff: FileDiffMetadata = parseDiffFromFile(
  { name: 'example.ts', contents: 'console.log("Hello world")' },
  { name: 'example.ts', contents: 'console.warn("Updated message")' }
);

const fileDiffOptions: FileDiffOptions<ThreadMetadata> = {
  theme: { dark: 'pierre-dark', light: 'pierre-light' },
};

const virtualizerStyle = {
  maxHeight: '16rem',
  overflow: 'auto',
  borderRadius: '0.5rem',
} as const;

const createEditor: EditorFactory<ThreadMetadata> = (
  editorType,
  options,
  editStateKey
) => new Editor(editorType, options, editStateKey);

export function EditableFileDiff() {
  const [fileDiff, setFileDiff] = useState(initialDiff);
  const [annotations, setAnnotations] = useState(initialAnnotations);
  // Key interaction state by stable metadata rather than line coordinates.
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState(false);
  const cancelled = useRef(false);
  const version = useRef(0);

  // On completion, accept the new diff and adopt the final annotation
  // collection, or revert.
  const handleEditComplete = useCallback<
    FileDiffEditCompleteHandler<ThreadMetadata>
  >(
    (event) => {
      if (cancelled.current) {
        cancelled.current = false;
        return 'reject';
      }
      version.current += 1;
      event.fileDiff.cacheKey = 'example:v' + version.current;
      setFileDiff(event.fileDiff);
      if (event.lineAnnotations != null) {
        setAnnotations(event.lineAnnotations);
      }
      return 'accept';
    },
    []
  );

  // This example is self-contained. Apps should usually mount EditProvider near
  // the root so its factory is available to every editable File, diff, and
  // CodeView.
  return (
    <EditProvider createEditor={createEditor}>
      {editing ? (
        <>
          <button
            type="button"
            onClick={() => {
              cancelled.current = true;
              setEditing(false);
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => {
              cancelled.current = false;
              setEditing(false);
            }}
          >
            Save
          </button>
        </>
      ) : (
        <button
          type="button"
          onClick={() => {
            cancelled.current = false;
            setEditing(true);
          }}
        >
          Edit
        </button>
      )}

      <Virtualizer style={virtualizerStyle}>
        <FileDiff<ThreadMetadata>
          fileDiff={fileDiff}
          lineAnnotations={annotations}
          options={fileDiffOptions}
          edit={editing}
          onEditComplete={handleEditComplete}
          renderAnnotation={(annotation) => {
            const id = annotation.metadata.id;
            return (
              <textarea
                aria-label="Review draft"
                value={drafts[id] ?? ''}
                onChange={(event) =>
                  setDrafts((current) => ({
                    ...current,
                    [id]: event.target.value,
                  }))
                }
              />
            );
          }}
        />
      </Virtualizer>
    </EditProvider>
  );
}`,
  },
  options,
};

export const EDIT_REACT_CODE_VIEW_EXAMPLE: PreloadFileOptions<undefined> = {
  file: {
    name: 'editor_react_code_view.tsx',
    contents: `import { parseDiffFromFile, type CodeViewItem } from '@pierre/diffs';
import {
  Editor,
  type EditorFactory,
  type EditorOptions,
} from '@pierre/diffs/edit';
import {
  CodeView,
  EditProvider,
  type CodeViewItemEditCompleteHandler,
} from '@pierre/diffs/react';
import { useCallback, useState } from 'react';

interface ThreadMetadata {
  id: string;
}

const oldFile = {
  name: 'example.ts',
  contents: 'export const answer = 41;',
};
const newFile = {
  name: 'example.ts',
  contents: 'export const answer = 42;',
};

const initialItems: CodeViewItem<ThreadMetadata>[] = [
  {
    id: 'example.ts',
    type: 'diff',
    fileDiff: parseDiffFromFile(oldFile, newFile),
    annotations: [
      {
        side: 'additions',
        lineNumber: 1,
        metadata: { id: 'answer-review' },
      },
    ],
    edit: true,
    version: 0,
  },
];

const codeViewStyle = { height: '24rem', overflow: 'auto' } as const;

const editorOptions: EditorOptions<
  'file' | 'file-diff',
  ThreadMetadata
> = {
  onAttach(editor) {
    editor.focus({ lineNumber: 'first-visible', preventScroll: true });
  },
};

const createEditor: EditorFactory<ThreadMetadata> = (
  editorType,
  options,
  editStateKey
) => new Editor(editorType, options, editStateKey);

export function EditableCodeView() {
  const [items, setItems] = useState(initialItems);

  const toggleEditing = useCallback(() => {
    setItems((current) =>
      current.map((item) => ({
        ...item,
        edit: item.edit !== true,
        version: (item.version ?? 0) + 1,
      }))
    );
  }, []);

  // Called once when an item's session ends. nextItem is the accepted
  // replacement CodeView built — the same item with the completed fileDiff and
  // annotations, edit: false, and a bumped version. Mirror it into state and
  // return 'accept' (edit mode already managed the annotations), or 'reject' to
  // revert.
  const commitEdit = useCallback<CodeViewItemEditCompleteHandler<ThreadMetadata>>(
    (event, item, nextItem) => {
      if (!('fileDiff' in event)) return 'reject';

      event.fileDiff.cacheKey = item.id + ':v' + nextItem.version;
      setItems((current) => {
        // We must insert the new item into our controlled array.
        // If you're using the \`initialItems\` this is unnecessary as
        // the item will be imperatively added automatically for you
        return current.map((existing) => existing.id === item.id ? nextItem : existing)
      });
      return 'accept';
    },
    []
  );

  // This example is self-contained. Apps should usually mount EditProvider near
  // the root so its factory is available to every editable File, diff, and
  // CodeView.
  return (
    <EditProvider createEditor={createEditor}>
      <button type="button" onClick={toggleEditing}>
        {items[0]?.edit === true ? 'Disable editing' : 'Enable editing'}
      </button>
      <CodeView
        items={items}
        style={codeViewStyle}
        editorOptions={editorOptions}
        getEditStateKey={(item) => \`review:\${item.id}\`}
        onItemEditComplete={commitEdit}
        renderAnnotation={(annotation) => (
          <div>Thread {annotation.metadata.id}</div>
        )}
      />
    </EditProvider>
  );
}`,
  },
  options,
};

export const EDIT_WORKER_POOL_VANILLA_EXAMPLE: PreloadFileOptions<undefined> = {
  file: {
    name: 'editor_worker_pool_vanilla.ts',
    contents: `import { File } from '@pierre/diffs';
import { Editor } from '@pierre/diffs/edit';
import { getOrCreateWorkerPoolSingleton } from '@pierre/diffs/worker';
import { workerFactory } from './utils/workerFactory';

const workerPool = getOrCreateWorkerPoolSingleton({
  poolOptions: { workerFactory },
  highlighterOptions: {
    theme: { dark: 'pierre-dark', light: 'pierre-light' },
    // Optional: pool markup is then already editor-compatible, so entering
    // edit mode skips a one-time re-render of the file.
    useTokenTransformer: true,
  },
});

const fileInstance = new File(
  { theme: { dark: 'pierre-dark', light: 'pierre-light' } },
  workerPool
);
fileInstance.render({
  file: { name: 'example.ts', contents: 'export const x = 1;' },
  containerWrapper: document.body,
});

const editor = new Editor('file');
editor.edit(fileInstance);`,
  },
  options,
};

export const EDIT_WORKER_POOL_REACT_EXAMPLE: PreloadFileOptions<undefined> = {
  file: {
    name: 'editor_worker_pool_react.tsx',
    contents: `'use client';

import type { FileContents } from '@pierre/diffs';
import { Editor, type EditorFactory } from '@pierre/diffs/edit';
import {
  EditProvider,
  File,
  WorkerPoolContextProvider,
} from '@pierre/diffs/react';
import { workerFactory } from '@/utils/workerFactory';

const file: FileContents = {
  name: 'example.ts',
  contents: 'export const x = 1;',
};

const poolOptions = { workerFactory };
const highlighterOptions = {
  theme: { dark: 'pierre-dark', light: 'pierre-light' },
  // Optional: pool markup is then already editor-compatible, so entering
  // edit mode skips a one-time re-render of the file.
  useTokenTransformer: true,
} as const;

const createEditor: EditorFactory = (
  editorType,
  options,
  editStateKey
) => new Editor(editorType, options, editStateKey);

export function EditableFileWithWorkerPool() {
  // This example is self-contained. Apps should usually mount EditProvider near
  // the root so its factory is available to every editable File, diff, and
  // CodeView.
  return (
    <WorkerPoolContextProvider
      poolOptions={poolOptions}
      highlighterOptions={highlighterOptions}
    >
      <EditProvider createEditor={createEditor}>
        <File file={file} edit />
      </EditProvider>
    </WorkerPoolContextProvider>
  );
}`,
  },
  options,
};

export const EDITOR_OPTIONS_TYPE: PreloadFileOptions<undefined> = {
  file: {
    name: 'editor_options_type.ts',
    contents: `import type {
  DiffLineAnnotation,
  File,
  FileContents,
  FileDiff,
  LineAnnotation,
} from '@pierre/diffs';
import {
  Editor,
  type EditorCaret,
  type EditorChangeEvent,
  type EditorType,
  type EditorEditCompleteEvent,
  type EditorInitialState,
  type EditorKeymap,
} from '@pierre/diffs/edit';

interface EditorOptions<
  EType extends EditorType = EditorType,
  LAnnotation = undefined,
  LCaret = undefined
> {
  // Max undo stack entries
  historyMaxEntries?: number;

  // Retain and restore vertical scroll only when this component exclusively owns
  // its scrollable HTMLElement viewport. Captured by the constructor; defaults to false.
  ownsVerticalViewport?: boolean;

  // State to adopt on first attach. Only 'type' is required; omitted
  // fields are initialized from the attached component.
  initialState?: EditorInitialState<EType, LAnnotation>;

  // Custom keymap checked before the default map.
  keymap?: EditorKeymap;

  // Render rounded corners on selection ranges (default: true)
  roundedSelection?: boolean;

  // Highlight matching brackets near the caret (default: true)
  matchBrackets?: boolean;

  // Auto-surround selected text when typing a quote or bracket.
  // Values: 'default' | 'never' | 'brackets' | 'quotes' | 'languageDefined'
  // (default: 'default' — both quotes and brackets)
  autoSurround?: 'default' | 'never' | 'brackets' | 'quotes' | 'languageDefined';

  // Per-language comment tokens for the toggle-comment commands, merged over
  // the built-in defaults ('//' and '/* */'). A null lineComment disables
  // line comments for that language.
  languageCommentConfig?: Record<
    string,
    { lineComment?: string | null; blockComment?: readonly [string, string] }
  >;

  // Show the floating Selection Action popover after a user selection.
  // Programmatic setSelections/setViewState calls do not open it.
  enabledSelectionAction?: boolean;

  // Custom clipboard provider. Recommended in Electron apps — use the native
  // clipboard API: https://www.electronjs.org/docs/latest/api/clipboard
  clipboard?: {
    readText: (type?: string) => Promise<string> | string;
  };

  // Custom Selection Action UI. See Selection Action docs for context shape.
  renderSelectionAction?: (context) => HTMLElement;

  // Render an externally owned caret at its normalized document position.
  renderCaret?: (caret: EditorCaret<LCaret>) => HTMLElement;

  // Fires after attach when the text document is ready
  onAttach?: (
    editor: Editor<EType, LAnnotation, LCaret>,
    fileInstance: EType extends 'file'
      ? File<LAnnotation>
      : FileDiff<LAnnotation>
  ) => void;

  // Editor-centric change stream. Fires after each edit with an
  // EditorChangeEvent carrying the editor, live file (the editable new side for
  // a diff), current lineAnnotations, and normalized text changes. Prefer a
  // component's onEditChange prop/option for per-component handling.
  onChange?: (
    event: EditorChangeEvent<EType, LAnnotation>
  ) => void;

  // Editor-wide completion observer. Receives the same frozen event before the
  // component callback and fires even when that callback is missing. You cannot
  // accept or reject from this callback.
  onComplete?: (
    event: EditorEditCompleteEvent<EType, LAnnotation>
  ) => void;

  // Fires when the editable content area gains focus (tab, click, or editor.focus()).
  onFocus?: () => void;

  // Fires when the editable content area loses focus.
  onBlur?: () => void;
}`,
  },
  options,
};

export const EDIT_ON_ATTACH_REACT_EXAMPLE: PreloadFileOptions<undefined> = {
  file: {
    name: 'editor_on_attach_react.tsx',
    contents: `const editorOptions = useMemo<EditorOptions>(
  () => ({
    onAttach(editor) {
      editor.focus({ lineNumber: 'first-visible', preventScroll: true });
    },
  }),
  []
);

return <CodeView items={items} editorOptions={editorOptions} />;`,
  },
  options,
};

export const EDIT_ON_ATTACH_VANILLA_EXAMPLE: PreloadFileOptions<undefined> = {
  file: {
    name: 'editor_on_attach_vanilla.ts',
    contents: `const viewer = new CodeView({
  createEditor(editorType, options, editStateKey) {
    return new Editor(editorType, {
      ...options,
      onAttach(editor) {
        editor.focus({ lineNumber: 'first-visible', preventScroll: true });
      },
    }, editStateKey);
  },
});`,
  },
  options,
};

export const EDIT_FOCUS_POSITION_EXAMPLE: PreloadFileOptions<undefined> = {
  file: {
    name: 'editor_focus_position.ts',
    contents: `editor.focus({ lineNumber: 13, character: 4 });`,
  },
  options,
};

export const EDIT_ON_CHANGE_EXAMPLE: PreloadFileOptions<undefined> = {
  file: {
    name: 'edit_component_handlers.tsx',
    contents: `import type {
  FileContents,
  FileEditCompleteHandler,
} from '@pierre/diffs';
import { File } from '@pierre/diffs/react';
import { useState } from 'react';

const initialFile: FileContents = {
  name: 'example.ts',
  contents: 'export const answer = 42;',
};

// Render inside the stable EditProvider shown above.
export function EditableFileHandlers() {
  const [file, setFile] = useState(initialFile);

  const handleEditComplete: FileEditCompleteHandler<undefined> = (event) => {
    if (!window.confirm('Keep these changes?')) {
      return 'reject';
    }

    // Keep application state aligned with the value installed by the component.
    setFile(event.file);
    return 'accept';
  };

  return (
    <File
      file={file}
      edit
      onEditChange={(event) => {
        console.log('Current contents:', event.file.contents);
        console.log('Normalized edits:', event.changes);
      }}
      onEditComplete={handleEditComplete}
    />
  );
}`,
  },
  options,
};

export const EDIT_PERSISTED_DRAFT_EXAMPLE: PreloadFileOptions<undefined> = {
  file: {
    name: 'persisted_edit_draft.tsx',
    contents: `import {
  getFiletypeFromFileName,
  type FileContents,
} from '@pierre/diffs';
import {
  TextDocument,
  type Editor,
  type EditorOptions,
  type EditorViewState,
} from '@pierre/diffs/edit';
import { File } from '@pierre/diffs/react';
import { useRef, useState } from 'react';

const storageKey = 'draft:example.ts';
const initialFile: FileContents = {
  name: 'example.ts',
  contents: 'export const answer = 42;',
};

interface PersistedDraft {
  file: FileContents;
  editorState?: EditorViewState;
}

function loadDraft(): PersistedDraft {
  const value = localStorage.getItem(storageKey);
  return value == null
    ? { file: initialFile }
    : (JSON.parse(value) as PersistedDraft);
}

function persistDraft(file: FileContents, editor: Editor<'file'>) {
  const draft: PersistedDraft = {
    file,
    editorState: editor.getViewState(),
  };
  localStorage.setItem(storageKey, JSON.stringify(draft));
}

// Render inside the stable EditProvider shown above.
export function PersistedEditableFile() {
  const [initialDraft] = useState(loadDraft);
  const [file, setFile] = useState(initialDraft.file);
  const [editing, setEditing] = useState(true);
  const editorRef = useRef<Editor<'file'> | null>(null);
  const [editorOptions] = useState<EditorOptions<'file'>>(() => ({
    // Initialize the edit state from the latest version of the file, minus
    // undo history
    initialState: {
      type: 'file',
      document: new TextDocument<'file', undefined>(
        initialDraft.file.name,
        initialDraft.file.contents,
        initialDraft.file.lang ?? getFiletypeFromFileName(initialDraft.file.name)
      ),
      fileInfo: {
        name: initialDraft.file.name,
        lang: initialDraft.file.lang,
      },
      editor: initialDraft.editorState,
    },
    onAttach(editor) {
      editorRef.current = editor;
    },
  }));

  return (
    <>
      <button
        type="button"
        onClick={() => {
          const editor = editorRef.current;
          const currentFile = editor?.getFile();
          if (editor != null && currentFile != null) {
            // Captures the exact document, selections, and scroll position.
            persistDraft(currentFile, editor);
          }
        }}
      >
        Save draft
      </button>
      <button type="button" onClick={() => setEditing(false)}>
        Finish editing
      </button>
      <File
        file={file}
        edit={editing}
        editorOptions={editorOptions}
        onEditChange={(event) => {
          // Save the latest document and state without feeding them back into
          // the component during its active editing session.
          persistDraft(event.file, event.editor);
        }}
        onEditComplete={(event) => {
          // Persist the accepted final file as the next canonical input.
          setFile(event.file);
          persistDraft(event.file, event.editor);
          return 'accept';
        }}
      />
    </>
  );
}`,
  },
  options,
};

export const EDITOR_PUBLIC_API: PreloadFileOptions<undefined> = {
  file: {
    name: 'editor_public_api.ts',
    contents: `import {
  File,
  type FileContents,
} from '@pierre/diffs';
import {
  Editor,
  EditStateManager,
  type EditState,
  type EditorFocusOptions,
  type EditorViewState,
} from '@pierre/diffs/edit';

// Editor
// Most methods require an attached component via edit().

const fileInstance = new File();
fileInstance.render({
  file: { name: 'example.ts', contents: '...' },
  containerWrapper: document.body,
});

const editStateKey = 'review:example.ts';
const editor = new Editor('file', {}, editStateKey);

// Merge partial options at runtime. Existing fields are preserved.
editor.setOptions({
  roundedSelection: false,
});

// This file editor attaches to a rendered File or VirtualizedFile. Create
// an Editor('file-diff', ...) for FileDiff or VirtualizedFileDiff.
// Normalizes conflicting fileInstance options and returns a dispose function.
const dispose = editor.edit(fileInstance);

// Apply text edits to the attached document. Positions are zero-based.
// Edits always join the undo stack, exactly like typed input. The optional
// updateHistory argument defaults to true; false remaps live selections instead
// of restoring snapshots but keeps the text edit undoable.
editor.applyEdits([
  {
    range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
    newText: 'Hello, world!',
  },
]);

// Live FileContents for the current session or queued initialState. Undefined
// when neither exists.
const file: FileContents | undefined = editor.getFile();

// Full document text, or '' when no current session or initialState exists.
const text: string = editor.getText();

// Snapshot selections and scroll positions for explicit restoration:
const state: EditorViewState = editor.getViewState();
// EditorViewState = {
//   selections?: EditorSelection[];
//   view?: { scrollLeft: number; scrollTop?: number };
// }

// Restore selections and scroll positions after re-rendering.
editor.setViewState(state);

// Borrow the complete live document, history, and editor-state checkpoint. This is
// available only while a complete edit session exists.
const editState: EditState<'file', undefined> | undefined = editor.getEditState();

// Replace all cursors and ranges programmatically. Positions are zero-based;
// direction controls which end the caret uses for keyboard extension.
editor.setSelections([
  {
    start: { line: 0, character: 2 },
    end: { line: 0, character: 8 },
    direction: 'forward', // 'forward' | 'backward' | 'none'
  },
]);

// Replace all externally owned carets and highlighted ranges. Pass [] to clear.
// Configure their elements with EditorOptions.renderCaret.
editor.setCarets([]);

// Show inline diagnostic markers. Pass [] to clear. Throws if not attached.
editor.setMarkers([
  {
    start: { line: 1, character: 2 },
    end: { line: 1, character: 8 },
    severity: 'error', // 'error' | 'warning' | 'info' | 'hint'
    message: { html: 'Some lint message' },
    source: 'eslint',
  },
]);
editor.setMarkers([]);

// Focus the editable content. preventScroll skips scrolling the caret into view.
// Blur removes focus from the content area.
editor.focus();
editor.focus({ preventScroll: true });

// Numeric line numbers are one-based; character offsets are zero-based.
editor.focus({ lineNumber: 13, character: 4 });

// Target the first editable row whose top is visible. offset adds a
// non-negative CSS-pixel inset below the viewport or sticky file header.
const focusOptions: EditorFocusOptions = {
  lineNumber: 'first-visible',
  offset: 8,
  preventScroll: true,
};
editor.focus(focusOptions);
editor.blur();

// Whether there is an edit to undo or redo.
editor.canUndo;
editor.canRedo;

// Undo the last edit or redo the last undone edit. No-ops when history is empty.
editor.undo();
editor.redo();

// End the session through the disposer returned by edit(). It detaches the
// editor, then runs the component's onEditComplete accept/reject boundary.
dispose();

// cleanUp('discard') also runs completion, but never installs the result.
// Virtualized hosts use cleanUp('recycle') for temporary remounts.

// Inspect complete active or inactive state without changing LRU recency.
EditStateManager.get('file', editStateKey);

// Clear a complete inactive session, or keep its draft while resetting selected
// parts. Active sessions are never mutated by manager clearing.
EditStateManager.clear('file', editStateKey);
EditStateManager.clear('file', editStateKey, { history: true });
EditStateManager.clear('file', editStateKey, { selections: true });
EditStateManager.clear('file', editStateKey, { view: true });
EditStateManager.clear('file', editStateKey, { editor: true });

// Clear all inactive state, or change each namespace's retained-state capacity.
EditStateManager.clearAll();
EditStateManager.setCapacity(50);
`,
  },
  options,
};

export const EDIT_REACT_MULTI_FILE_DIFF_EXAMPLE: PreloadFileOptions<undefined> =
  {
    file: {
      name: 'editor_react_multi_file_diff.tsx',
      contents: `import type {
  FileContents,
  FileDiffEditCompleteHandler,
  FileDiffOptions,
} from '@pierre/diffs';
import { Editor, type EditorFactory } from '@pierre/diffs/edit';
import {
  EditProvider,
  MultiFileDiff,
  Virtualizer,
} from '@pierre/diffs/react';
import { useCallback, useRef, useState } from 'react';

// Keep file objects stable: define static inputs at module scope, or use
// useState/useMemo when they depend on component values.
const initialOldFile: FileContents = {
  name: 'example.ts',
  contents: 'console.log("Hello world")',
};

const initialNewFile: FileContents = {
  name: 'example.ts',
  contents: 'console.warn("Updated message")',
};

const fileDiffOptions: FileDiffOptions<undefined> = {
  theme: { dark: 'pierre-dark', light: 'pierre-light' },
};

const virtualizerStyle = {
  maxHeight: '16rem',
  overflow: 'auto',
  borderRadius: '0.5rem',
} as const;

const createEditor: EditorFactory = (
  editorType,
  options,
  editStateKey
) => new Editor(editorType, options, editStateKey);

export function EditableMultiFileDiff() {
  const [oldFile, setOldFile] = useState(initialOldFile);
  const [newFile, setNewFile] = useState(initialNewFile);
  const [editing, setEditing] = useState(false);
  const cancelled = useRef(false);
  const version = useRef(0);

  // MultiFileDiff parses its diff from the file pair. Adopt the completed files
  // into state (re-keyed) — MultiFileDiff reuses the accepted diff once the
  // props catch up — then return 'accept'; return 'reject' to revert.
  const handleEditComplete = useCallback<
    FileDiffEditCompleteHandler<undefined>
  >(
    (event) => {
      if (cancelled.current) {
        cancelled.current = false;
        return 'reject';
      }
      version.current += 1;
      if (event.oldFile != null) {
        event.oldFile.cacheKey = 'old:v' + version.current;
        setOldFile(event.oldFile);
      }
      if (event.newFile != null) {
        event.newFile.cacheKey = 'new:v' + version.current;
        setNewFile(event.newFile);
      }
      return 'accept';
    },
    []
  );

  // This example is self-contained. Apps should usually mount EditProvider near
  // the root so its factory is available to every editable File, diff, and
  // CodeView.
  return (
    <EditProvider createEditor={createEditor}>
      {editing ? (
        <>
          <button
            type="button"
            onClick={() => {
              cancelled.current = true;
              setEditing(false);
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => {
              cancelled.current = false;
              setEditing(false);
            }}
          >
            Save
          </button>
        </>
      ) : (
        <button
          type="button"
          onClick={() => {
            cancelled.current = false;
            setEditing(true);
          }}
        >
          Edit
        </button>
      )}
      <Virtualizer style={virtualizerStyle}>
        <MultiFileDiff
          oldFile={oldFile}
          newFile={newFile}
          options={fileDiffOptions}
          edit={editing}
          onEditComplete={handleEditComplete}
        />
      </Virtualizer>
    </EditProvider>
  );
}`,
    },
    options,
  };
