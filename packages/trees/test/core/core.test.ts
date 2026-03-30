import { describe, expect, it, mock } from 'bun:test';

import { buildStaticInstance } from '../../src/core/build-static-instance';
import { TestTree } from './test-utils/test-tree';

declare module '../../src/core/types/core' {
  // oxlint-disable-next-line eslint/no-unused-vars
  export interface TreeInstance<T> {
    customHandler: (param1: number, param2: number) => number;
  }
  // oxlint-disable-next-line eslint/no-unused-vars
  export interface ItemInstance<T> {
    customHandler: (param1: number, param2: number) => number;
  }
}

// oxlint-disable-next-line typescript-eslint/no-explicit-any, typescript-eslint/no-unsafe-return
const handler1 = mock(({ prev }: any, ...params: any[]) => prev?.(...params));
// oxlint-disable-next-line typescript-eslint/no-explicit-any, typescript-eslint/no-unsafe-return
const handler2 = mock(({ prev }: any, ...params: any[]) => prev?.(...params));

const factory = TestTree.default({});

describe('core/feature-composition', () => {
  factory.forSuits((tree) => {
    describe('rebuilds item instance', () => {
      it('rebuilds when explicitly invoked', () => {
        const instanceBuilder = mock(buildStaticInstance);
        const testTree = tree.with({ instanceBuilder }).createTestCaseTree();
        expect(instanceBuilder).toHaveBeenCalled();
        instanceBuilder.mockClear();
        testTree.instance.rebuildTree();
        // if tree structure doesnt mutate, only root tree item is rebuilt actually
        expect(instanceBuilder).toHaveBeenCalled();
      });

      it('rebuilds when config changes with new expanded items', () => {
        const instanceBuilder = mock(buildStaticInstance);
        const testTree = tree.with({ instanceBuilder }).createTestCaseTree();
        expect(instanceBuilder).toHaveBeenCalled();
        instanceBuilder.mockClear();
        // oxlint-disable-next-line typescript-eslint/no-unsafe-return
        testTree.instance.setConfig((oldCfg) => ({
          ...oldCfg,
          state: {
            expandedItems: ['x4'],
          },
        }));
        expect(instanceBuilder).toHaveBeenCalled();
      });
    });

    describe('calls prev in correct order', () => {
      it('tree instance with overwrite marks, order 1', () => {
        const testTree = tree
          .withFeatures(
            {
              key: 'feature2',
              overwrites: ['feature1'],
              treeInstance: {
                customHandler: handler1,
              },
            },
            {
              key: 'feature1',
              treeInstance: {
                customHandler: () => 123,
              },
            },
            {
              key: 'feature3',
              overwrites: ['feature2'],
              treeInstance: {
                customHandler: handler2,
              },
            }
          )
          .createTestCaseTree();

        expect(testTree.instance.customHandler(1, 2)).toBe(123);
        // handler2 should be called before handler1 (outermost wrapper runs first)
        const handler2CallOrder =
          handler2.mock.invocationCallOrder[
            handler2.mock.invocationCallOrder.length - 1
          ];
        const handler1CallOrder =
          handler1.mock.invocationCallOrder[
            handler1.mock.invocationCallOrder.length - 1
          ];
        expect(handler2CallOrder).toBeLessThan(handler1CallOrder);
        expect(handler1).toHaveBeenCalledWith(expect.anything(), 1, 2);
        expect(handler2).toHaveBeenCalledWith(expect.anything(), 1, 2);
      });

      it('tree instance with overwrite marks, order 2', () => {
        const testTree = tree
          .withFeatures(
            {
              key: 'feature3',
              overwrites: ['feature2'],
              treeInstance: {
                customHandler: handler2,
              },
            },
            {
              key: 'feature2',
              overwrites: ['feature1'],
              treeInstance: {
                customHandler: handler1,
              },
            },
            {
              key: 'feature1',
              treeInstance: {
                customHandler: () => 123,
              },
            }
          )
          .createTestCaseTree();

        expect(testTree.instance.customHandler(1, 2)).toBe(123);
        const handler2CallOrder =
          handler2.mock.invocationCallOrder[
            handler2.mock.invocationCallOrder.length - 1
          ];
        const handler1CallOrder =
          handler1.mock.invocationCallOrder[
            handler1.mock.invocationCallOrder.length - 1
          ];
        expect(handler2CallOrder).toBeLessThan(handler1CallOrder);
        expect(handler1).toHaveBeenCalledWith(expect.anything(), 1, 2);
        expect(handler2).toHaveBeenCalledWith(expect.anything(), 1, 2);
      });

      it('tree instance with implicit order', () => {
        const testTree = tree
          .withFeatures(
            {
              key: 'feature1',
              treeInstance: {
                customHandler: () => 123,
              },
            },
            {
              key: 'feature2',
              treeInstance: {
                customHandler: handler1,
              },
            },
            {
              key: 'feature3',
              treeInstance: {
                customHandler: handler2,
              },
            }
          )
          .createTestCaseTree();

        expect(testTree.instance.customHandler(1, 2)).toBe(123);
        const handler2CallOrder =
          handler2.mock.invocationCallOrder[
            handler2.mock.invocationCallOrder.length - 1
          ];
        const handler1CallOrder =
          handler1.mock.invocationCallOrder[
            handler1.mock.invocationCallOrder.length - 1
          ];
        expect(handler2CallOrder).toBeLessThan(handler1CallOrder);
        expect(handler1).toHaveBeenCalledWith(expect.anything(), 1, 2);
        expect(handler2).toHaveBeenCalledWith(expect.anything(), 1, 2);
      });

      it('item instance with overwrite marks, order 1', () => {
        const testTree = tree
          .withFeatures(
            {
              key: 'feature2',
              overwrites: ['feature1'],
              itemInstance: {
                customHandler: handler1,
              },
            },
            {
              key: 'feature1',
              itemInstance: {
                customHandler: () => 123,
              },
            },
            {
              key: 'feature3',
              overwrites: ['feature2'],
              itemInstance: {
                customHandler: handler2,
              },
            }
          )
          .createTestCaseTree();

        expect(testTree.item('x111').customHandler(1, 2)).toBe(123);
        const handler2CallOrder =
          handler2.mock.invocationCallOrder[
            handler2.mock.invocationCallOrder.length - 1
          ];
        const handler1CallOrder =
          handler1.mock.invocationCallOrder[
            handler1.mock.invocationCallOrder.length - 1
          ];
        expect(handler2CallOrder).toBeLessThan(handler1CallOrder);
        expect(handler1).toHaveBeenCalledWith(expect.anything(), 1, 2);
        expect(handler2).toHaveBeenCalledWith(expect.anything(), 1, 2);
      });

      it('item instance with overwrite marks, order 2', () => {
        const testTree = tree
          .withFeatures(
            {
              key: 'feature3',
              overwrites: ['feature2'],
              itemInstance: {
                customHandler: handler2,
              },
            },
            {
              key: 'feature2',
              overwrites: ['feature1'],
              itemInstance: {
                customHandler: handler1,
              },
            },
            {
              key: 'feature1',
              itemInstance: {
                customHandler: () => 123,
              },
            }
          )
          .createTestCaseTree();

        expect(testTree.item('x111').customHandler(1, 2)).toBe(123);
        const handler2CallOrder =
          handler2.mock.invocationCallOrder[
            handler2.mock.invocationCallOrder.length - 1
          ];
        const handler1CallOrder =
          handler1.mock.invocationCallOrder[
            handler1.mock.invocationCallOrder.length - 1
          ];
        expect(handler2CallOrder).toBeLessThan(handler1CallOrder);
        expect(handler1).toHaveBeenCalledWith(expect.anything(), 1, 2);
        expect(handler2).toHaveBeenCalledWith(expect.anything(), 1, 2);
      });

      it('item instance with implicit order', () => {
        const testTree = tree
          .withFeatures(
            {
              key: 'feature1',
              itemInstance: {
                customHandler: () => 123,
              },
            },
            {
              key: 'feature2',
              itemInstance: {
                customHandler: handler1,
              },
            },
            {
              key: 'feature3',
              itemInstance: {
                customHandler: handler2,
              },
            }
          )
          .createTestCaseTree();

        expect(testTree.item('x111').customHandler(1, 2)).toBe(123);
        const handler2CallOrder =
          handler2.mock.invocationCallOrder[
            handler2.mock.invocationCallOrder.length - 1
          ];
        const handler1CallOrder =
          handler1.mock.invocationCallOrder[
            handler1.mock.invocationCallOrder.length - 1
          ];
        expect(handler2CallOrder).toBeLessThan(handler1CallOrder);
        expect(handler1).toHaveBeenCalledWith(expect.anything(), 1, 2);
        expect(handler2).toHaveBeenCalledWith(expect.anything(), 1, 2);
      });
    });
  });
});
