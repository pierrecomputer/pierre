import type { FileTreeOptions, FileTreeSearchMode } from '@pierre/trees';

import { sharedDemoFileTreeOptions } from '../../trees/demo-data';

/** Shared file content for tree example sections. */
export const SHARED_FILE_CONTENT: Record<string, string> = {
  'README.md': `# Trees with Diffs Demo

You're looking at a live demo of **Trees with Diffs**: our diff and file
rendering library, wrapped in the \`TreeApp\` component.

Select a file from the tree to view its content.`,
  'package.json': `{
  "name": "example",
  "version": "0.0.0",
  "private": true
}`,
  'build/index.mjs': `import { greet } from './scripts.js';
const message = greet('Trees with Diffs');
export function run() { return message; }
`,
  'build/scripts.js': `export function greet(name) {
  return \`Hello from \${name}\`;
}
`,
  'src/index.ts': `export function main() {
  console.log('Hello from tree demo');
}
`,
};

/** Options with flatten empty directories enabled (nested folders collapsed). Optional initialExpanded opens those folders on load (e.g. ['build']). */
export function flatteningOptions(
  flatten: boolean,
  initialExpanded?: string[]
): FileTreeOptions {
  return {
    ...sharedDemoFileTreeOptions,
    flattenEmptyDirectories: flatten,
    ...(initialExpanded != null &&
      initialExpanded.length > 0 && {
        config: {
          ...sharedDemoFileTreeOptions.config,
          initialState: {
            ...sharedDemoFileTreeOptions.config?.initialState,
            expandedItems: initialExpanded,
          },
        },
      }),
  };
}

/** Base options for all tree example sections. */
export const baseTreeOptions = sharedDemoFileTreeOptions;

/** Options with search mode for the search example. Optional initialSearch prepopulates the search field and filters the tree on load. */
export function searchOptions(
  mode: FileTreeSearchMode,
  initialSearch?: string
): FileTreeOptions {
  return {
    ...sharedDemoFileTreeOptions,
    config: {
      ...sharedDemoFileTreeOptions.config,
      fileTreeSearchMode: mode,
      ...(initialSearch != null &&
        initialSearch.length > 0 && {
          initialState: {
            ...sharedDemoFileTreeOptions.config?.initialState,
            search: initialSearch,
          },
        }),
    },
  };
}
