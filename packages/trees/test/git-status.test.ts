import { describe, expect, spyOn, test } from 'bun:test';

import {
  getGitStatusMap,
  type GitStatusEntry,
} from '../src/features/gitStatusFeature';
import type { FileTreeNode } from '../src/types';
import { getGitStatusSignature } from '../src/utils/getGitStatusSignature';
import { createTestTree, TEST_CONFIGS } from './test-config';

const FILES = [
  'README.md',
  'package.json',
  'src/index.ts',
  'src/components/Button.tsx',
  'src/components/Card.tsx',
  'src/utils/worker.ts',
  'src/utils/stream.ts',
  'test/index.test.ts',
];

/** Files that produce flattened directories when flattenEmptyDirectories=true */
const FILES_WITH_FLATTENED = [
  'README.md',
  'package.json',
  'src/index.ts',
  'src/components/Button.tsx',
  'src/components/Card.tsx',
  'config/project/app.config.json',
  'deep/nested/only/child.ts',
];

const STATUSES: GitStatusEntry[] = [
  { path: 'src/index.ts', status: 'modified' },
  { path: 'src/components/Button.tsx', status: 'added' },
  { path: 'test/index.test.ts', status: 'deleted' },
];

const getItemByPath = (
  tree: ReturnType<typeof createTestTree>['tree'],
  path: string
) => tree.getItems().find((item) => item.getItemData().path === path);

