'use client';

import type { FileTreeOptions } from '@pierre/file-tree';
import { useMemo } from 'react';

import { FeatureHeader } from '../../diff-examples/FeatureHeader';
import { TreeApp } from '../TreeApp';
import { baseTreeOptions, SHARED_FILE_CONTENT } from './demo-data';
import { TreeExampleSection } from './TreeExampleSection';

/** Generate a large list of file paths for stress-test demo. */
function generateLargeFileList(count: number): string[] {
  const files: string[] = [
    'README.md',
    'package.json',
    'src/index.ts',
    'src/utils.ts',
  ];
  for (let i = 0; i < count; i++) {
    files.push(`src/features/feature-${i}/index.ts`);
    files.push(`src/features/feature-${i}/utils.ts`);
    if (i % 3 === 0) {
      files.push(`src/features/feature-${i}/components/Button.tsx`);
    }
  }
  return files;
}

const LARGE_FILE_LIST = generateLargeFileList(80);

/** Stub content for a few paths in the huge list so selection shows real code. */
const HUGE_DATASET_CONTENT: Record<string, string> = {
  ...SHARED_FILE_CONTENT,
  'src/features/feature-0/index.ts': `export { Button } from './components/Button';
export { useFeature } from './utils/useFeature';
`,
  'src/features/feature-0/utils.ts': `export function useFeature() {
  return { id: 'feature-0', name: 'Feature Zero' };
}
`,
  'src/features/feature-1/index.ts': `export { Card } from './components/Card';
export type { CardProps } from './components/Card';
`,
};

export function HugeDatasetSection() {
  const fileTreeOptions = useMemo<FileTreeOptions>(
    () => ({
      ...baseTreeOptions,
      files: LARGE_FILE_LIST,
      config: {
        ...baseTreeOptions.config,
        initialState: {
          expandedItems: ['src', 'src/features', 'src/features/feature-0'],
          selectedItems: ['package.json'],
        },
        fileTreeSearchMode: 'collapse-non-matches',
      },
      flattenEmptyDirectories: true,
    }),
    []
  );
  return (
    <TreeExampleSection id="huge-dataset">
      <FeatureHeader
        title="Supports large datasets"
        description={
          <>
            Trees easily handle hundreds of DOM nodes without freezing. This
            demo renders over 250 file paths. Expand <code>src</code> →{' '}
            <code>features</code> or use search to find files.
          </>
        }
      />
      <div className="space-y-4">
        <p className="text-muted-foreground border-border bg-muted/30 rounded-md border px-3 py-2 text-sm">
          <strong>Try it:</strong> Expand <code className="text-xs">src</code>{' '}
          and <code className="text-xs">src/features</code>, then scroll or
          search (e.g.{' '}
          <kbd className="border-border bg-muted rounded border px-1 font-mono text-xs">
            feature-0
          </kbd>
          ). Select a file to see content on the right.
        </p>
        <TreeApp
          fileTreeOptions={fileTreeOptions}
          fileContentMap={HUGE_DATASET_CONTENT}
          defaultSelectedPath="package.json"
        />
      </div>
    </TreeExampleSection>
  );
}
