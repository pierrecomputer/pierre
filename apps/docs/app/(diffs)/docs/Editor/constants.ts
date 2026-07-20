import type { FileOptions } from '@pierre/diffs/react';
import type { PreloadFileOptions } from '@pierre/diffs/ssr';

import { CustomScrollbarCSS } from '@/components/CustomScrollbarCSS';

const options = {
  theme: { dark: 'pierre-dark', light: 'pierre-light' },
  disableFileHeader: true,
  unsafeCSS: CustomScrollbarCSS,
} as const;

// The editor requires the token transformer, so enabling it in the server
// render keeps hydration from rerendering the surface after the editor
// attaches. Mirrors `(diffs)/_edit/constants.ts`.
const editableDemoOptions: FileOptions<undefined> = {
  theme: { dark: 'pierre-dark', light: 'pierre-light' },
  disableFileHeader: true,
  useTokenTransformer: true,
};

// The file rendered by the interactive `<EditorDemo />` on the Editor page.
// Preloaded server-side so the surface is highlighted in the initial HTML
// instead of flashing in after the client attaches the editor.
export const EDITOR_DEMO_FILE_EXAMPLE: PreloadFileOptions<undefined> = {
  file: {
    name: 'editable-demo.ts',
    contents: `import { VirtualizedFile } from '@pierre/diffs';
import { Editor } from '@pierre/diffs/editor';

const fileInstance = new VirtualizedFile({
  theme: { dark: 'pierre-dark', light: 'pierre-light' },
});

// render the file into a DOM container
fileInstance.render({
  file: { name: 'index.ts', contents: 'export const foo: string = "bar";\\n' },
  containerWrapper: document.getElementById('file-container')
});

const editor = new Editor({
  onChange(file, lineAnnotations) {
    console.log('change', file.name, lineAnnotations);
  },
});

// Attach the editor to the file instance
const dispose = editor.edit(fileInstance);

// Later, when the editor is no longer needed:
dispose();
`,
  },
  options: editableDemoOptions,
};

export const EDITOR_VANILLA_FILE_EXAMPLE: PreloadFileOptions<undefined> = {
  file: {
    name: 'editor_vanilla_file.ts',
    contents: `import {
  Virtualizer,
  VirtualizedFile,
  type FileContents,
} from '@pierre/diffs';
import { Editor } from '@pierre/diffs/editor';

const root = document.getElementById('file-scroll-root');
const content = document.getElementById('file-scroll-content');
if (root == null || content == null) {
  throw new Error('Expected virtualized file containers to exist');
}

const file: FileContents = {
  name: 'example.ts',
  contents: 'export function greet(name: string) {\\n  return name;\\n}',
};

const virtualizer = new Virtualizer();
virtualizer.setup(root, content);

const fileInstance = new VirtualizedFile(
  { theme: { dark: 'pierre-dark', light: 'pierre-light' } },
  virtualizer
);
fileInstance.render({ file, containerWrapper: content });

const editor = new Editor({
  onChange(file, lineAnnotations) {
    console.log('change', file.name, lineAnnotations);
  },
});

editor.edit(fileInstance);

// Update the file, editor retains to work with the new file
const newFile: FileContents = { ... }
fileInstance.render({ file: newFile });

// Later, when the editor is no longer needed:
editor.cleanUp();`,
  },
  options,
};

export const EDITOR_VANILLA_FILE_DIFF_EXAMPLE: PreloadFileOptions<undefined> = {
  file: {
    name: 'editor_vanilla_file_diff.ts',
    contents: `import {
  Virtualizer,
  VirtualizedFileDiff,
  type FileContents,
} from '@pierre/diffs';
import { Editor } from '@pierre/diffs/editor';

const root = document.getElementById('diff-scroll-root');
const content = document.getElementById('diff-scroll-content');
if (root == null || content == null) {
  throw new Error('Expected virtualized diff containers to exist');
}

const oldFile: FileContents = {
  name: 'example.ts',
  contents: 'export function greet(name: string) {\\n  return name;\\n}',
};

const newFile: FileContents = {
  ...oldFile,
  contents:
    'export function greet(name: string) {\\n  return "Hello, " + name;\\n}',
};

const virtualizer = new Virtualizer();
virtualizer.setup(root, content);

const fileDiffInstance = new VirtualizedFileDiff(
  { theme: { dark: 'pierre-dark', light: 'pierre-light' } },
  virtualizer
);
fileDiffInstance.render({ oldFile, newFile, containerWrapper: content });

const editor = new Editor({
  onChange(file, lineAnnotations) {
    console.log('change', file.name, lineAnnotations);
  },
});

editor.edit(fileDiffInstance);

// Update the file, editor retains to work with the new file
const newFile: FileContents = { ... }
fileInstance.render({ file: newFile });

// Later, when the editor is no longer needed:
editor.cleanUp();`,
  },
  options,
};

