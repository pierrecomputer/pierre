'use client';

import type { FileTreeBuiltInIconSet } from '@pierre/trees';
import { FileTree as FileTreeReact } from '@pierre/trees/react';

const TIER_FILES = [
  // Folder states
  'closed-folder/placeholder',
  'open-folder/placeholder',

  // Standard tier — languages & common file types
  'index.ts',
  'app.js',
  'App.tsx',
  'style.css',
  'page.html',
  'data.json',
  'README.md',
  'main.go',
  'main.py',
  'app.rb',
  'lib.rs',
  'app.swift',
  'script.sh',
  'logo.png',
  'font.woff2',
  '.gitignore',
  'config.mcp',
  'notes.txt',
  'data.csv',
  'schema.sql',
  'archive.zip',

  // Complete tier — frameworks, brands, tooling
  'Layout.astro',
  '.babelrc',
  'biome.json',
  'bootstrap.min.js',
  '.browserslistrc',
  'bun.lock',
  'claude.md',
  'Dockerfile',
  'eslint.config.js',
  'schema.graphql',
  'next.config.ts',
  'package.json',
  '.oxlintrc.json',
  'postcss.config.js',
  '.prettierrc',
  'styles.scss',
  '.stylelintrc',
  'icon.svg',
  'App.svelte',
  'svgo.config.js',
  'tailwind.config.ts',
  'main.tf',
  'vite.config.ts',
  'settings.code-workspace',
  'App.vue',
  'module.wasm',
  'webpack.config.js',
  'config.yml',
  'main.zig',

  // Falls through to `default` token
  'unknown.xyz',
];

const TIERS: { set: FileTreeBuiltInIconSet; label: string }[] = [
  { set: 'minimal', label: 'Minimal' },
  { set: 'standard', label: 'Standard' },
  { set: 'complete', label: 'Complete' },
];

export default function IconTiersPage() {
  return (
    <>
      <h1 className="mb-4 text-2xl font-bold">Icon Tiers</h1>
      <div className="grid grid-cols-3 gap-6">
        {TIERS.map(({ set, label }) => (
          <div key={set}>
            <h2 className="mb-2 text-sm font-bold">{label}</h2>
            <div
              className="overflow-hidden rounded-md p-3"
              style={{
                boxShadow: '0 0 0 1px var(--color-border), 0 1px 3px #0000000d',
              }}
            >
              <FileTreeReact
                options={{
                  id: `icon-tier-${set}`,
                  icons: set,
                }}
                initialFiles={TIER_FILES}
                initialExpandedItems={['open-folder']}
              />
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
