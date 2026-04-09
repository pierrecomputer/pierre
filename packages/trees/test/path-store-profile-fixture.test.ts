import { expect, test } from 'bun:test';
// @ts-expect-error -- no @types/jsdom; only used in tests
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  createPathStoreProfileFixtureOptions,
  DEFAULT_PATH_STORE_PROFILE_WORKLOAD_NAME,
  getPathStoreProfileWorkload,
  PATH_STORE_PROFILE_VIEWPORT_HEIGHT,
  PATH_STORE_PROFILE_WORKLOAD_NAMES,
} from '../scripts/lib/pathStoreProfileShared';

const packageRoot = fileURLToPath(new URL('../', import.meta.url));

test('path-store profile fixture workload defaults mirror the intended path-store profile set', () => {
  expect(PATH_STORE_PROFILE_WORKLOAD_NAMES).toEqual([
    'linux-5x',
    'linux-10x',
    'linux',
    'demo-small',
  ]);
  expect(DEFAULT_PATH_STORE_PROFILE_WORKLOAD_NAME).toBe('linux-5x');
});

test('path-store profile fixture options mirror the Phase 4 docs tree behavior', () => {
  const workload = getPathStoreProfileWorkload('linux-5x');
  const options = createPathStoreProfileFixtureOptions(workload);

  expect(options.flattenEmptyDirectories).toBe(true);
  expect(options.initialExpandedPaths).toEqual(workload.expandedFolders);
  expect(options.paths).toEqual(workload.files);
  expect(options.viewportHeight).toBe(PATH_STORE_PROFILE_VIEWPORT_HEIGHT);
  const preparedInput = options.preparedInput as {
    paths: readonly string[];
    presortedPaths: readonly string[];
  };
  expect(preparedInput.paths).toEqual(workload.files);
  expect(preparedInput.presortedPaths).toEqual(workload.files);
});

test('path-store profile fixture HTML stays minimal and idle-on-load', () => {
  const html = readFileSync(
    `${packageRoot}/test/e2e/fixtures/path-store-profile.html`,
    'utf8'
  );
  const dom = new JSDOM(html);
  const { document } = dom.window;

  expect(document.querySelector('[data-profile-render-button]')).not.toBeNull();
  expect(document.querySelector('#workload')).not.toBeNull();
  expect(document.querySelector('[data-profile-mount]')).not.toBeNull();
  expect(document.querySelector('file-tree-container')).toBeNull();
  expect(document.querySelector('h1')).toBeNull();
  expect(html.includes('Capability / phase matrix')).toBe(false);
});
