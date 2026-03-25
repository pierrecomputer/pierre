import { describe, expect, it } from 'bun:test';

import { propMemoizationFeature } from '../../src/features/prop-memoization/feature';
import { selectionFeature } from '../../src/features/selection/feature';
import { TestTree } from './test-utils/test-tree';

const factory = TestTree.default({}).withFeatures(
  selectionFeature,
  propMemoizationFeature
);

describe('core-feature/selections', () => {
  it('test', () => {
    const tree = factory.suits.proxifiedSync().tree.createTestCaseTree();
    tree.do.selectItem('x111');
    expect(
      tree.instance.getItemInstance('x111').getProps()['aria-selected']
    ).toBe('true');
  });

  factory.forSuits((tree) => {
    it('sets aria-selected to false', () => {
      expect(
        tree.instance.getItemInstance('x111').getProps()['aria-selected']
      ).toBe('false');
    });

    it('sets aria-selected to true', () => {
      tree.do.selectItem('x111');
      expect(
        tree.instance.getItemInstance('x111').getProps()['aria-selected']
      ).toBe('true');
    });

    it('resets old selection after new select', () => {
      tree.do.selectItem('x111');
      tree.do.selectItem('x112');
      expect(
        tree.instance.getItemInstance('x111').getProps()['aria-selected']
      ).toBe('false');
      expect(
        tree.instance.getItemInstance('x112').getProps()['aria-selected']
      ).toBe('true');
      expect(tree.instance.getItemInstance('x111').isSelected()).toBe(false);
      expect(tree.instance.getItemInstance('x112').isSelected()).toBe(true);
    });

    describe('select and control select', () => {
      it('should make isSelected true', () => {
        tree.do.selectItem('x111');
        tree.do.ctrlSelectItem('x112');
        tree.do.ctrlSelectItem('x113');

        expect(tree.instance.getItemInstance('x111').isSelected()).toBe(true);
        expect(tree.instance.getItemInstance('x112').isSelected()).toBe(true);
        expect(tree.instance.getItemInstance('x113').isSelected()).toBe(true);
      });

      it('should call individual state setters', () => {
        const setSelectedItems = tree.mockedHandler('setSelectedItems');
        const setFocusedItem = tree.mockedHandler('setFocusedItem');

        tree.do.selectItem('x111');
        tree.do.ctrlSelectItem('x112');
        tree.do.ctrlSelectItem('x113');

        expect(setSelectedItems).toHaveBeenCalledWith(['x111', 'x112', 'x113']);
        expect(setFocusedItem).toHaveBeenCalledWith('x113');
      });

      it('should call joint state setter', () => {
        const setState = tree.mockedHandler('setState');

        tree.do.selectItem('x111');
        tree.do.ctrlSelectItem('x112');
        tree.do.ctrlSelectItem('x113');

        expect(setState).toHaveBeenCalledWith(
          expect.objectContaining({
            selectedItems: ['x111', 'x112', 'x113'],
            focusedItem: 'x113',
          })
        );
      });
    });

    describe('shift select', () => {
      it('should make isSelected true', () => {
        tree.do.selectItem('x111');
        tree.do.shiftSelectItem('x113');
        tree.do.ctrlSelectItem('x2');

        expect(tree.instance.getItemInstance('x111').isSelected()).toBe(true);
        expect(tree.instance.getItemInstance('x112').isSelected()).toBe(true);
        expect(tree.instance.getItemInstance('x113').isSelected()).toBe(true);
        expect(tree.instance.getItemInstance('x2').isSelected()).toBe(true);
      });

      it('should call individual state setters', () => {
        const setSelectedItems = tree.mockedHandler('setSelectedItems');
        const setFocusedItem = tree.mockedHandler('setFocusedItem');

        tree.do.selectItem('x111');
        tree.do.shiftSelectItem('x113');
        expect(setFocusedItem).toHaveBeenCalledWith('x113');

        tree.do.ctrlSelectItem('x2');

        expect(setSelectedItems).toHaveBeenCalledWith([
          'x111',
          'x112',
          'x113',
          'x2',
        ]);

        expect(setFocusedItem).toHaveBeenCalledWith('x2');
      });

      it('should call joint state setter', () => {
        const setState = tree.mockedHandler('setState');

        tree.do.selectItem('x111');
        tree.do.shiftSelectItem('x113');
        expect(setState).toHaveBeenCalledWith(
          expect.objectContaining({
            selectedItems: ['x111', 'x112', 'x113'],
            focusedItem: 'x113',
          })
        );

        tree.do.ctrlSelectItem('x2');

        expect(setState).toHaveBeenCalledWith(
          expect.objectContaining({
            selectedItems: ['x111', 'x112', 'x113', 'x2'],
            focusedItem: 'x2',
          })
        );
      });
    });

    describe('programmatic select', () => {
      describe('item instance actions', () => {
        it('should handle select', () => {
          const setSelectedItems = tree.mockedHandler('setSelectedItems');
          tree.instance.getItemInstance('x111').select();
          expect(setSelectedItems).toHaveBeenCalledWith(['x111']);
          expect(tree.instance.getItemInstance('x111').isSelected()).toBe(true);
        });

        it('should handle deselect', () => {
          const setSelectedItems = tree.mockedHandler('setSelectedItems');
          tree.instance.getItemInstance('x111').select();
          tree.instance.getItemInstance('x111').deselect();
          expect(setSelectedItems).toHaveBeenCalledWith([]);
          expect(tree.instance.getItemInstance('x111').isSelected()).toBe(
            false
          );
        });

        it('should handle toggle select on', () => {
          const setSelectedItems = tree.mockedHandler('setSelectedItems');
          tree.instance.getItemInstance('x111').toggleSelect();
          expect(setSelectedItems).toHaveBeenCalledWith(['x111']);
          expect(tree.instance.getItemInstance('x111').isSelected()).toBe(true);
        });

        it('should handle toggle select off', () => {
          const setSelectedItems = tree.mockedHandler('setSelectedItems');
          tree.instance.getItemInstance('x111').select();
          tree.instance.getItemInstance('x111').toggleSelect();
          expect(setSelectedItems).toHaveBeenCalledWith([]);
          expect(tree.instance.getItemInstance('x111').isSelected()).toBe(
            false
          );
        });

        it('should handle selectUpTo without ctrl', () => {
          const setSelectedItems = tree.mockedHandler('setSelectedItems');
          tree.do.ctrlSelectItem('x111');
          tree.do.ctrlSelectItem('x112');
          tree.instance.getItemInstance('x114').selectUpTo(false);
          expect(setSelectedItems).toHaveBeenCalledWith([
            'x112',
            'x113',
            'x114',
          ]);
          expect(tree.instance.getItemInstance('x112').isSelected()).toBe(true);
        });

        it('should handle selectUpTo with ctrl', () => {
          const setSelectedItems = tree.mockedHandler('setSelectedItems');
          tree.do.ctrlSelectItem('x111');
          tree.do.ctrlSelectItem('x112');
          tree.instance.getItemInstance('x114').selectUpTo(true);
          expect(setSelectedItems).toHaveBeenCalledWith([
            'x111',
            'x112',
            'x113',
            'x114',
          ]);
          expect(tree.instance.getItemInstance('x112').isSelected()).toBe(true);
        });
      });

      it('should handle getters', () => {
        const setSelectedItems = tree.mockedHandler('setSelectedItems');
        tree.instance.setSelectedItems(['x111', 'x112']);
        expect(setSelectedItems).toHaveBeenCalledWith(['x111', 'x112']);
        expect(tree.instance.getItemInstance('x111').isSelected()).toBe(true);
        expect(tree.instance.getItemInstance('x112').isSelected()).toBe(true);
        expect(tree.instance.getSelectedItems()[0].getId()).toEqual('x111');
        expect(tree.instance.getSelectedItems()[1].getId()).toEqual('x112');
        expect(tree.instance.getSelectedItems().length).toBe(2);
      });
    });
  });
});