export const EDITOR_VANILLA_CODE_VIEW_EXAMPLE: PreloadFileOptions<undefined> = {
  file: {
    name: 'editor_vanilla_code_view.ts',
    contents: `import { CodeView, type CodeViewItem } from '@pierre/diffs';
import { Editor } from '@pierre/diffs/editor';

const root = document.getElementById('code-view');
const toggleButton = document.getElementById('toggle-editing');
if (root == null || toggleButton == null) {
  throw new Error('Expected CodeView containers to exist');
}

root.style.height = '24rem';
root.style.overflow = 'auto';

const viewer = new CodeView({
  theme: { dark: 'pierre-dark', light: 'pierre-light' },
  createEditor(options) {
    return new Editor(options);
  },
  onItemEditComplete(item, file) {
    if (item.type !== 'file') {
      return;
    }
    const version = (item.version ?? 0) + 1;
    viewer.updateItem({
      ...item,
      edit: false,
      version,
      file: {
        ...item.file,
        contents: file.contents,
        cacheKey: \`\${item.id}:v\${version}\`,
      },
    });
  },
});

viewer.setup(root);

const item: CodeViewItem = {
  id: 'example.ts',
  type: 'file',
  file: {
    name: 'example.ts',
    contents: 'export const answer = 42;',
  },
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

export const EDITOR_LAZY_FILE_EXAMPLE: PreloadFileOptions<undefined> = {
  file: {
    name: 'editor_lazy_file.ts',
    contents: `import type { VirtualizedFile } from '@pierre/diffs';

const button = document.getElementById('edit-button');

async function edit(fileInstance: VirtualizedFile): Promise<() => void> {
  const { Editor } = await import('@pierre/diffs/editor');
  const editor = new Editor({
    onChange(file, lineAnnotations) {
      console.log('change', file.name, lineAnnotations);
    },
  });
  return editor.edit(fileInstance);
}

// Click to edit and lazy-load the editor bundle only when it is needed.
button.addEventListener('click', () => {
  void edit(fileInstance);
});`,
  },
  options,
};

export const EDITOR_SELECTION_ACTION_EXAMPLE: PreloadFileOptions<undefined> = {
  file: {
    name: 'editor_selection_action.ts',
    contents: `import { Editor } from '@pierre/diffs/editor';

const editor = new Editor({
  enabledSelectionAction: true,
  // The popover appears automatically on selection (no icon, no extra click).
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

export const EDITOR_SELECTION_ACTION_CONTEXT_TYPE: PreloadFileOptions<undefined> =
  {
    file: {
      name: 'selection_action_context.ts',
      contents: `export interface SelectionActionContext<LAnnotation> {
  /** The current selection. */
  selection: EditorSelection;
  /** The text document. */
  textDocument: TextDocument<LAnnotation>;
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

export const EDITOR_MARKER_TYPE: PreloadFileOptions<undefined> = {
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

export const EDITOR_MARKER_EXAMPLE: PreloadFileOptions<undefined> = {
  file: {
    name: 'editor_markers.ts',
    contents: `import { Editor } from '@pierre/diffs/editor';

const editor = new Editor();
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

export const EDITOR_UNDO_REDO_EXAMPLE: PreloadFileOptions<undefined> = {
  file: {
    name: 'editor_undo_redo.tsx',
    contents: `import type { FileContents } from '@pierre/diffs';
import { Editor, type EditorOptions } from '@pierre/diffs/editor';
import { EditProvider, File } from '@pierre/diffs/react';
import { useMemo, useRef, useState } from 'react';

const file: FileContents = {
  name: 'example.ts',
  contents: 'export const x = 1;',
};

function createEditor(options: EditorOptions<undefined>) {
  return new Editor(options);
}

export function EditorWithHistoryToolbar() {
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  const editorRef = useRef<Editor<undefined> | null>(null);
  const editOptions = useMemo<EditorOptions<undefined>>(
    () => ({
      onAttach(editor) {
        editorRef.current = editor;
      },
      onChange() {
        // Undo and redo run through the same change path as edits, so refresh
        // toolbar state from \`onChange\` rather than only after button clicks.
        setCanUndo(editorRef.current?.canUndo ?? false);
        setCanRedo(editorRef.current?.canRedo ?? false);
      },
    }),
    []
  );

  // This example is self-contained. Apps should usually mount EditProvider near
  // the root so its factory is available to every editable File, diff, and
  // CodeView.
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
        editOptions={editOptions}
      />
    </EditProvider>
  );
}`,
  },
  options,
};

export const EDITOR_REACT_EXAMPLE: PreloadFileOptions<undefined> = {
  file: {
    name: 'editor_react.tsx',
    contents: `import type { FileContents, FileOptions } from '@pierre/diffs';
import { Editor, type EditorOptions } from '@pierre/diffs/editor';
import { EditProvider, File, Virtualizer } from '@pierre/diffs/react';
import { useMemo, useState } from 'react';

const file: FileContents = {
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

function createEditor(options: EditorOptions<undefined>) {
  return new Editor(options);
}

export function EditorComponent() {
  const [editable, setEditable] = useState(true);
  const editOptions = useMemo<EditorOptions<undefined>>(
    () => ({
      onChange(file, lineAnnotations) {
        console.log('change', file.name, lineAnnotations);
      },
    }),
    []
  );

  // This example is self-contained. Apps should usually mount EditProvider near
  // the root so its factory is available to every editable File, diff, and
  // CodeView.
  return (
    <EditProvider createEditor={createEditor}>
      <button type="button" onClick={() => setEditable((value) => !value)}>
        {editable ? 'Disable editing' : 'Enable editing'}
      </button>

      <Virtualizer style={virtualizerStyle}>
        <File
          file={file}
          options={fileOptions}
          edit={editable}
          editOptions={editOptions}
        />
      </Virtualizer>
    </EditProvider>
  );
}`,
  },
  options,
};

export const EDITOR_REACT_FILE_DIFF_EXAMPLE: PreloadFileOptions<undefined> = {
  file: {
    name: 'editor_react_file_diff.tsx',
    contents: `import {
  parseDiffFromFile,
  type FileDiffMetadata,
  type FileDiffOptions,
} from '@pierre/diffs';
import { Editor, type EditorOptions } from '@pierre/diffs/editor';
import {
  EditProvider,
  FileDiff,
  Virtualizer,
} from '@pierre/diffs/react';
import { useMemo, useState } from 'react';

// FileDiff takes a pre-parsed FileDiffMetadata object.
const fileDiff: FileDiffMetadata = parseDiffFromFile(
  { name: 'example.ts', contents: 'console.log("Hello world")' },
  { name: 'example.ts', contents: 'console.warn("Updated message")' }
);

const fileDiffOptions: FileDiffOptions<undefined> = {
  theme: { dark: 'pierre-dark', light: 'pierre-light' },
};

const virtualizerStyle = {
  maxHeight: '16rem',
  overflow: 'auto',
  borderRadius: '0.5rem',
} as const;

function createEditor(options: EditorOptions<undefined>) {
  return new Editor(options);
}

export function EditorComponent() {
  const [editable, setEditable] = useState(true);
  const editOptions = useMemo<EditorOptions<undefined>>(
    () => ({
      onChange(file, lineAnnotations) {
        console.log('change', file.name, lineAnnotations);
      },
    }),
    []
  );

  // This example is self-contained. Apps should usually mount EditProvider near
  // the root so its factory is available to every editable File, diff, and
  // CodeView.
  return (
    <EditProvider createEditor={createEditor}>
      <button type="button" onClick={() => setEditable((value) => !value)}>
        {editable ? 'Disable editing' : 'Enable editing'}
      </button>
      <Virtualizer style={virtualizerStyle}>
        <FileDiff
          fileDiff={fileDiff}
          options={fileDiffOptions}
          edit={editable}
          editOptions={editOptions}
        />
      </Virtualizer>
    </EditProvider>
  );
}`,
  },
  options,
};

export const EDITOR_REACT_CODE_VIEW_EXAMPLE: PreloadFileOptions<undefined> = {
  file: {
    name: 'editor_react_code_view.tsx',
    contents: `import type {
  CodeViewItem,
  FileContents,
} from '@pierre/diffs';
import { Editor, type EditorOptions } from '@pierre/diffs/editor';
import { CodeView, EditProvider } from '@pierre/diffs/react';
import { useCallback, useState } from 'react';

const initialItems: CodeViewItem[] = [
  {
    id: 'example.ts',
    type: 'file',
    file: {
      name: 'example.ts',
      contents: 'export const answer = 42;',
    },
    edit: true,
    version: 0,
  },
];

const codeViewStyle = { height: '24rem', overflow: 'auto' } as const;

function createEditor(options: EditorOptions<undefined>) {
  return new Editor(options);
}

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

  const commitEdit = useCallback((item: CodeViewItem, file: FileContents) => {
    setItems((current) =>
      current.map((existing) => {
        if (existing.id !== item.id || existing.type !== 'file') {
          return existing;
        }
        const version = (existing.version ?? 0) + 1;
        return {
          ...existing,
          edit: false,
          version,
          file: {
            ...existing.file,
            contents: file.contents,
            cacheKey: \`\${existing.id}:v\${version}\`,
          },
        };
      })
    );
  }, []);

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
        onItemEditComplete={commitEdit}
      />
    </EditProvider>
  );
}`,
  },
  options,
};

export const EDITOR_WORKER_POOL_VANILLA_EXAMPLE: PreloadFileOptions<undefined> =
  {
    file: {
      name: 'editor_worker_pool_vanilla.ts',
      contents: `import { File } from '@pierre/diffs';
import { Editor } from '@pierre/diffs/editor';
import { getOrCreateWorkerPoolSingleton } from '@pierre/diffs/worker';
import { workerFactory } from './utils/workerFactory';

const workerPool = getOrCreateWorkerPoolSingleton({
  poolOptions: { workerFactory },
  highlighterOptions: {
    theme: { dark: 'pierre-dark', light: 'pierre-light' },
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

const editor = new Editor();
editor.edit(fileInstance);`,
    },
    options,
  };

export const EDITOR_WORKER_POOL_REACT_EXAMPLE: PreloadFileOptions<undefined> = {
  file: {
    name: 'editor_worker_pool_react.tsx',
    contents: `'use client';

import type { FileContents } from '@pierre/diffs';
import { Editor, type EditorOptions } from '@pierre/diffs/editor';
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
  useTokenTransformer: true,
} as const;

function createEditor(options: EditorOptions<undefined>) {
  return new Editor(options);
}

export function EditorWithWorkerPool() {
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
  DiffsEditableComponent,
  FileContents,
} from '@pierre/diffs';
import { Editor, type IStateStorage } from '@pierre/diffs/editor';

interface EditorOptions<LAnnotation> {
  // Max undo stack entries
  historyMaxEntries?: number;

  // Preserve each File's document and editor state between renders.
  // Requires every editable file to provide a unique, stable cacheKey.
  // Default: false.
  persistState?: boolean;

  // Where serializable editor state is stored. Text documents and undo
  // history remain in this Editor instance's in-memory cache.
  // Defaults to 'inMemory' when persistState is enabled.
  persistStateStorage?: 'inMemory' | 'indexedDB' | IStateStorage;

  // Render rounded corners on selection ranges (default: true)
  roundedSelection?: boolean;

  // Highlight matching brackets near the caret (default: true)
  matchBrackets?: boolean;

  // Auto-surround selected text when typing a quote or bracket.
  // Values: 'default' | 'never' | 'brackets' | 'quotes' | 'languageDefined'
  // (default: 'default' — both quotes and brackets)
  autoSurround?: 'default' | 'never' | 'brackets' | 'quotes' | 'languageDefined';

  // Show the floating Selection Action popover on selection (default: false)
  enabledSelectionAction?: boolean;

  // Custom clipboard provider.
  // Highly recommended to use native clipboard API if you are building an electron app.
  // see https://www.electronjs.org/docs/latest/api/clipboard
  clipboard?: {
    readText: () => Promise<string> | string;
  };

  // Custom Selection Action UI. See Selection Action docs for context shape.
  renderSelectionAction?: (context) => HTMLElement;

  // Fires after attach when the text document is ready
  onAttach?: (
    editor: Editor<LAnnotation>,
    fileInstance: DiffsEditableComponent<LAnnotation>
  ) => void;

  // Fires after each edit. file.contents reflects the live document.
  onChange?: (
    file: FileContents,
    lineAnnotations?: DiffLineAnnotation<LAnnotation>[]
  ) => void;

  // Fires when the editable content area gains focus (tab, click, or editor.focus()).
  onFocus?: () => void;

  // Fires when the editable content area loses focus.
  onBlur?: () => void;
}`,
  },
  options,
};

export const EDITOR_PUBLIC_API: PreloadFileOptions<undefined> = {
  file: {
    name: 'editor_public_api.ts',
    contents: `import type {
  EditorState,
  FileContents,
} from '@pierre/diffs';
import { Editor } from '@pierre/diffs/editor';

// Editor
// Most methods require an attached surface via edit().

const editor = new Editor();

// attach to a rendered File, FileDiff, or virtualized variant.
const dispose = editor.edit(fileInstance);

// Merge partial options at runtime. Existing fields are preserved.
// onChange and similar handlers read from the latest options on each call;
// pass onFocus/onBlur before edit() attaches, or set them in the constructor.
editor.setOptions({
  onChange(file, lineAnnotations) {
    console.log('change', file.name, lineAnnotations);
  },
});

// Attach to a rendered File, FileDiff, or virtualized variant.
// Normalizes conflicting fileInstance options and returns a dispose function.
const dispose = editor.edit(fileInstance);

// Detach, remove listeners, and clean up injected editor DOM.
// Pass recycle=true when a virtualized host is temporarily unmounting.
editor.cleanUp();
editor.cleanUp(true);

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

// Live FileContents for the attached document. Undefined when nothing is
// attached.
const file: FileContents | undefined = editor.getFile();

// Full document text, or '' when nothing is attached.
const text: string = editor.getText();

// Snapshot selections and scroll position for persistence or remount restore.
const state: EditorState = editor.getState();
// EditorState = {
//   selections?: EditorSelection[];
//   view?: { scrollLeft: number; scrollTop: number };
// }

// Restore selections and scroll after re-rendering the underlying component.
editor.setState(state);

// Replace all cursors and ranges programmatically. Positions are zero-based;
// direction controls which end the caret uses for keyboard extension.
editor.setSelections([
  {
    start: { line: 0, character: 2 },
    end: { line: 0, character: 8 },
    direction: 'forward', // 'forward' | 'backward' | 'none'
  },
]);

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
editor.blur();

// Whether there is an edit to undo or redo.
editor.canUndo;
editor.canRedo;

// Undo the last edit or redo the last undone edit. No-ops when history is empty.
editor.undo();
editor.redo();
`,
  },
  options,
};

export const EDITOR_REACT_MULTI_FILE_DIFF_EXAMPLE: PreloadFileOptions<undefined> =
  {
    file: {
      name: 'editor_react_multi_file_diff.tsx',
      contents: `import type {
  FileContents,
  FileDiffOptions,
} from '@pierre/diffs';
import { Editor, type EditorOptions } from '@pierre/diffs/editor';
import {
  EditProvider,
  MultiFileDiff,
  Virtualizer,
} from '@pierre/diffs/react';
import { useMemo, useState } from 'react';

// Keep file objects stable: define static inputs at module scope, or use
// useState/useMemo when they depend on component values.
const oldFile: FileContents = {
  name: 'example.ts',
  contents: 'console.log("Hello world")',
};

const newFile: FileContents = {
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

function createEditor(options: EditorOptions<undefined>) {
  return new Editor(options);
}

export function EditorComponent() {
  const [editable, setEditable] = useState(true);
  const editOptions = useMemo<EditorOptions<undefined>>(
    () => ({
      onChange(file, lineAnnotations) {
        console.log('change', file.name, lineAnnotations);
      },
    }),
    []
  );

  // This example is self-contained. Apps should usually mount EditProvider near
  // the root so its factory is available to every editable File, diff, and
  // CodeView.
  return (
    <EditProvider createEditor={createEditor}>
      <button type="button" onClick={() => setEditable((value) => !value)}>
        {editable ? 'Disable editing' : 'Enable editing'}
      </button>
      <Virtualizer style={virtualizerStyle}>
        <MultiFileDiff
          oldFile={oldFile}
          newFile={newFile}
          options={fileDiffOptions}
          edit={editable}
          editOptions={editOptions}
        />
      </Virtualizer>
    </EditProvider>
  );
}`,
    },
    options,
  };
