import type { PreloadFileOptions } from '@pierre/diffs/ssr';

import { CustomScrollbarCSS } from '@/components/CustomScrollbarCSS';

const options = {
  theme: { dark: 'pierre-dark', light: 'pierre-light' },
  disableFileHeader: true,
  unsafeCSS: CustomScrollbarCSS,
} as const;

export const CODE_VIEW_REACT_EXAMPLE: PreloadFileOptions<undefined> = {
  file: {
    name: 'code_view_react.tsx',
    contents: `import {
  parseDiffFromFile,
  type CodeViewItem,
  type CodeViewLineSelection,
} from '@pierre/diffs';
import { CodeView, type CodeViewHandle } from '@pierre/diffs/react';
import { useMemo, useRef, useState } from 'react';

const oldAppFile = {
  name: 'src/app.ts',
  contents: 'export function greet() {\n  return "hello";\n}',
};

const newAppFile = {
  name: 'src/app.ts',
  contents:
    'export function greet(name: string) {\n  return "hello " + name;\n}',
};

const readmeFile = {
  name: 'README.md',
  contents: '# Docs\n\nThis file is rendered inline with the diff list.',
};

export function ReviewSurface() {
  const viewerRef = useRef<CodeViewHandle | null>(null);
  const [selectedLines, setSelectedLines] =
    useState<CodeViewLineSelection | null>(null);

  const items = useMemo<CodeViewItem[]>(
    () => [
      {
        id: 'diff:src/app.ts',
        type: 'diff',
        fileDiff: parseDiffFromFile(oldAppFile, newAppFile),
        annotations: [{ side: 'additions', lineNumber: 2 }],
      },
      {
        id: 'file:README.md',
        type: 'file',
        file: readmeFile,
      },
    ],
    []
  );

  return (
    <>
      <button
        type="button"
        onClick={() =>
          viewerRef.current?.scrollTo({
            type: 'line',
            id: 'diff:src/app.ts',
            lineNumber: 2,
            side: 'additions',
            behavior: 'smooth-auto',
          })
        }
      >
        Jump to change
      </button>

      <CodeView
        ref={viewerRef}
        items={items}
        style={{ height: 600, overflow: 'auto' }}
        options={{
          theme: { dark: 'pierre-dark', light: 'pierre-light' },
          stickyHeaders: true,
          enableLineSelection: true,
          enableGutterUtility: true,
          viewerMetrics: { paddingTop: 16, paddingBottom: 24, gap: 12 },
        }}
        selectedLines={selectedLines}
        onSelectedLinesChange={setSelectedLines}
        renderHeaderMetadata={(item) =>
          item.type === 'diff' ? <span>{item.fileDiff.type}</span> : <span>file</span>
        }
        renderAnnotation={(annotation, item) => (
          <div>
            Note for {item.id} on line {annotation.lineNumber}
          </div>
        )}
        renderGutterUtility={(getHoveredLine, item) => {
          const hoveredLine = getHoveredLine();
          if (hoveredLine == null || item.type !== 'diff') {
            return null;
          }
          return (
            <button type="button">
              Comment on line {hoveredLine.lineNumber}
            </button>
          );
        }}
      />
    </>
  );
}`,
  },
  options,
};

export const CODE_VIEW_VANILLA_EXAMPLE: PreloadFileOptions<undefined> = {
  file: {
    name: 'code_view_vanilla.ts',
    contents: `import {
  CodeView,
  parseDiffFromFile,
  type CodeViewItem,
} from '@pierre/diffs';

const root = document.getElementById('review-root');
if (root == null) {
  throw new Error('Expected #review-root to exist');
}

root.style.height = '600px';
root.style.overflow = 'auto';

const viewer = new CodeView({
  theme: { dark: 'pierre-dark', light: 'pierre-light' },
  stickyHeaders: true,
  enableLineSelection: true,
  enableGutterUtility: true,
  viewerMetrics: { paddingTop: 16, paddingBottom: 24, gap: 12 },
  onSelectedLinesChange(selection) {
    console.log('selected lines', selection);
  },
  renderHeaderMetadata(_headerData, context) {
    return context.item.type === 'diff' ? context.item.fileDiff.type : 'file';
  },
  renderGutterUtility(getHoveredLine, context) {
    const hoveredLine = getHoveredLine();
    if (hoveredLine == null || context.item.type !== 'diff') {
      return undefined;
    }

    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'Comment on line ' + hoveredLine.lineNumber;
    return button;
  },
});

viewer.setup(root);

const items: CodeViewItem[] = [
  {
    id: 'diff:src/app.ts',
    type: 'diff',
    fileDiff: parseDiffFromFile(
      {
        name: 'src/app.ts',
        contents: 'export function greet() {\\n  return "hello";\\n}',
      },
      {
        name: 'src/app.ts',
        contents:
          'export function greet(name: string) {\\n  return "hello " + name;\\n}',
      }
    ),
    annotations: [{ side: 'additions', lineNumber: 2 }],
  },
  {
    id: 'file:README.md',
    type: 'file',
    file: {
      name: 'README.md',
      contents: '# Docs\\n\\nThis file is rendered inline with the diff list.',
    },
  },
];

viewer.setItems(items);

viewer.scrollTo({
  type: 'line',
  id: 'diff:src/app.ts',
  lineNumber: 2,
  side: 'additions',
  behavior: 'smooth-auto',
});

const nextItems = items.map((item) =>
  item.id === 'diff:src/app.ts' && item.type === 'diff'
    ? {
        ...item,
        version: 2,
        annotations: [{ side: 'additions', lineNumber: 2 }],
      }
    : item
);

viewer.setItems(nextItems);

window.addEventListener('beforeunload', () => {
  viewer.cleanUp();
});`,
  },
  options,
};
