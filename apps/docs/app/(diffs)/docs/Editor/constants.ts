import type { PreloadFileOptions } from '@pierre/diffs/ssr';

import { CustomScrollbarCSS } from '@/components/CustomScrollbarCSS';

const options = {
  theme: { dark: 'pierre-dark', light: 'pierre-light' },
  disableFileHeader: true,
  unsafeCSS: CustomScrollbarCSS,
} as const;

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

export const EDITOR_PROGRAMMATIC_EXAMPLE: PreloadFileOptions<undefined> = {
  file: {
    name: 'editor_programmatic.ts',
    contents: `import { Editor } from '@pierre/diffs/editor';

const editor = new Editor();
editor.edit(fileInstance);

// Drive the selection from code. Positions are zero-based; \`direction\` controls
// which end the caret sits at when the selection is extended with the keyboard.
editor.setSelections([
  {
    start: { line: 0, character: 0 },
    end: { line: 0, character: 5 },
    direction: 'forward',
  },
]);

// Move focus into the editor (the caret follows the primary selection).
editor.focus();`,
  },
  options,
};

export const EDITOR_UNDO_REDO_EXAMPLE: PreloadFileOptions<undefined> = {
  file: {
    name: 'editor_undo_redo.tsx',
    contents: `import { Editor } from '@pierre/diffs/editor';
import { EditorProvider, File } from '@pierre/diffs/react';
import { useMemo, useState } from 'react';

export function EditorWithHistoryToolbar() {
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  const editor = useMemo(
    () =>
      new Editor({
        onChange() {
          // Undo and redo run through the same change path as edits, so refresh
          // toolbar state from \`onChange\` rather than only after button clicks.
          setCanUndo(editor.canUndo);
          setCanRedo(editor.canRedo);
        },
      }),
    []
  );

  return (
    <EditorProvider editor={editor}>
      <div className="toolbar">
        <button type="button" disabled={!canUndo} onClick={() => editor.undo()}>
          Undo
        </button>
        <button type="button" disabled={!canRedo} onClick={() => editor.redo()}>
          Redo
        </button>
      </div>

      <File
        file={{ name: 'example.ts', contents: 'export const x = 1;' }}
        contentEditable
      />
    </EditorProvider>
  );
}`,
  },
  options,
};

export const EDITOR_REACT_EXAMPLE: PreloadFileOptions<undefined> = {
  file: {
    name: 'editor_react.tsx',
    contents: `import type { FileContents } from '@pierre/diffs';
import { Editor } from '@pierre/diffs/editor';
import { EditorProvider, File, Virtualizer } from '@pierre/diffs/react';
import { useMemo, useState } from 'react';

const file: FileContents = {
  name: 'example.ts',
  contents: \`function greet(name: string) {
  console.log(\\\`Hello, \\\${name}!\\\`);
}

export { greet };\`,
};

export function EditorComponent() {
  const [editable, setEditable] = useState(true);
  const editor = useMemo(
    () =>
      new Editor({
        onChange(file, lineAnnotations) {
          console.log('change', file.name, lineAnnotations);
        },
      }),
    []
  );

  return (
    <EditorProvider editor={editor}>
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
    </EditorProvider>
  );
}`,
  },
  options,
};

