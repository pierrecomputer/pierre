import { describe, expect, it, mock } from 'bun:test';

import { propMemoizationFeature } from '../../src/features/prop-memoization/feature';
import { TestTree } from './test-utils/test-tree';

const factory = TestTree.default({}).withFeatures(propMemoizationFeature);

describe('core-feature/tree', () => {
  factory.forSuits((tree, title) => {
    describe('expanded items', () => {
      it('can expand via tree instance', () => {
        const setExpandedItems = tree.mockedHandler('setExpandedItems');
        tree.item('x2').expand();
        expect(setExpandedItems).toHaveBeenCalledWith(['x1', 'x11', 'x2']);
      });

      it('can expand via item', () => {
        const setExpandedItems = tree.mockedHandler('setExpandedItems');
        tree.instance.getItemInstance('x2').expand();
        expect(setExpandedItems).toHaveBeenCalledWith(['x1', 'x11', 'x2']);
      });

      it('returns correct isItemExpanded value', () => {
        expect(tree.item('x2').isExpanded()).toBe(false);
        tree.item('x2').expand();
        expect(tree.item('x2').isExpanded()).toBe(true);
      });

      it('calls setState', () => {
        const setState = tree.mockedHandler('setState');
        tree.item('x2').expand();
        expect(setState).toHaveBeenCalledWith(
          expect.objectContaining({ expandedItems: ['x1', 'x11', 'x2'] })
        );
      });

      it('expands on click', () => {
        const setExpandedItems = tree.mockedHandler('setExpandedItems');
        tree.do.selectItem('x2');
        expect(setExpandedItems).toHaveBeenCalledWith(['x1', 'x11', 'x2']);
      });
    });

    describe('collapsed items', () => {
      it('can collapse via tree instance', () => {
        const setExpandedItems = tree.mockedHandler('setExpandedItems');
        tree.item('x1').collapse();
        expect(setExpandedItems).toHaveBeenCalledWith(['x11']);
      });

      it('can collapse via item', () => {
        const setExpandedItems = tree.mockedHandler('setExpandedItems');
        tree.instance.getItemInstance('x1').collapse();
        expect(setExpandedItems).toHaveBeenCalledWith(['x11']);
      });

      it('returns correct isItemExpanded value', () => {
        expect(tree.item('x1').isExpanded()).toBe(true);
        tree.item('x1').collapse();
        expect(tree.item('x1').isExpanded()).toBe(false);
      });

      it('calls setState', () => {
        const setState = tree.mockedHandler('setState');
        tree.item('x1').collapse();
        expect(setState).toHaveBeenCalledWith(
          expect.objectContaining({ expandedItems: ['x11'] })
        );
      });

      it('collapses on click', () => {
        const setExpandedItems = tree.mockedHandler('setExpandedItems');
        tree.do.selectItem('x1');
        expect(setExpandedItems).toHaveBeenCalledWith(['x11']);
      });
    });

    describe('focused item', () => {
      it('focuses item', () => {
        const setFocusedItem = tree.mockedHandler('setFocusedItem');
        tree.item('x11').setFocused();
        expect(setFocusedItem).toHaveBeenCalledWith('x11');
      });

      it('returns correct initial focused item', () => {
        expect(tree.instance.getFocusedItem().getId()).toBe('x1');
      });

      it('returns correct focused item', () => {
        tree.item('x11').setFocused();
        expect(tree.instance.getFocusedItem().getId()).toBe('x11');
      });

      it('calls setState', () => {
        const setState = tree.mockedHandler('setState');
        tree.item('x1').setFocused();
        expect(setState).toHaveBeenCalledWith(
          expect.objectContaining({ focusedItem: 'x1' })
        );
      });

      it('updates dom focus', async () => {
        const scrollToItem = tree.mockedHandler('scrollToItem');
        const element = { focus: mock(() => {}) };
        // oxlint-disable-next-line typescript-eslint/no-explicit-any
        tree.instance.getItemInstance('x2').registerElement(element as any);
        tree.item('x2').setFocused();
        tree.instance.updateDomFocus();
        // Wait a tick for the setTimeout in updateDomFocus
        await new Promise((r) => setTimeout(r, 50));
        expect(scrollToItem).toHaveBeenCalledWith(
          tree.instance.getFocusedItem()
        );
        expect(element.focus).toHaveBeenCalled();
      });

      describe('move focus', () => {
        it('focuses next item', () => {
          tree.item('x2').setFocused();
          const setFocusedItem = tree.mockedHandler('setFocusedItem');
          tree.instance.focusNextItem();
          expect(setFocusedItem).toHaveBeenCalledWith('x3');
        });

        it('focuses previous item', () => {
          tree.item('x2').setFocused();
          const setFocusedItem = tree.mockedHandler('setFocusedItem');
          tree.instance.focusPreviousItem();
          expect(setFocusedItem).toHaveBeenCalledWith('x14');
        });

        it('remains at last item when focus is at bottom', () => {
          tree.item('x4').setFocused();
          const setFocusedItem = tree.mockedHandler('setFocusedItem');
          tree.instance.focusNextItem();
          expect(setFocusedItem).toHaveBeenCalledWith('x4');
          expect(setFocusedItem).toHaveBeenCalledTimes(1);
        });

        it('remains at first item when focus is at top', () => {
          tree.item('x1').setFocused();
          const setFocusedItem = tree.mockedHandler('setFocusedItem');
          tree.instance.focusPreviousItem();
          expect(setFocusedItem).toHaveBeenCalledWith('x1');
          expect(setFocusedItem).toHaveBeenCalledTimes(1);
        });
      });
    });

    describe('items meta', () => {
      it('root item', () => {
        expect(tree.instance.getItemInstance('x').getItemMeta()).toEqual({
          index: -1,
          itemId: 'x',
          level: -1,
          parentId: null,
          posInSet: 0,
          setSize: 1,
        });
      });

      it('unloaded item', () => {
        expect(tree.instance.getItemInstance('x444').getItemMeta()).toEqual({
          index: -1,
          itemId: 'x444',
          level: -1,
          parentId: null,
          posInSet: 0,
          setSize: 1,
        });
      });

      it('expanded container', () => {
        expect(tree.instance.getItemInstance('x11').getItemMeta()).toEqual({
          index: 1,
          itemId: 'x11',
          level: 1,
          parentId: 'x1',
          posInSet: 0,
          setSize: 4,
        });
      });

      it('top leaf', () => {
        expect(tree.instance.getItemInstance('x111').getItemMeta()).toEqual({
          index: 2,
          itemId: 'x111',
          level: 2,
          parentId: 'x11',
          posInSet: 0,
          setSize: 4,
        });
      });

      it('middle leaf', () => {
        expect(tree.instance.getItemInstance('x112').getItemMeta()).toEqual({
          index: 3,
          itemId: 'x112',
          level: 2,
          parentId: 'x11',
          posInSet: 1,
          setSize: 4,
        });
      });

      it('bottom leaf', () => {
        expect(tree.instance.getItemInstance('x114').getItemMeta()).toEqual({
          index: 5,
          itemId: 'x114',
          level: 2,
          parentId: 'x11',
          posInSet: 3,
          setSize: 4,
        });
      });

      it('item after expanded contents', () => {
        expect(tree.instance.getItemInstance('x2').getItemMeta()).toEqual({
          index: 9,
          itemId: 'x2',
          level: 0,
          parentId: 'x',
          posInSet: 1,
          setSize: 4,
        });
      });

      it('last item', () => {
        expect(tree.instance.getItemInstance('x2').getItemMeta()).toEqual({
          index: 9,
          itemId: 'x2',
          level: 0,
          parentId: 'x',
          posInSet: 1,
          setSize: 4,
        });
      });
    });

    describe('props generation', () => {
      it('generates container props', () => {
        expect(tree.instance.getContainerProps()).toEqual(
          expect.objectContaining({
            role: 'tree',
          })
        );
      });

      it('generates item props for random item', () => {
        expect(tree.instance.getItemInstance('x2').getProps()).toEqual({
          'aria-label': 'x2',
          'aria-level': 1,
          'aria-posinset': 2,
          'aria-selected': 'false',
          'aria-setsize': 4,
          'aria-expanded': false,
          onClick: expect.any(Function),
          ref: expect.any(Function),
          role: 'treeitem',
          tabIndex: -1,
        });
      });

      it('generates item props for focused', () => {
        expect(tree.instance.getItemInstance('x1').getProps()).toEqual({
          'aria-label': 'x1',
          'aria-level': 1,
          'aria-posinset': 1,
          'aria-selected': 'false',
          'aria-setsize': 4,
          'aria-expanded': true,
          onClick: expect.any(Function),
          ref: expect.any(Function),
          role: 'treeitem',
          tabIndex: 0,
        });
      });

      it('generates aria-expanded for non expanded folder', () => {
        expect(tree.instance.getItemInstance('x3').getProps()).toEqual(
          expect.objectContaining({
            'aria-expanded': false,
          })
        );
      });

      it('generates aria-expanded for leaf', () => {
        expect(tree.instance.getItemInstance('x111').getProps()).toEqual(
          expect.objectContaining({
            'aria-expanded': undefined,
          })
        );
      });
    });

    describe('util functions', () => {
      it('returns correctly for getId()', () => {
        expect(tree.instance.getItemInstance('x2').getId()).toBe('x2');
      });

      it('returns correctly for getItemName()', () => {
        expect(tree.instance.getItemInstance('x2').getItemName()).toBe('x2');
      });

      it('returns correctly for getItemData()', () => {
        expect(tree.instance.getItemInstance('x2').getItemData()).toBe('x2');
      });

      it('returns correctly for true cases of isExpanded()', () => {
        expect(tree.instance.getItemInstance('x1').isExpanded()).toBe(true);
      });

      it('returns correctly for false cases of isExpanded()', () => {
        expect(tree.instance.getItemInstance('x12').isExpanded()).toBe(false);
      });

      it('returns correctly for direct descendants of isDescendentOf()', () => {
        expect(
          tree.instance.getItemInstance('x111').isDescendentOf('x11')
        ).toBe(true);
      });

      it('returns correctly for indirect descendants of isDescendentOf()', () => {
        expect(tree.instance.getItemInstance('x111').isDescendentOf('x')).toBe(
          true
        );
      });

      it('returns correctly for non-descendants of isDescendentOf()', () => {
        expect(tree.instance.getItemInstance('x12').isDescendentOf('x2')).toBe(
          false
        );
      });

      it('returns correctly for true cases of isFocused()', () => {
        expect(tree.instance.getItemInstance('x1').isFocused()).toBe(true);
      });

      it('returns correctly for false cases of isFocused()', () => {
        expect(tree.instance.getItemInstance('x2').isFocused()).toBe(false);
      });

      it('returns correctly for true cases of isFolder()', () => {
        expect(tree.instance.getItemInstance('x1').isFolder()).toBe(true);
      });

      it('returns correctly for true cases of isFolder() ', () => {
        expect(tree.instance.getItemInstance('x1').isFolder()).toBe(true);
      });

      it('returns correct isFolder for hidden items', () => {
        if (title.toLocaleLowerCase().includes('async')) {
          // async test tree defaults to "loading" item names
          return;
        }
        const testTree = tree
          .with({
            // oxlint-disable-next-line typescript-eslint/no-explicit-any
            isItemFolder: (item: any) => item.getItemData().length < 4,
          })
          .createTestCaseTree();

        // Reference: https://github.com/lukasbach/headless-tree/issues/166
        expect(testTree.instance.getItemInstance('x44').isFolder()).toBe(true);
        expect(testTree.instance.getItemInstance('x444').isFolder()).toBe(
          false
        );
      });

      it('returns isFolder=true for root item', () => {
        expect(tree.instance.getItemInstance('x').isFolder()).toBe(true);
      });

      it('returns correctly for getParent()', () => {
        expect(tree.instance.getItemInstance('x111').getParent()?.getId()).toBe(
          'x11'
        );
      });

      it('returns correctly for getChildren()', () => {
        const childIds = tree.instance
          .getItemInstance('x1')
          .getChildren()
          // oxlint-disable-next-line typescript-eslint/no-unsafe-return
          .map((i) => i.getId());
        expect(childIds).toEqual(['x11', 'x12', 'x13', 'x14']);
      });

      it('returns correctly for getIndexInParent()', () => {
        expect(tree.instance.getItemInstance('x113').getIndexInParent()).toBe(
          2
        );
      });

      it('returns correctly for getTree()', () => {
        expect(tree.instance.getItemInstance('x111').getTree()).toBe(
          tree.instance
        );
      });
    });

    describe('primary action', () => {
      it('calls primary action', () => {
        const onPrimaryAction = tree.mockedHandler('onPrimaryAction');
        tree.instance.getItemInstance('x2').primaryAction();
        expect(onPrimaryAction).toHaveBeenCalledWith(
          tree.instance.getItemInstance('x2')
        );
      });
    });

    describe('item above/below', () => {
      it('returns correctly for getItemAbove()', () => {
        expect(
          tree.instance.getItemInstance('x12').getItemAbove()?.getId()
        ).toBe('x114');
      });

      it('returns correctly for getItemAbove() at top', () => {
        expect(tree.instance.getItemInstance('x1').getItemAbove()).toBe(
          undefined
        );
      });

      it('returns correctly for getItemBelow()', () => {
        expect(
          tree.instance.getItemInstance('x14').getItemBelow()?.getId()
        ).toBe('x2');
      });

      it('returns correctly for getItemBelow() at bottom', () => {
        expect(tree.instance.getItemInstance('x4').getItemBelow()).toBe(
          undefined
        );
      });
    });

    describe('hotkeys', () => {
      it('focuses next item', () => {
        const setFocusedItem = tree.mockedHandler('setFocusedItem');
        tree.do.selectItem('x112');
        tree.do.hotkey('focusNextItem');
        expect(setFocusedItem).toHaveBeenCalledWith('x113');
      });

      it('focuses previous item', () => {
        const setFocusedItem = tree.mockedHandler('setFocusedItem');
        tree.do.selectItem('x112');
        tree.do.hotkey('focusPreviousItem');
        expect(setFocusedItem).toHaveBeenCalledWith('x111');
      });

      it('runs expandOrDown for expandable folder', () => {
        const setExpandedItems = tree.mockedHandler('setExpandedItems');
        const setFocusedItem = tree.mockedHandler('setFocusedItem');
        tree.do.ctrlSelectItem('x2');
        setFocusedItem.mockClear();
        tree.do.hotkey('expandOrDown');
        expect(setExpandedItems).toHaveBeenCalledWith(['x1', 'x11', 'x2']);
        expect(setFocusedItem).not.toHaveBeenCalled();
      });

      it('runs expandOrDown for expanded folder', () => {
        const setExpandedItems = tree.mockedHandler('setExpandedItems');
        const setFocusedItem = tree.mockedHandler('setFocusedItem');
        tree.do.ctrlSelectItem('x1');
        setFocusedItem.mockClear();
        tree.do.hotkey('expandOrDown');
        expect(setExpandedItems).not.toHaveBeenCalled();
        expect(setFocusedItem).toHaveBeenCalledWith('x11');
      });

      it('runs expandOrDown for non-folder item', () => {
        const setExpandedItems = tree.mockedHandler('setExpandedItems');
        const setFocusedItem = tree.mockedHandler('setFocusedItem');
        tree.do.selectItem('x111');
        setFocusedItem.mockClear();
        tree.do.hotkey('expandOrDown');
        expect(setExpandedItems).not.toHaveBeenCalled();
        expect(setFocusedItem).toHaveBeenCalledWith('x112');
      });

      it('runs collapseOrUp for expanded folder', () => {
        const setExpandedItems = tree.mockedHandler('setExpandedItems');
        const setFocusedItem = tree.mockedHandler('setFocusedItem');
        tree.do.ctrlSelectItem('x1');
        setFocusedItem.mockClear();
        tree.do.hotkey('collapseOrUp');
        expect(setExpandedItems).toHaveBeenCalledWith(['x11']);
        expect(setFocusedItem).not.toHaveBeenCalled();
      });

      it('runs collapseOrUp for collapsed folder', () => {
        const setExpandedItems = tree.mockedHandler('setExpandedItems');
        const setFocusedItem = tree.mockedHandler('setFocusedItem');
        tree.do.ctrlSelectItem('x2');
        setFocusedItem.mockClear();
        tree.do.hotkey('collapseOrUp');
        expect(setExpandedItems).toHaveBeenCalledWith(['x1', 'x11']);
        expect(setFocusedItem).not.toHaveBeenCalled();
      });

      it('runs collapseOrUp for non-folder item', () => {
        const setExpandedItems = tree.mockedHandler('setExpandedItems');
        const setFocusedItem = tree.mockedHandler('setFocusedItem');
        tree.do.ctrlSelectItem('x112');
        setFocusedItem.mockClear();
        tree.do.hotkey('collapseOrUp');
        expect(setExpandedItems).not.toHaveBeenCalled();
        expect(setFocusedItem).toHaveBeenCalledWith('x11');
      });

      it('runs focusFirstItem', () => {
        const setFocusedItem = tree.mockedHandler('setFocusedItem');
        tree.do.selectItem('x2');
        setFocusedItem.mockClear();
        tree.do.hotkey('focusFirstItem');
        expect(setFocusedItem).toHaveBeenCalledWith('x1');
      });

      it('runs focusLastItem', () => {
        const setFocusedItem = tree.mockedHandler('setFocusedItem');
        tree.do.selectItem('x2');
        setFocusedItem.mockClear();
        tree.do.hotkey('focusLastItem');
        expect(setFocusedItem).toHaveBeenCalledWith('x4');
      });
    });
  });

  describe('empty rootItemId', () => {
    factory.with({ rootItemId: '' }).forSuits((tree) => {
      describe('focused item', () => {
        it('returns correct initial focused item', () => {
          expect(tree.instance.getFocusedItem().getId()).toBe('1');
        });
      });
    });
  });
});
