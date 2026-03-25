import { describe, expect, it } from 'bun:test';

import { propMemoizationFeature } from '../../src/core/features/prop-memoization/feature';
import { renamingFeature } from '../../src/core/features/renaming/feature';
import { selectionFeature } from '../../src/core/features/selection/feature';
import { TestTree } from './test-utils/test-tree';

const factory = TestTree.default({}).withFeatures(
  renamingFeature,
  selectionFeature,
  propMemoizationFeature
);

describe('core-feature/renaming', () => {
  factory.forSuits((tree) => {
    it('starts and aborts renaming', () => {
      tree.item('x1').startRenaming();
      expect(tree.instance.isRenamingItem()).toBe(true);
      expect(tree.instance.getRenamingValue()).toBe('x1');
      tree.instance.abortRenaming();
      expect(tree.instance.isRenamingItem()).toBe(false);
    });

    it('stops renaming by blurring', () => {
      tree.item('x1').startRenaming();
      tree.instance.getRenamingItem()!.getRenameInputProps().onBlur();
      expect(tree.instance.isRenamingItem()).toBe(false);
    });

    it('completes renaming programmatically', () => {
      const onRename = tree.mockedHandler('onRename');

      tree.item('x1').startRenaming();
      expect(tree.instance.getRenamingItem()!.getRenameInputProps().value).toBe(
        'x1'
      );
      tree.instance
        .getRenamingItem()!
        .getRenameInputProps()
        .onChange({
          target: { value: 'renamed' },
        });
      expect(tree.instance.getRenamingItem()!.getRenameInputProps().value).toBe(
        'renamed'
      );
      tree.instance.completeRenaming();
      expect(onRename).toHaveBeenCalledWith(
        tree.instance.getItemInstance('x1'),
        'renamed'
      );
      expect(tree.instance.isRenamingItem()).toBe(false);
    });

    it('invokes state setters when aborting', () => {
      const setRenamingItem = tree.mockedHandler('setRenamingItem');
      const setRenamingValue = tree.mockedHandler('setRenamingValue');
      tree.item('x1').startRenaming();
      expect(setRenamingItem).toHaveBeenCalledWith('x1');
      expect(setRenamingValue).toHaveBeenCalledWith('x1');
      tree.instance.abortRenaming();
      expect(setRenamingItem).toHaveBeenCalledWith(null);
    });

    it('invokes state setters when completing', () => {
      const setRenamingItem = tree.mockedHandler('setRenamingItem');
      const setRenamingValue = tree.mockedHandler('setRenamingValue');
      tree.item('x1').startRenaming();
      tree.instance
        .getRenamingItem()!
        .getRenameInputProps()
        .onChange({
          target: { value: 'renamed' },
        });
      expect(setRenamingItem).toHaveBeenCalledWith('x1');
      expect(setRenamingValue).toHaveBeenCalledWith('renamed');
      tree.instance.completeRenaming();
      expect(setRenamingItem).toHaveBeenCalledWith(null);
    });

    it('changes renaming input content with input props', () => {
      const setRenamingValue = tree.mockedHandler('setRenamingValue');
      tree.item('x1').startRenaming();
      tree.instance
        .getRenamingItem()!
        .getRenameInputProps()
        .onChange({ target: { value: 'New Name' } });
      expect(setRenamingValue).toHaveBeenCalledWith('New Name');
    });

    it('aborts renaming with input props', () => {
      const setRenamingItem = tree.mockedHandler('setRenamingItem');
      tree.item('x1').startRenaming();
      tree.instance.getRenamingItem()!.getRenameInputProps().onBlur();
      expect(setRenamingItem).toHaveBeenCalledWith(null);
    });

    describe('dragging', () => {
      it('sets draggable to undefined for items being renamed', () => {
        const suiteTree = tree
          .withFeatures({
            key: 'drag-and-drop',
            itemInstance: {
              // oxlint-disable-next-line typescript-eslint/no-explicit-any, typescript-eslint/no-unsafe-return
              getProps: ({ prev }: any) => ({
                ...prev?.(),
                draggable: true,
                onDragStart: 'initialOnDragStart',
              }),
            },
          })
          .createTestCaseTree();

        const item = suiteTree.item('x1');
        item.startRenaming();
        const props = item.getProps();
        expect(props.draggable).toBe(false);
        expect(props.onDragStart).toStrictEqual(expect.any(Function));
      });

      it('retains draggable for items not being renamed', () => {
        const suiteTree = tree
          .withFeatures({
            key: 'drag-and-drop',
            itemInstance: {
              // oxlint-disable-next-line typescript-eslint/no-explicit-any, typescript-eslint/no-unsafe-return
              getProps: ({ prev }: any) => ({
                ...prev?.(),
                draggable: true,
                onDragStart: 'initialOnDragStart',
              }),
            },
          })
          .createTestCaseTree();

        const item = suiteTree.item('x1');
        const props = item.getProps();
        expect(props.draggable).toBe(true);
        expect(props.onDragStart).toBe('initialOnDragStart');
      });
    });

    describe('hotkeys', () => {
      it('starts renaming', () => {
        const setRenamingItem = tree.mockedHandler('setRenamingItem');
        tree.do.hotkey('renameItem');
        expect(setRenamingItem).toHaveBeenCalledWith('x1');
      });

      it('aborts renaming with Escape key', () => {
        const setRenamingItem = tree.mockedHandler('setRenamingItem');
        tree.item('x1').startRenaming();
        tree.do.hotkey('abortRenaming');
        expect(setRenamingItem).toHaveBeenCalledWith(null);
      });

      it('completes renaming with Enter key', () => {
        const onRename = tree.mockedHandler('onRename');
        tree.item('x1').startRenaming();
        tree.instance
          .getRenamingItem()!
          .getRenameInputProps()
          .onChange({
            target: { value: 'renamed' },
          });
        tree.do.hotkey('completeRenaming');
        expect(onRename).toHaveBeenCalledWith(
          tree.instance.getItemInstance('x1'),
          'renamed'
        );
      });
    });
  });
});
