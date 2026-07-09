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
import { CodeEditor } from '@pierre/diffs';

// Editor
// Most methods require an attached surface via edit(), or a CodeEditor that
// handles attachment for you.

const editor = new Editor();

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
// Pass true as the second argument to push the edits onto the undo stack.
editor.applyEdits([
  {
    range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
    newText: 'Hello, world!',
  },
]);
editor.applyEdits(
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

// CodeEditor
// High-level single-file editor. It inherits every Editor method above and adds:

const codeEditor = new CodeEditor();

// Mount into root. Omit file to show renderPlaceholder (if provided).
codeEditor.render(root, file, lineAnnotations);

// Swap the open file (and optional annotations) without recreating the editor.
codeEditor.setFile(file, lineAnnotations);

// Update annotations for the current file only.
codeEditor.setLineAnnotations(lineAnnotations);

// Also cleans up the managed scroll container, virtualizer, and file instance.
codeEditor.cleanUp();`,
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

export const EDITOR_CODE_EDITOR_REACT_EXAMPLE: PreloadFileOptions<undefined> = {
  file: {
    name: 'code_editor_react.tsx',
    contents: `import type { FileContents } from '@pierre/diffs';
import type { Editor } from '@pierre/diffs/editor';
import { CodeEditor } from '@pierre/diffs/react';
import { useRef } from 'react';

const file: FileContents = {
  name: 'example.ts',
  contents: \`function greet(name: string) {
  console.log(\\\`Hello, \\\${name}!\\\`);
}

export { greet };\`,
};

export function CodeEditorComponent() {
  const editorRef = useRef<Editor | null>(null);

  return (
    <CodeEditor
      ref={editorRef}
      file={file}
      theme={{ dark: 'pierre-dark', light: 'pierre-light' }}
      style={{
        height: '16rem',
        borderRadius: '0.5rem',
      }}
      onChange={(nextFile, lineAnnotations) => {
        console.log('change', nextFile.name, lineAnnotations);
      }}
      renderPlaceholder={() => (
        <p style={{ padding: '1rem' }}>No file selected</p>
      )}
    />
  );
}`,
  },
  options,
};

export const EDITOR_CODE_EDITOR_VANILLA_EXAMPLE: PreloadFileOptions<undefined> =
  {
    file: {
      name: 'code_editor_vanilla.ts',
      contents: `import { CodeEditor, type FileContents } from '@pierre/diffs';

const root = document.getElementById('editor-root');
if (root == null) {
  throw new Error('Expected #editor-root to exist');
}

root.style.height = '16rem';

const file: FileContents = {
  name: 'example.ts',
  contents: \`function greet(name: string) {
  console.log(\\\`Hello, \\\${name}!\\\`);
}

export { greet };\`,
};

const editor = new CodeEditor({
  theme: { dark: 'pierre-dark', light: 'pierre-light' },
  onChange(nextFile) {
    console.log('change', nextFile.name, nextFile.contents);
  },
  renderPlaceholder() {
    const placeholder = document.createElement('p');
    placeholder.textContent = 'No file selected';
    return placeholder;
  },
});

editor.render(root, file);

// Swap the open file without recreating the editor:
// editor.setFile(otherFile);

// Update annotations for the current file:
// editor.setLineAnnotations([{ lineNumber: 2, metadata: note }]);

editor.cleanUp();`,
    },
    options,
  };

export const EDITOR_CODE_EDITOR_OPTIONS_TYPE: PreloadFileOptions<undefined> = {
  file: {
    name: 'code_editor_options_type.ts',
    contents: `import type {
  FileContents,
  LineAnnotation,
  WorkerPoolManager,
} from '@pierre/diffs';
import type { EditorOptions } from '@pierre/diffs/editor';
import type { CSSProperties, ReactNode } from 'react';

// CodeEditorOptions combines EditorOptions with selected File options.
export interface CodeEditorOptions<LAnnotation, ElementType = HTMLElement>
  extends EditorOptions<LAnnotation> {
  // Theme for syntax highlighting. Can be a single theme name or an
  // object with 'dark' and 'light' keys for automatic switching.
  // Built-in options: 'pierre-dark', 'pierre-light', or any Shiki theme.
  // See: https://shiki.style/themes
  theme?: string | { dark: string; light: string };

  // Long line handling: 'scroll' (default) or 'wrap'.
  overflow?: 'scroll' | 'wrap';

  // When using a dark/light theme object, choose the active theme.
  // 'system' (default) follows the OS preference.
  themeType?: 'system' | 'dark' | 'light';

  // Choose the Shiki engine: 'shiki-js' (default) or 'shiki-wasm'.
  preferredHighlighter?: 'shiki-js' | 'shiki-wasm';

  // Skip syntax highlighting for lines exceeding this length (default: 1000).
  tokenizeMaxLineLength?: number;

  // Max total characters to tokenize before falling back to plain text.
  tokenizeMaxLength?: number;

  // Hide line numbers when true (default: false).
  disableLineNumbers?: boolean;

  // Rethrow rendering errors instead of catching and displaying them
  // in the DOM. Useful for testing or custom error handling. (default: false)
  disableErrorHandling?: boolean;

  // Extra lines kept rendered above/below the viewport for smoother scrolling.
  overscrollSize?: number;

  // Vanilla: pass a pool to the managed VirtualizedFile.
  // React: prefer WorkerPoolContextProvider, or set disableWorkerPool.
  workerPoolManager?: WorkerPoolManager;

  // Custom line annotation UI. Return an ElementType (HTMLElement in vanilla,
  // ReactNode in React) rendered beside the annotated line.
  renderAnnotation?: (annotation: LineAnnotation<LAnnotation>) => ElementType;

  // Shown when \`file\` is nullish instead of rendering an empty editor.
  renderPlaceholder?: () => ElementType;
}

// Props for the React <CodeEditor> component.
export interface CodeEditorProps<
  LAnnotation = undefined,
> extends CodeEditorOptions<LAnnotation, ReactNode> {
  // File to edit. Omit to show renderPlaceholder.
  file?: FileContents;

  // Line annotations rendered via renderAnnotation.
  lineAnnotations?: LineAnnotation<LAnnotation>[];

  // Server-preloaded HTML for first paint / hydration (from @pierre/diffs/ssr).
  prerenderedHTML?: string;

  // Class name applied to the scroll container.
  className?: string;

  // Inline styles applied to the scroll container. Set a height for scrolling.
  style?: CSSProperties;

  // Skip the shared worker pool and highlight on the main thread (default: false).
  disableWorkerPool?: boolean;
}`,
  },
  options,
};
