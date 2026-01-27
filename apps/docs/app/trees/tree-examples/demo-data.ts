import type { FileTreeOptions } from '@pierre/file-tree';

import { sharedDemoFileTreeOptions } from '../../file-tree/demo-data';

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

/** Options with flatten empty directories enabled (nested folders collapsed). */
export function flatteningOptions(flatten: boolean): FileTreeOptions {
  return {
    ...sharedDemoFileTreeOptions,
    flattenEmptyDirectories: flatten,
  };
}

/** Base options for all tree example sections. */
export const baseTreeOptions = sharedDemoFileTreeOptions;
