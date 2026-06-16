'use client';

import type { FileContents } from '@pierre/diffs';
import { Editor } from '@pierre/diffs/editor';
import { EditorProvider, File } from '@pierre/diffs/react';
import { useMemo, useState } from 'react';

const initialFile: FileContents = {
  name: 'editable-demo.ts',
  contents: `import { VirtualizedFile } from '@pierre/diffs';
import { Editor } from '@pierre/diffs/editor';

const fileInstance = new VirtualizedFile({
  theme: { dark: 'pierre-dark', light: 'pierre-light' },
});

// render the file into a DOM container
fileInstance.render({
  file: { name: 'index.ts', contents: 'export const foo: string = "bar";\n' },
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
};

export function EditorDemo() {
  const [file, _setFile] = useState<FileContents>(initialFile);
  const [changeCount, setChangeCount] = useState(0);

  const editor = useMemo(
    () =>
      new Editor({
        enabledSelectionAction: true,
        renderSelectionAction({
          close,
          replaceSelectionText,
          getSelectionText,
        }) {
          const container = document.createElement('div');
          const button = document.createElement('button');

          container.style.cssText =
            'display: flex; flex-wrap: wrap; gap: 8px; padding: 8px 0;';
          button.type = 'button';
          button.textContent = 'Wrap selection in TODO()';
          button.style.cssText =
            'font-size: 12px; padding: 4px 10px; border-radius: 6px; border: 1px solid color-mix(in srgb, currentColor 35%, transparent); background: color-mix(in srgb, currentColor 8%, transparent); cursor: pointer;';
          button.addEventListener('click', () => {
            replaceSelectionText(`TODO(${getSelectionText()})`);
            close();
          });

          container.appendChild(button);
          return container;
        },
        onChange(_file) {
          // setFile(nextFile);
          setChangeCount((count) => count + 1);
        },
      }),
    []
  );

  return (
    <div className="not-prose bg-card overflow-hidden rounded-lg border">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
        <div>
          <h5 className="text-sm font-medium">Editor Demo</h5>
          <p className="text-muted-foreground text-xs">
            Click into the code and type to try the editor.
          </p>
        </div>
        <div className="text-muted-foreground text-xs">
          Changes: {changeCount}
        </div>
      </div>
      <EditorProvider editor={editor}>
        <File
          className="max-h-[480px] overflow-auto rounded-none border-0"
          options={{
            theme: { dark: 'pierre-dark', light: 'pierre-light' },
            disableFileHeader: true,
          }}
          file={file}
          contentEditable
        />
      </EditorProvider>
    </div>
  );
}
