import { describe, expect, test } from 'bun:test';

import { loadFileTreeController } from './helpers/loadFileTree';

const FILES = [
  'README.md',
  'src/utils/worker.ts',
  'src/utils/stream.ts',
] as const;

function getVisiblePaths(
  controller: import('../src/model/FileTreeController').FileTreeController
): string[] {
  return controller
    .getVisibleRows(0, controller.getVisibleCount())
    .map((row) => row.path);
}

// These tests drive the controller directly. They exercise the manual collapse
// override for a hide-non-matches search. A row click collapses a matched
// directory to hide its matches. `toggleMountedDirectoryFromInput` is the entry
// point the row click handler uses.
describe('file-tree search manual collapse overrides', () => {
  test('collapsing a matched directory hides its match but keeps the directory visible', async () => {
    const FileTreeController = await loadFileTreeController();

    const controller = new FileTreeController({
      fileTreeSearchMode: 'hide-non-matches',
      flattenEmptyDirectories: false,
      initialExpansion: 'open',
      paths: FILES,
    });

    controller.setSearch('worker.ts');
    expect(getVisiblePaths(controller)).toContain('src/utils/');
    expect(getVisiblePaths(controller)).toContain('src/utils/worker.ts');

    // Collapse the directory that holds the match. The directory stays visible.
    // The search hides the match until the override clears.
    controller.toggleMountedDirectoryFromInput('src/utils/');
    expect(getVisiblePaths(controller)).toContain('src/utils/');
    expect(getVisiblePaths(controller)).not.toContain('src/utils/worker.ts');

    // The match set does not change. Only the visible rows change.
    expect(controller.getSearchMatchingPaths()).toContain(
      'src/utils/worker.ts'
    );

    // A second toggle of the same directory clears the override. The default
    // search layout returns.
    controller.toggleMountedDirectoryFromInput('src/utils/');
    expect(getVisiblePaths(controller)).toContain('src/utils/worker.ts');

    controller.destroy();
  });

  test('clearing the search discards manual collapse overrides', async () => {
    const FileTreeController = await loadFileTreeController();

    const controller = new FileTreeController({
      fileTreeSearchMode: 'hide-non-matches',
      flattenEmptyDirectories: false,
      initialExpansion: 'open',
      paths: FILES,
    });

    controller.setSearch('worker.ts');
    controller.toggleMountedDirectoryFromInput('src/utils/');
    expect(getVisiblePaths(controller)).not.toContain('src/utils/worker.ts');

    // Close the search and run the same query again. The tree starts from the
    // default layout, not the previous override.
    controller.setSearch(null);
    controller.setSearch('worker.ts');
    expect(getVisiblePaths(controller)).toContain('src/utils/worker.ts');

    controller.destroy();
  });
});
