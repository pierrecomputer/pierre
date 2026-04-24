import { expect, test } from 'bun:test';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  createFileTreeProfileFixtureOptions,
  DEFAULT_FILE_TREE_PROFILE_WORKLOAD_NAME,
  FILE_TREE_PROFILE_VIEWPORT_HEIGHT,
  FILE_TREE_PROFILE_WORKLOAD_NAMES,
  getFileTreeProfileWorkload,
} from '../scripts/lib/fileTreeProfileShared';
import { preparePresortedFileTreeInput } from '../src/preparedInput';

const packageRoot = fileURLToPath(new URL('../', import.meta.url));

test('file-tree profile fixture workload defaults mirror the intended tree profile set', () => {
  expect(FILE_TREE_PROFILE_WORKLOAD_NAMES).toEqual([
    'linux-5x',
    'linux-10x',
    'linux',
    'aosp',
    'demo-small',
  ]);
  expect(DEFAULT_FILE_TREE_PROFILE_WORKLOAD_NAME).toBe('linux-5x');
});

test('file-tree profile fixture options mirror the docs tree profile defaults', () => {
  const workload = getFileTreeProfileWorkload('linux-5x');
  const options = createFileTreeProfileFixtureOptions(workload);

  expect(options.flattenEmptyDirectories).toBe(true);
  expect(options.initialExpansion).toBe('open');
  expect('initialExpandedPaths' in options).toBe(false);
  expect('paths' in options).toBe(false);
  expect(options.initialVisibleRowCount).toBe(
    FILE_TREE_PROFILE_VIEWPORT_HEIGHT / 30
  );
  expect(options.stickyFolders).toBe(true);
  expect(options.preparedInput).toEqual(
    preparePresortedFileTreeInput(workload.files)
  );
});

test('file-tree profile fixture options can start from a collapsed action state', () => {
  const workload = getFileTreeProfileWorkload('linux-5x');
  const options = createFileTreeProfileFixtureOptions(workload, {
    initialExpansion: 'closed',
  });

  expect(options.flattenEmptyDirectories).toBe(true);
  expect(options.initialExpansion).toBe('closed');
  expect(options.stickyFolders).toBe(true);
  expect(options.preparedInput).toEqual(
    preparePresortedFileTreeInput(workload.files)
  );
});

test('file-tree profile fixture HTML stays minimal and idle-on-load', () => {
  const html = readFileSync(
    `${packageRoot}/test/e2e/fixtures/file-tree-profile.html`,
    'utf8'
  );
  const dom = new JSDOM(html);
  const { document } = dom.window;

  expect(document.querySelector('[data-profile-render-button]')).not.toBeNull();
  expect(document.querySelector('#workload')).not.toBeNull();
  expect(document.querySelector('[data-profile-mount]')).not.toBeNull();
  expect(document.querySelector('file-tree-container')).toBeNull();
  expect(document.querySelector('h1')).toBeNull();
  expect(html.includes('Capability')).toBe(false);
});
