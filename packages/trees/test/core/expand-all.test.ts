import { describe, it } from 'bun:test';

import { expandAllFeature } from '../../src/features/expand-all/feature';
import { propMemoizationFeature } from '../../src/features/prop-memoization/feature';
import { TestTree } from './test-utils/test-tree';

const factory = TestTree.default({}).withFeatures(
  expandAllFeature,
  propMemoizationFeature
);

describe('core-feature/expand-all', () => {
  factory.forSuits((tree) => {
    describe('tree instance calls', () => {
      it('expands all', async () => {
        await tree.instance.expandAll();
        tree.expect.foldersExpanded('x12', 'x13', 'x14', 'x4', 'x41', 'x44');
      });

      it('collapses all', () => {
        tree.instance.collapseAll();
        tree.expect.foldersCollapsed('x1', 'x2', 'x3', 'x4');
      });

      it('cancels expanding all', async () => {
        const token = { current: true };
        await tree.instance.expandAll(token);
        token.current = false;
        tree.expect.foldersCollapsed('x2', 'x3', 'x4');
      });
    });

    describe('item instance calls', () => {
      it('expands all', async () => {
        await Promise.all([
          tree.instance.getItemInstance('x1').expandAll(),
          tree.instance.getItemInstance('x2').expandAll(),
          tree.instance.getItemInstance('x3').expandAll(),
          tree.instance.getItemInstance('x4').expandAll(),
        ]);
        tree.expect.foldersExpanded('x2', 'x21', 'x24');
      });

      it('collapses all', () => {
        tree.instance.collapseAll();
        tree.expect.foldersCollapsed('x1', 'x2', 'x3', 'x4');
      });
    });
  });
});
