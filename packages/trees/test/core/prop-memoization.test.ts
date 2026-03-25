import { describe, expect, it, mock } from 'bun:test';

import type { FeatureImplementation } from '../../src/core/types/core';
import { propMemoizationFeature } from '../../src/features/prop-memoization/feature';
import { TestTree } from './test-utils/test-tree';

const itemHandler = mock(() => {});
const treeHandler = mock(() => {});
// oxlint-disable-next-line typescript-eslint/no-explicit-any
const createItemValue: ReturnType<typeof mock<any>> = mock(() => {});
// oxlint-disable-next-line typescript-eslint/no-explicit-any
const createTreeValue: ReturnType<typeof mock<any>> = mock(() => {});

const customFeature: FeatureImplementation = {
  itemInstance: {
    // oxlint-disable-next-line typescript-eslint/no-unsafe-return
    getProps: ({ prev }) => ({
      ...prev?.(),
      customValue: createItemValue(),
      onCustomEvent: () => itemHandler(),
    }),
  },
  treeInstance: {
    // oxlint-disable-next-line typescript-eslint/no-unsafe-return
    getContainerProps: ({ prev }, treeLabel) => ({
      ...prev?.(treeLabel),
      customValue: createTreeValue(),
      onCustomEvent: () => treeHandler(),
    }),
  },
};

const factory = TestTree.default({}).withFeatures(
  customFeature,
  propMemoizationFeature
);

describe('core-feature/prop-memoization', () => {
  it('memoizes props', () => {
    const tree = factory.suits.sync().tree.createTestCaseTree();
    createTreeValue.mockReturnValue(123);
    expect(tree.instance.getContainerProps().onCustomEvent).toBe(
      tree.instance.getContainerProps().onCustomEvent
    );
    expect(tree.instance.getContainerProps().customValue).toBe(123);
    expect(tree.instance.getContainerProps().customValue).toBe(123);
  });
  factory.forSuits((tree) => {
    describe('tree props', () => {
      it('memoizes props', () => {
        createTreeValue.mockReturnValue(123);
        expect(tree.instance.getContainerProps().onCustomEvent).toBe(
          tree.instance.getContainerProps().onCustomEvent
        );
        expect(tree.instance.getContainerProps().customValue).toBe(123);
        expect(tree.instance.getContainerProps().customValue).toBe(123);
      });

      it('doesnt return stale values', () => {
        createTreeValue.mockReturnValueOnce(123);
        createTreeValue.mockReturnValueOnce(456);
        expect(tree.instance.getContainerProps().customValue).toBe(123);
        expect(tree.instance.getContainerProps().customValue).toBe(456);
      });

      it('propagates calls properly', () => {
        treeHandler.mockClear();
        tree.instance.getContainerProps().onCustomEvent();
        tree.instance.getContainerProps().onCustomEvent();
        expect(treeHandler).toHaveBeenCalledTimes(2);
      });
    });
  });
});