for (const cfg of TEST_CONFIGS) {
  describe(`git status [${cfg.label}]`, () => {
    test('items with git status return correct status via getGitStatus()', () => {
      const ft = createTestTree(FILES, cfg, {
        gitStatus: STATUSES,
        initialExpandedItems: ['src', 'src/components', 'src/utils', 'test'],
      });

      const indexItem = ft.tree
        .getItems()
        .find((item) => item.getItemData().path === 'src/index.ts');
      expect(indexItem?.getGitStatus()).toBe('modified');

      const buttonItem = ft.tree
        .getItems()
        .find(
          (item) => item.getItemData().path === 'src/components/Button.tsx'
        );
      expect(buttonItem?.getGitStatus()).toBe('added');

      const testItem = ft.tree
        .getItems()
        .find((item) => item.getItemData().path === 'test/index.test.ts');
      expect(testItem?.getGitStatus()).toBe('deleted');
    });

    test('items without git status return null', () => {
      const ft = createTestTree(FILES, cfg, {
        gitStatus: STATUSES,
        initialExpandedItems: ['src', 'src/components'],
      });

      const cardItem = ft.tree
        .getItems()
        .find((item) => item.getItemData().path === 'src/components/Card.tsx');
      expect(cardItem?.getGitStatus()).toBeNull();

      const readmeItem = ft.tree
        .getItems()
        .find((item) => item.getItemData().path === 'README.md');
      expect(readmeItem?.getGitStatus()).toBeNull();
    });

    test('folders containing changed files report containsGitChange() === true', () => {
      const ft = createTestTree(FILES, cfg, {
        gitStatus: STATUSES,
        initialExpandedItems: ['src', 'src/components', 'src/utils', 'test'],
      });

      const srcFolder = ft.tree
        .getItems()
        .find((item) => item.getItemData().path === 'src');
      expect(srcFolder?.containsGitChange()).toBe(true);

      const testFolder = ft.tree
        .getItems()
        .find((item) => item.getItemData().path === 'test');
      expect(testFolder?.containsGitChange()).toBe(true);
    });

    test('nested ancestor folders report containsGitChange() transitively', () => {
      const ft = createTestTree(FILES, cfg, {
        gitStatus: [{ path: 'src/components/Button.tsx', status: 'added' }],
        initialExpandedItems: ['src', 'src/components'],
      });

      // src/components is the direct parent
      const componentsFolder = ft.tree
        .getItems()
        .find((item) => item.getItemData().path === 'src/components');
      expect(componentsFolder?.containsGitChange()).toBe(true);

      // src is the grandparent — should also be marked
      const srcFolder = ft.tree
        .getItems()
        .find((item) => item.getItemData().path === 'src');
      expect(srcFolder?.containsGitChange()).toBe(true);
    });

    test('empty/undefined git status returns null/false for all items', () => {
      const ft = createTestTree(FILES, cfg, {
        initialExpandedItems: ['src', 'src/components'],
      });

      for (const item of ft.tree.getItems()) {
        expect(item.getGitStatus()).toBeNull();
        expect(item.containsGitChange()).toBe(false);
      }
    });

    test('empty array git status returns null/false for all items', () => {
      const ft = createTestTree(FILES, cfg, {
        gitStatus: [],
        initialExpandedItems: ['src', 'src/components'],
      });

      for (const item of ft.tree.getItems()) {
        expect(item.getGitStatus()).toBeNull();
        expect(item.containsGitChange()).toBe(false);
      }
    });

    test('folders without changed descendants report containsGitChange() === false', () => {
      const ft = createTestTree(FILES, cfg, {
        gitStatus: [{ path: 'README.md', status: 'modified' }],
        initialExpandedItems: ['src', 'src/components', 'src/utils', 'test'],
      });

      const srcFolder = ft.tree
        .getItems()
        .find((item) => item.getItemData().path === 'src');
      expect(srcFolder?.containsGitChange()).toBe(false);

      const testFolder = ft.tree
        .getItems()
        .find((item) => item.getItemData().path === 'test');
      expect(testFolder?.containsGitChange()).toBe(false);
    });

    test('runtime updates with same gitStatus array reference refresh cached statuses', () => {
      const runtimeStatuses: GitStatusEntry[] = [
        { path: 'src/index.ts', status: 'modified' },
      ];
      const ft = createTestTree(FILES, cfg, {
        gitStatus: runtimeStatuses,
        initialExpandedItems: ['src'],
      });

      const getStatus = () =>
        getItemByPath(ft.tree, 'src/index.ts')?.getGitStatus();

      expect(getStatus()).toBe('modified');

      runtimeStatuses[0] = { path: 'src/index.ts', status: 'added' };

      ft.tree.setConfig((previous) => ({
        ...previous,
        gitStatus: runtimeStatuses,
        gitStatusSignature: getGitStatusSignature(runtimeStatuses),
      }));
      ft.tree.rebuildTree();

      expect(getStatus()).toBe('added');
    });

    test('unknown leaf paths can still mark known ancestor folders as changed', () => {
      const ft = createTestTree(FILES, cfg, {
        gitStatus: [{ path: 'src/new-file.ts', status: 'added' }],
        initialExpandedItems: ['src'],
      });

      const srcFolder = getItemByPath(ft.tree, 'src');
      expect(srcFolder?.containsGitChange()).toBe(true);
    });

    test('getGitStatusMap uses precomputed path map without walking tree children', () => {
      const ft = createTestTree(FILES, cfg, {
        gitStatus: STATUSES,
        initialExpandedItems: ['src', 'src/components', 'test'],
      });
      const retrieveChildrenSpy = spyOn(ft.tree, 'retrieveChildrenIds');
      retrieveChildrenSpy.mockClear();

      try {
        const map = getGitStatusMap(
          ft.tree as unknown as ReturnType<
            typeof import('@headless-tree/core').createTree<FileTreeNode>
          >
        );
        expect(map).not.toBeNull();
        expect(retrieveChildrenSpy).not.toHaveBeenCalled();
      } finally {
        retrieveChildrenSpy.mockRestore();
      }
    });

    // -----------------------------------------------------------------
    // getGitStatusMap — exercises the same code path as Root.tsx
    // -----------------------------------------------------------------
    describe('getGitStatusMap (Root.tsx code path)', () => {
      test('collapsed folders appear in foldersWithChanges', () => {
        // src is collapsed (not in initialExpandedItems) but should still
        // be in foldersWithChanges because its descendant has a status.
        const ft = createTestTree(FILES, cfg, {
          gitStatus: [{ path: 'src/components/Button.tsx', status: 'added' }],
          // No folders expanded — everything is collapsed
        });

        const map = getGitStatusMap(
          ft.tree as unknown as ReturnType<
            typeof import('@headless-tree/core').createTree<FileTreeNode>
          >
        );
        expect(map).not.toBeNull();

        // Find the src folder in the rendered items (it's visible even collapsed)
        const srcItem = ft.tree
          .getItems()
          .find((item) => item.getItemData().path === 'src');
        expect(srcItem).toBeDefined();
        expect(map!.foldersWithChanges.has(srcItem!.getId())).toBe(true);
      });

      test('statusById keys match rendered item IDs', () => {
        const ft = createTestTree(FILES, cfg, {
          gitStatus: STATUSES,
          initialExpandedItems: ['src', 'src/components', 'src/utils', 'test'],
        });

        const map = getGitStatusMap(
          ft.tree as unknown as ReturnType<
            typeof import('@headless-tree/core').createTree<FileTreeNode>
          >
        );
        expect(map).not.toBeNull();

        // Check that every rendered item with a git status has a matching
        // key in statusById
        for (const item of ft.tree.getItems()) {
          const status = item.getGitStatus();
          if (status != null) {
            expect(map!.statusById.get(item.getId())).toBe(status);
          }
        }
      });

      test('foldersWithChanges keys match rendered folder item IDs', () => {
        const ft = createTestTree(FILES, cfg, {
          gitStatus: STATUSES,
          initialExpandedItems: ['src', 'src/components', 'src/utils', 'test'],
        });

        const map = getGitStatusMap(
          ft.tree as unknown as ReturnType<
            typeof import('@headless-tree/core').createTree<FileTreeNode>
          >
        );
        expect(map).not.toBeNull();

        // Check that every rendered folder with containsGitChange has a
        // matching entry in foldersWithChanges
        for (const item of ft.tree.getItems()) {
          if (item.containsGitChange()) {
            expect(map!.foldersWithChanges.has(item.getId())).toBe(true);
          }
        }
      });
    });

    // -----------------------------------------------------------------
    // Flattened directory containsGitChange
    // -----------------------------------------------------------------
    if (cfg.flattenEmptyDirectories) {
      describe('flattened folder containsGitChange', () => {
        test('flattened folder containing a changed file reports containsGitChange', () => {
          const ft = createTestTree(FILES_WITH_FLATTENED, cfg, {
            gitStatus: [
              { path: 'config/project/app.config.json', status: 'added' },
            ],
          });

          // config/project is a flattened folder — find it in getItems()
          const flattenedFolder = ft.tree.getItems().find((item) => {
            const data = item.getItemData();
            return (
              data.children?.direct != null &&
              data.path.includes('config/project')
            );
          });
          expect(flattenedFolder).toBeDefined();
          expect(flattenedFolder!.containsGitChange()).toBe(true);
        });

        test('flattened folder getGitStatusMap matches containsGitChange', () => {
          const ft = createTestTree(FILES_WITH_FLATTENED, cfg, {
            gitStatus: [
              { path: 'config/project/app.config.json', status: 'added' },
            ],
          });

          const map = getGitStatusMap(
            ft.tree as unknown as ReturnType<
              typeof import('@headless-tree/core').createTree<FileTreeNode>
            >
          );
          expect(map).not.toBeNull();

          // The flattened folder visible in getItems() must have its ID
          // in foldersWithChanges
          const flattenedFolder = ft.tree.getItems().find((item) => {
            const data = item.getItemData();
            return (
              data.children?.direct != null &&
              data.path.includes('config/project')
            );
          });
          expect(flattenedFolder).toBeDefined();
          expect(map!.foldersWithChanges.has(flattenedFolder!.getId())).toBe(
            true
          );
        });

        test('deeply flattened folder chain reports containsGitChange on the rendered node', () => {
          const ft = createTestTree(FILES_WITH_FLATTENED, cfg, {
            gitStatus: [
              { path: 'deep/nested/only/child.ts', status: 'modified' },
            ],
          });

          // deep/nested/only is flattened into a single rendered node
          const deepFolder = ft.tree.getItems().find((item) => {
            const data = item.getItemData();
            return data.children?.direct != null && data.path.includes('deep');
          });
          expect(deepFolder).toBeDefined();
          expect(deepFolder!.containsGitChange()).toBe(true);

          const map = getGitStatusMap(
            ft.tree as unknown as ReturnType<
              typeof import('@headless-tree/core').createTree<FileTreeNode>
            >
          );
          expect(map).not.toBeNull();
          expect(map!.foldersWithChanges.has(deepFolder!.getId())).toBe(true);
        });
      });
    }

    // -----------------------------------------------------------------
    // Non-flattened folder containsGitChange (explicit test)
    // -----------------------------------------------------------------
    if (!cfg.flattenEmptyDirectories) {
      describe('non-flattened folder containsGitChange', () => {
        test('single-child folders report containsGitChange individually', () => {
          const ft = createTestTree(FILES_WITH_FLATTENED, cfg, {
            gitStatus: [
              { path: 'config/project/app.config.json', status: 'added' },
            ],
            initialExpandedItems: ['config', 'config/project'],
          });

          // Without flattening, config and config/project are separate folders
          const configFolder = ft.tree
            .getItems()
            .find((item) => item.getItemData().path === 'config');
          expect(configFolder).toBeDefined();
          expect(configFolder!.containsGitChange()).toBe(true);

          const projectFolder = ft.tree
            .getItems()
            .find((item) => item.getItemData().path === 'config/project');
          expect(projectFolder).toBeDefined();
          expect(projectFolder!.containsGitChange()).toBe(true);
        });

        test('deeply nested folders each report containsGitChange', () => {
          const ft = createTestTree(FILES_WITH_FLATTENED, cfg, {
            gitStatus: [
              { path: 'deep/nested/only/child.ts', status: 'modified' },
            ],
            initialExpandedItems: ['deep', 'deep/nested', 'deep/nested/only'],
          });

          for (const folderPath of [
            'deep',
            'deep/nested',
            'deep/nested/only',
          ]) {
            const folder = ft.tree
              .getItems()
              .find((item) => item.getItemData().path === folderPath);
            expect(folder).toBeDefined();
            expect(folder!.containsGitChange()).toBe(true);
          }
        });

        test('non-flattened getGitStatusMap matches containsGitChange', () => {
          const ft = createTestTree(FILES_WITH_FLATTENED, cfg, {
            gitStatus: [
              { path: 'config/project/app.config.json', status: 'added' },
            ],
            initialExpandedItems: ['config', 'config/project'],
          });

          const map = getGitStatusMap(
            ft.tree as unknown as ReturnType<
              typeof import('@headless-tree/core').createTree<FileTreeNode>
            >
          );
          expect(map).not.toBeNull();

          for (const folderPath of ['config', 'config/project']) {
            const folder = ft.tree
              .getItems()
              .find((item) => item.getItemData().path === folderPath);
            expect(folder).toBeDefined();
            expect(map!.foldersWithChanges.has(folder!.getId())).toBe(true);
          }
        });
      });
    }
  });
}
