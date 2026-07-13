import type { FileOptions } from '@pierre/diffs/react';
import type { PreloadFileOptions } from '@pierre/diffs/ssr';

import { CustomScrollbarCSS } from '@/components/CustomScrollbarCSS';

const options = {
  theme: { dark: 'pierre-dark', light: 'pierre-light' },
  disableFileHeader: true,
  unsafeCSS: CustomScrollbarCSS,
} as const;

// Options for the live editable demo below. They mirror the state the edit
// enforces when it attaches in `contentEditable` mode (token transformer on;
// gutter, line selection, and line hover off), so the server-rendered HTML
// matches the edit's post-attach client render and hydrating from
// `prerenderedHTML` neither flashes nor re-highlights. Mirrors
// `(diffs)/_edit/constants.ts`.
const editableDemoOptions: FileOptions<undefined> = {
  theme: { dark: 'pierre-dark', light: 'pierre-light' },
  disableFileHeader: true,
  useTokenTransformer: true,
  enableGutterUtility: false,
  enableLineSelection: false,
  lineHoverHighlight: 'disabled',
};

// The file rendered by the interactive `<EditDemo />` on the Edit page.
// Preloaded server-side so the surface is highlighted in the initial HTML
// instead of flashing in after the client attaches the edit.
export const EDIT_DEMO_FILE_EXAMPLE: PreloadFileOptions<undefined> = {
  file: {
    name: 'editable-demo.ts',
    contents: `import { VirtualizedFile } from '@pierre/diffs';
import { Edit } from '@pierre/diffs/edit';

const fileInstance = new VirtualizedFile({
  theme: { dark: 'pierre-dark', light: 'pierre-light' },
});

// render the file into a DOM container
fileInstance.render({
  file: { name: 'index.ts', contents: 'export const foo: string = "bar";\\n' },
  containerWrapper: document.getElementById('file-container')
});

const edit = new Edit({
  onChange(file, lineAnnotations) {
    console.log('change', file.name, lineAnnotations);
  },
});

// Attach the edit to the file instance
const dispose = edit.edit(fileInstance);

// Later, when the edit is no longer needed:
dispose();
`,
  },
  options: editableDemoOptions,
};

export const EDIT_VANILLA_FILE_EXAMPLE: PreloadFileOptions<undefined> = {
  file: {
    name: 'editor_vanilla_file.ts',
    contents: `import {
  Virtualizer,
  VirtualizedFile,
  type FileContents,
} from '@pierre/diffs';
import { Edit } from '@pierre/diffs/edit';

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

const edit = new Edit({
  onChange(file, lineAnnotations) {
    console.log('change', file.name, lineAnnotations);
  },
});

edit.edit(fileInstance);

// Update the file, edit retains to work with the new file
const newFile: FileContents = { ... }
fileInstance.render({ file: newFile });

// Later, when the edit is no longer needed:
edit.cleanUp();`,
  },
  options,
};

export const EDIT_VANILLA_FILE_DIFF_EXAMPLE: PreloadFileOptions<undefined> = {
  file: {
    name: 'editor_vanilla_file_diff.ts',
    contents: `import {
  Virtualizer,
  VirtualizedFileDiff,
  type FileContents,
} from '@pierre/diffs';
import { Edit } from '@pierre/diffs/edit';

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

const edit = new Edit({
  onChange(file, lineAnnotations) {
    console.log('change', file.name, lineAnnotations);
  },
});

edit.edit(fileDiffInstance);

// Update the file, edit retains to work with the new file
const newFile: FileContents = { ... }
fileInstance.render({ file: newFile });

// Later, when the edit is no longer needed:
edit.cleanUp();`,
  },
  options,
};

