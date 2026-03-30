'use client';

import type { FileTreeOptions, FileTreeStateConfig } from '@pierre/trees';
import { FileTree as FileTreeReact } from '@pierre/trees/react';

/**
 * React FileTree - Client-Side Rendered
 * No prerendered HTML, renders entirely on client
 */
export function ReactClientRendered({
  options,
  initialFiles,
  stateConfig,
}: {
  options: Omit<FileTreeOptions, 'initialFiles'>;
  initialFiles?: string[];
  stateConfig?: FileTreeStateConfig;
}) {
  return (
    <FileTreeReact
      options={options}
      initialFiles={initialFiles}
      initialExpandedItems={stateConfig?.initialExpandedItems}
      initialSelectedItems={stateConfig?.initialSelectedItems}
      onSelection={stateConfig?.onSelection}
    />
  );
}
