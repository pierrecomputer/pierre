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

export const EDITOR_QUICK_EDIT_EXAMPLE: PreloadFileOptions<undefined> = {
  file: {
    name: 'editor_quick_edit.ts',
    contents: `import { Editor } from '@pierre/diffs/editor';

const editor = new Editor({
  enabledQuickEdit: true,
  renderQuickEdit: (context) => {
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

export const EDITOR_QUICK_EDIT_CONTEXT_TYPE: PreloadFileOptions<undefined> = {
  file: {
    name: 'quick_edit_context.ts',
    contents: `export interface QuickEditContext<LAnnotation> {
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
  /** Closes the quick edit. */
  close: () => void;
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