export const EDIT_VANILLA_CODE_VIEW_EXAMPLE: PreloadFileOptions<undefined> = {
  file: {
    name: 'editor_vanilla_code_view.ts',
    contents: `import { CodeView, type CodeViewItem } from '@pierre/diffs';
import { Edit } from '@pierre/diffs/edit';

const root = document.getElementById('code-view');
const toggleButton = document.getElementById('toggle-editing');
if (root == null || toggleButton == null) {
  throw new Error('Expected CodeView containers to exist');
}

root.style.height = '24rem';
root.style.overflow = 'auto';

const viewer = new CodeView({
  theme: { dark: 'pierre-dark', light: 'pierre-light' },
  createEdit(options) {
    return new Edit(options);
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

export const EDIT_LAZY_FILE_EXAMPLE: PreloadFileOptions<undefined> = {
  file: {
    name: 'editor_lazy_file.ts',
    contents: `import type { VirtualizedFile } from '@pierre/diffs';

const button = document.getElementById('edit-button');

async function edit(fileInstance: VirtualizedFile): Promise<() => void> {
  const { Edit } = await import('@pierre/diffs/edit');
  const edit = new Edit({
    onChange(file, lineAnnotations) {
      console.log('change', file.name, lineAnnotations);
    },
  });
  return edit.edit(fileInstance);
}

// Click to edit and lazy-load the edit bundle only when it is needed.
button.addEventListener('click', () => {
  void edit(fileInstance);
});`,
  },
  options,
};

export const EDIT_SELECTION_ACTION_EXAMPLE: PreloadFileOptions<undefined> = {
  file: {
    name: 'editor_selection_action.ts',
    contents: `import { Edit } from '@pierre/diffs/edit';

const edit = new Edit({
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

export const EDIT_SELECTION_ACTION_CONTEXT_TYPE: PreloadFileOptions<undefined> =
  {
    file: {
      name: 'selection_action_context.ts',
      contents: `export interface SelectionActionContext<LAnnotation> {
  /** The current selection. */
  selection: EditSelection;
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
    contents: `import { Edit } from '@pierre/diffs/edit';

const edit = new Edit();
edit.edit(fileInstance);

// Apply diagnostics, e.g. from a linter or language server. Inlining the array
// lets TypeScript check the severity literals against the Marker type without
// importing it (the type is reached through edit.setMarkers).
edit.setMarkers([
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
edit.setMarkers([]);`,
  },
  options,
};

export const EDIT_UNDO_REDO_EXAMPLE: PreloadFileOptions<undefined> = {
  file: {
    name: 'editor_undo_redo.tsx',
    contents: `import { Edit } from '@pierre/diffs/edit';
import { EditProvider, File } from '@pierre/diffs/react';
import { useMemo, useState } from 'react';

export function EditWithHistoryToolbar() {
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  const edit = useMemo(
    () =>
      new Edit({
        onChange() {
          // Undo and redo run through the same change path as edits, so refresh
          // toolbar state from \`onChange\` rather than only after button clicks.
          setCanUndo(edit.canUndo);
          setCanRedo(edit.canRedo);
        },
      }),
    []
  );

  return (
    <EditProvider edit={edit}>
      <div className="toolbar">
        <button type="button" disabled={!canUndo} onClick={() => edit.undo()}>
          Undo
        </button>
        <button type="button" disabled={!canRedo} onClick={() => edit.redo()}>
          Redo
        </button>
      </div>

      <File
        file={{ name: 'example.ts', contents: 'export const x = 1;' }}
        contentEditable
      />
    </EditProvider>
  );
}`,
  },
  options,
};

export const EDIT_REACT_EXAMPLE: PreloadFileOptions<undefined> = {
  file: {
    name: 'editor_react.tsx',
    contents: `import type { FileContents } from '@pierre/diffs';
import { Edit } from '@pierre/diffs/edit';
import { EditProvider, File, Virtualizer } from '@pierre/diffs/react';
import { useMemo, useState } from 'react';

const file: FileContents = {
  name: 'example.ts',
  contents: \`function greet(name: string) {
  console.log(\\\`Hello, \\\${name}!\\\`);
}

export { greet };\`,
};

export function EditComponent() {
  const [editable, setEditable] = useState(true);
  const edit = useMemo(
    () =>
      new Edit({
        onChange(file, lineAnnotations) {
          console.log('change', file.name, lineAnnotations);
        },
      }),
    []
  );

  return (
    <EditProvider edit={edit}>
      <button type="button" onClick={() => setEditable((value) => !value)}>
        {editable ? 'Disable editing' : 'Enable editing'}
      </button>

      <Virtualizer
        style={{
          maxHeight: '16rem',
          overflow: 'auto',
          borderRadius: '0.5rem',
        }}
      >
        <File
          file={file}
          options={{
            theme: { dark: 'pierre-dark', light: 'pierre-light' },
          }}
          contentEditable={editable}
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
    contents: `import { Edit } from '@pierre/diffs/edit';
import {
  type FileDiffMetadata,
  EditProvider,
  FileDiff,
  parseDiffFromFile,
  Virtualizer,
} from '@pierre/diffs/react';
import { useMemo, useState } from 'react';

// FileDiff takes a pre-parsed FileDiffMetadata object.
const fileDiff: FileDiffMetadata = parseDiffFromFile(
  { name: 'example.ts', contents: 'console.log("Hello world")' },
  { name: 'example.ts', contents: 'console.warn("Updated message")' }
);

export function EditComponent() {
  const [editable, setEditable] = useState(true);
  const edit = useMemo(
    () =>
      new Edit({
        onChange(file, lineAnnotations) {
          console.log('change', file.name, lineAnnotations);
        },
      }),
    []
  );

  return (
    <EditProvider edit={edit}>
      <button type="button" onClick={() => setEditable((value) => !value)}>
        {editable ? 'Disable editing' : 'Enable editing'}
      </button>

      <Virtualizer
        style={{
          maxHeight: '16rem',
          overflow: 'auto',
          borderRadius: '0.5rem',
        }}
      >
        <FileDiff
          fileDiff={fileDiff}
          options={{
            theme: { dark: 'pierre-dark', light: 'pierre-light' },
          }}
          contentEditable={editable}
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
    contents: `import type { CodeViewItem, FileContents } from '@pierre/diffs';
import { Edit } from '@pierre/diffs/edit';
import { CodeView } from '@pierre/diffs/react';
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

  return (
    <>
      <button type="button" onClick={toggleEditing}>
        {items[0]?.edit === true ? 'Disable editing' : 'Enable editing'}
      </button>

      <CodeView
        items={items}
        style={{ height: '24rem', overflow: 'auto' }}
        createEdit={(options) => new Edit(options)}
        onItemEditComplete={commitEdit}
      />
    </>
  );
}`,
  },
  options,
};

export const EDIT_WORKER_POOL_VANILLA_EXAMPLE: PreloadFileOptions<undefined> = {
  file: {
    name: 'editor_worker_pool_vanilla.ts',
    contents: `import { File } from '@pierre/diffs';
import { Edit } from '@pierre/diffs/edit';
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

const edit = new Edit();
edit.edit(fileInstance);`,
  },
  options,
};

export const EDIT_WORKER_POOL_REACT_EXAMPLE: PreloadFileOptions<undefined> = {
  file: {
    name: 'editor_worker_pool_react.tsx',
    contents: `'use client';

import { Edit } from '@pierre/diffs/edit';
import {
  EditProvider,
  File,
  WorkerPoolContextProvider,
} from '@pierre/diffs/react';
import { workerFactory } from '@/utils/workerFactory';

const edit = new Edit();

export function EditWithWorkerPool() {
  return (
    <WorkerPoolContextProvider
      poolOptions={{ workerFactory }}
      highlighterOptions={{
        theme: { dark: 'pierre-dark', light: 'pierre-light' },
        useTokenTransformer: true,
      }}
    >
      <EditProvider edit={edit}>
        <File
          file={{ name: 'example.ts', contents: 'export const x = 1;' }}
          contentEditable
        />
      </EditProvider>
    </WorkerPoolContextProvider>
  );
}`,
  },
  options,
};

export const EDIT_OPTIONS_TYPE: PreloadFileOptions<undefined> = {
  file: {
    name: 'editor_options_type.ts',
    contents: `import type {
  DiffLineAnnotation,
  DiffsEditableComponent,
  FileContents,
} from '@pierre/diffs';
import { Edit } from '@pierre/diffs/edit';

interface EditOptions<LAnnotation> {
  // Max undo stack entries
  historyMaxEntries?: number;

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
    edit: Edit<LAnnotation>,
    fileInstance: DiffsEditableComponent<LAnnotation>
  ) => void;

  // Fires after each edit. file.contents reflects the live document.
  onChange?: (
    file: FileContents,
    lineAnnotations?: DiffLineAnnotation<LAnnotation>[]
  ) => void;

  // Fires when the editable content area gains focus (tab, click, or edit.focus()).
  onFocus?: () => void;

  // Fires when the editable content area loses focus.
  onBlur?: () => void;
}`,
  },
  options,
};

export const EDIT_PUBLIC_API: PreloadFileOptions<undefined> = {
  file: {
    name: 'editor_public_api.ts',
    contents: `import type {
  EditState,
  FileContents,
} from '@pierre/diffs';
import { Edit } from '@pierre/diffs/edit';

// Edit
// Most methods require an attached surface via edit().

const edit = new Edit();

// attach to a rendered File, FileDiff, or virtualized variant.
const dispose = edit.edit(fileInstance);

// Merge partial options at runtime. Existing fields are preserved.
// onChange and similar handlers read from the latest options on each call;
// pass onFocus/onBlur before edit() attaches, or set them in the constructor.
edit.setOptions({
  onChange(file, lineAnnotations) {
    console.log('change', file.name, lineAnnotations);
  },
});

// Attach to a rendered File, FileDiff, or virtualized variant.
// Normalizes conflicting fileInstance options and returns a dispose function.
const dispose = edit.edit(fileInstance);

// Detach, remove listeners, and clean up injected edit DOM.
// Pass recycle=true when a virtualized host is temporarily unmounting.
edit.cleanUp();
edit.cleanUp(true);

// Apply text edits to the attached document. Positions are zero-based.
// Pass true as the second argument to push the edits onto the undo stack.
edit.applyEdits([
  {
    range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
    newText: 'Hello, world!',
  },
]);
edit.applyEdits(
  [
    {
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
      newText: 'Hello, world!',
    },
  ],
  true
);

// Live FileContents for the attached document. Undefined when nothing is
// attached.
const file: FileContents | undefined = edit.getFile();

// Full document text, or '' when nothing is attached.
const text: string = edit.getText();

// Snapshot selections and scroll position for persistence or remount restore.
const state: EditState = edit.getState();
// EditState = {
//   selections?: EditSelection[];
//   view?: { scrollLeft: number; scrollTop: number };
// }

// Restore selections and scroll after re-rendering the underlying component.
edit.setState(state);

// Replace all cursors and ranges programmatically. Positions are zero-based;
// direction controls which end the caret uses for keyboard extension.
edit.setSelections([
  {
    start: { line: 0, character: 2 },
    end: { line: 0, character: 8 },
    direction: 'forward', // 'forward' | 'backward' | 'none'
  },
]);

// Show inline diagnostic markers. Pass [] to clear. Throws if not attached.
edit.setMarkers([
  {
    start: { line: 1, character: 2 },
    end: { line: 1, character: 8 },
    severity: 'error', // 'error' | 'warning' | 'info' | 'hint'
    message: { html: 'Some lint message' },
    source: 'eslint',
  },
]);
edit.setMarkers([]);

// Focus the editable content. preventScroll skips scrolling the caret into view.
// Blur removes focus from the content area.
edit.focus();
edit.focus({ preventScroll: true });
edit.blur();

// Whether there is an edit to undo or redo.
edit.canUndo;
edit.canRedo;

// Undo the last edit or redo the last undone edit. No-ops when history is empty.
edit.undo();
edit.redo();
`,
  },
  options,
};

export const EDIT_REACT_MULTI_FILE_DIFF_EXAMPLE: PreloadFileOptions<undefined> =
  {
    file: {
      name: 'editor_react_multi_file_diff.tsx',
      contents: `import type { FileContents } from '@pierre/diffs';
import { Edit } from '@pierre/diffs/edit';
import {
  EditProvider,
  MultiFileDiff,
  Virtualizer,
} from '@pierre/diffs/react';
import { useMemo, useState } from 'react';

// Keep file objects stable (useState/useMemo) to avoid re-renders.
// The component uses reference equality for change detection.
const oldFile: FileContents = {
  name: 'example.ts',
  contents: 'console.log("Hello world")',
};

const newFile: FileContents = {
  name: 'example.ts',
  contents: 'console.warn("Updated message")',
};


export function EditComponent() {
  const [editable, setEditable] = useState(true);
  const edit = useMemo(
    () =>
      new Edit({
        onChange(file, lineAnnotations) {
          console.log('change', file.name, lineAnnotations);
        },
      }),
    []
  );

  return (
    <EditProvider edit={edit}>
      <button type="button" onClick={() => setEditable((value) => !value)}>
        {editable ? 'Disable editing' : 'Enable editing'}
      </button>

      <Virtualizer
        style={{
          maxHeight: '16rem',
          overflow: 'auto',
          borderRadius: '0.5rem',
        }}
      >
        <MultiFileDiff
          oldFile={oldFile}
          newFile={newFile}
          options={{
            theme: { dark: 'pierre-dark', light: 'pierre-light' },
          }}
          contentEditable={editable}
        />
      </Virtualizer>
    </EditProvider>
  );
}`,
    },
    options,
  };