export const EDITOR_REACT_FILE_DIFF_EXAMPLE: PreloadFileOptions<undefined> = {
  file: {
    name: 'editor_react_file_diff.tsx',
    contents: `import { Editor } from '@pierre/diffs/editor';
import {
  type FileDiffMetadata,
  EditorProvider,
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

export function EditorComponent() {
  const [editable, setEditable] = useState(true);
  const editor = useMemo(
    () =>
      new Editor({
        onChange(file, lineAnnotations) {
          console.log('change', file.name, lineAnnotations);
        },
      }),
    []
  );

  return (
    <EditorProvider editor={editor}>
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
    </EditorProvider>
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

import { Editor } from '@pierre/diffs/editor';
import {
  EditorProvider,
  File,
  WorkerPoolContextProvider,
} from '@pierre/diffs/react';
import { workerFactory } from '@/utils/workerFactory';

const editor = new Editor();

export function EditorWithWorkerPool() {
  return (
    <WorkerPoolContextProvider
      poolOptions={{ workerFactory }}
      highlighterOptions={{
        theme: { dark: 'pierre-dark', light: 'pierre-light' },
        useTokenTransformer: true,
      }}
    >
      <EditorProvider editor={editor}>
        <File
          file={{ name: 'example.ts', contents: 'export const x = 1;' }}
          contentEditable
        />
      </EditorProvider>
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
import { Editor } from '@pierre/diffs/editor';

interface EditorOptions<LAnnotation> {
  // Max undo stack entries
  historyMaxEntries?: number;

  // Render rounded corners on selection ranges (default: true)
  roundedSelection?: boolean;

  // Auto-surround selected text when typing a quote or bracket.
  // Values: 'default' | 'never' | 'brackets' | 'quotes' | 'languageDefined'
  // (default: 'default' — both quotes and brackets)
  autoSurround?: 'default' | 'never' | 'brackets' | 'quotes' | 'languageDefined';

  // Show the gutter icon for Selection Action (default: false)
  enabledSelectionAction?: boolean;

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
}`,
  },
  options,
};

export const EDITOR_PUBLIC_API: PreloadFileOptions<undefined> = {
  file: {
    name: 'editor_public_api.ts',
    contents: `import { Editor } from '@pierre/diffs/editor';

const editor = new Editor();

// Attach to a rendered File, FileDiff, or virtualized variant.
// Normalizes conflicting fileInstance options and returns a dispose function.
const dispose = editor.edit(fileInstance)

// Detach, remove listeners, and clean up injected editor DOM.
// same as dispose()
editor.cleanUp()

// Apply text edits to the attached document
// The range is 0-indexed
editor.applyEdits([
  {
    range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
    newText: 'Hello, world!',
  },
])
// Apply text edits and update the undo stack
editor.applyEdits([
  {
    range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
    newText: 'Hello, world!',
  },
], true)

// Get the current editor state - file, selections, lineAnnotations, renderRange
const state = editor.getState()
const stateRaw = JSON.stringify(state) // serialize the state to a json string for storage/persistence

// Restore editor state after re-rendering the underlying component.
editor.setState(state)

// Replace all cursors and ranges programmatically.
// The start/end positions are 0-indexed
editor.setSelections([
  {
    start: { line: 0, character: 2 },
    end: { line: 0, character: 8 },
    direction: 'forward',
  },
])

// Show inline diagnostic markers. Pass [] to clear.
editor.setMarkers([
  {
    start: { line: 1,  character: 2 },
    end: {  line: 1, character: 8 },
    severity: 'error', // or 'warning', 'info', 'hint'
    message: {
      html: 'Some lint message',
    },
  },
])

// Focus the editor.
editor.focus()

// Blur the editor.
editor.blur()

// Whether there is an edit to undo or redo.
editor.canUndo
editor.canRedo

// Undo the last edit or redo the last undone edit. No-ops when history is empty.
editor.undo()
editor.redo()
`,
  },
  options,
};

export const EDITOR_REACT_MULTI_FILE_DIFF_EXAMPLE: PreloadFileOptions<undefined> =
  {
    file: {
      name: 'editor_react_multi_file_diff.tsx',
      contents: `import type { FileContents } from '@pierre/diffs';
import { Editor } from '@pierre/diffs/editor';
import {
  EditorProvider,
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


export function EditorComponent() {
  const [editable, setEditable] = useState(true);
  const editor = useMemo(
    () =>
      new Editor({
        onChange(file, lineAnnotations) {
          console.log('change', file.name, lineAnnotations);
        },
      }),
    []
  );

  return (
    <EditorProvider editor={editor}>
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
    </EditorProvider>
  );
}`,
    },
    options,
  };
