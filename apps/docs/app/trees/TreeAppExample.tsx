'use client';

import { sharedDemoFileTreeOptions } from '../trees/demo-data';
import { TreeApp } from './TreeApp';

const STUB_FILE_CONTENT: Record<string, string> = {
  'README.md': `# Trees with Diffs Demo

You're looking at a live demo of **Trees with Diffs**: our diff and file
rendering library, wrapped in the \`TreeApp\` component.

## What you see

- **Left panel** – A \`FileTree\` from \`@pierre/trees\`. Use the search field
  to filter, expand folders, and select files.
- **Right panel** – The selected file is rendered with \`@pierre/diffs\` \`File\`
  component (syntax highlighting, line numbers, light/dark theme).

## Try it

1. Select a file from the tree to view its content.
2. Use the search box to jump to files by name.
3. Expand and collapse folders to browse the demo structure.

## Tech stack

- [\`@pierre/trees\`](.) – File tree UI (vanilla + React, SSR support).
- [\`@pierre/diffs\`](.) – File and diff rendering (Shiki, virtualized).

TreeApp connects both with shared styles and selection.

## Local development

\`\`\`bash
bun install
bun run dev
\`\`\`

Open the trees product page to see this demo. The file tree and code viewer
update in sync when you change the selection.

## Customization

You can pass \`fileContentMap\`, \`defaultSelectedPath\`, and \`fileTreeOptions\`
to \`TreeApp\` to drive the tree and content from your own data. Optional
\`preloadedFileTreeHtml\` enables SSR for the tree.
`,
  'package.json': `{
  "name": "example",
  "version": "0.0.0",
  "private": true
}`,
  'build/index.mjs': `/**
 * Build entry point. Bundles the app and runs post-build steps.
 */

import { greet } from './scripts.js';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';

const message = greet('Trees with Diffs');
console.log(message);

const pkgPath = resolve(process.cwd(), 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
console.log(\`Building \${pkg.name}@\${pkg.version}\`);

export function run() {
  return message;
}

export async function build(config = {}) {
  const { outDir = 'dist', minify = true } = config;
  console.log(\`Output: \${outDir}, minify: \${minify}\`);
  return { outDir, minify };
}

export default { run, build };
`,
  'build/scripts.js': `/**
 * Demo scripts for the tree example.
 */

export function greet(name) {
  return \`Hello from \${name}\`;
}
`,
  'src/index.ts': `export function main() {
  console.log('Hello from tree demo');
}
`,
};

export function TreeAppExample() {
  return (
    <TreeApp
      fileTreeOptions={sharedDemoFileTreeOptions}
      fileContentMap={STUB_FILE_CONTENT}
      defaultSelectedPath="package.json"
    />
  );
}
