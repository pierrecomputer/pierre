import { beforeEach, describe, mock } from 'bun:test';

import { buildProxiedInstance } from '../../../src/core/build-proxified-instance';
import { createTree } from '../../../src/core/create-tree';
import type { TreeConfig, TreeInstance } from '../../../src/core/types/core';
import { syncDataLoaderFeature } from '../../../src/features/sync-data-loader/feature';
import { TestTreeDo } from './test-tree-do';
import { TestTreeExpect } from './test-tree-expect';

export class TestTree<T = string> {
  public readonly do = new TestTreeDo(this);

  public readonly expect = new TestTreeExpect(this);

  // oxlint-disable-next-line typescript-eslint/no-redundant-type-constituents
  private treeInstance: TreeInstance<T> | null = null;

  suits = {
    sync: () => ({
      tree: this.withFeatures(syncDataLoaderFeature),
      title: 'Synchronous Data Loader',
    }),
    proxifiedSync: () => ({
      tree: this.withFeatures(syncDataLoaderFeature).with({
        instanceBuilder: buildProxiedInstance,
      }),
      title: 'Proxified Synchronous Data Loader',
    }),
  };

  /** Runs a test suite across sync and proxified-sync data loader variants. */
  forSuits(runSuite: (tree: TestTree<T>, title: string) => void) {
    const suitsArray = [this.suits.sync(), this.suits.proxifiedSync()];
    for (const { tree, title } of suitsArray) {
      describe(title, () => {
        tree.resetBeforeEach();
        runSuite(tree, title);
      });
    }
  }

  get instance() {
    if (this.treeInstance == null) {
      this.treeInstance = createTree(this.config);
      this.treeInstance.setMounted(true);
      this.treeInstance.rebuildTree();
    }
    // oxlint-disable-next-line typescript-eslint/no-unsafe-return
    return this.treeInstance;
  }

  private constructor(private config: TreeConfig<T>) {}

  static default(config: Partial<TreeConfig<string>>) {
    return new TestTree({
      rootItemId: 'x',
      createLoadingItemData: () => 'loading',
      dataLoader: {
        getItem: (id) => id,
        getChildren: (id) => [`${id}1`, `${id}2`, `${id}3`, `${id}4`],
      },
      // oxlint-disable-next-line typescript-eslint/no-unsafe-return
      getItemName: (item) => item.getItemData(),
      indent: 20,
      isItemFolder: (item) => item.getItemMeta().level < 2,
      initialState: {
        expandedItems: ['x1', 'x11'],
      },
      features: [],
      ...config,
    });
  }

  with(config: Partial<TreeConfig<T>>) {
    return new TestTree({ ...this.config, ...config });
  }

  resetBeforeEach() {
    beforeEach(() => {
      this.createTestCaseTree();
    });
  }

  createTestCaseTree() {
    this.reset();
    // trigger instance creation
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    this.instance;
    this.instance.registerElement({
      getBoundingClientRect: () => null,
      // oxlint-disable-next-line typescript-eslint/no-explicit-any
    } as any);
    return this;
  }

  // oxlint-disable-next-line typescript-eslint/no-explicit-any
  withFeatures(...features: any) {
    return this.with({
      features: [...(this.config.features ?? []), ...features],
    });
  }

  mockedHandler(
    handlerName: keyof TreeConfig<T>
    // oxlint-disable-next-line typescript-eslint/no-explicit-any
  ): ReturnType<typeof mock<any>> {
    const fn = mock(() => {});
    if (this.treeInstance != null) {
      // oxlint-disable-next-line typescript-eslint/no-unsafe-return
      this.treeInstance.setConfig((prev) => ({
        ...prev,
        // oxlint-disable-next-line typescript-eslint/no-explicit-any
        [handlerName as any]: fn,
      }));
    } else {
      // oxlint-disable-next-line typescript-eslint/no-explicit-any -- dynamic handler assignment for test utility
      (this.config as any)[handlerName as any] = fn;
    }
    return fn;
  }

  item(itemId: string) {
    // oxlint-disable-next-line typescript-eslint/no-unsafe-return
    return this.instance.getItemInstance(itemId);
  }

  reset() {
    this.treeInstance = null;
  }

  debug() {
    console.log(
      this.instance
        .getItems()
        .map((item) =>
          [
            '  '.repeat(item.getItemMeta().level),
            '"',
            item.getItemName(),
            '"',
          ].join('')
        )
        .join('\n')
    );
  }

  setElementBoundingBox(
    itemId: string,
    bb: Partial<DOMRect> = {
      left: 0,
      width: 100,
      top: 0,
      height: 20,
    }
  ) {
    this.instance.registerElement({
      getBoundingClientRect: () =>
        ({
          left: 0,
          width: 100,
          top: 0,
          height: 10000,
        }) as DOMRect,
    } as HTMLElement);

    this.instance.getItemInstance(itemId).registerElement({
      getBoundingClientRect: () => bb as DOMRect,
    } as HTMLElement);
  }

  static dragEvent(clientX = 1000, clientY = 0) {
    return {
      preventDefault: mock(() => {}),
      stopPropagation: mock(() => {}),
      dataTransfer: {
        setData: mock(() => {}),
        getData: mock(() => {}),
        dropEffect: 'unchaged-from-test',
      },
      clientX,
      clientY,
    } as unknown as DragEvent;
  }

  createTopDragEvent(indent = 0) {
    return TestTree.dragEvent(indent * 20, 1);
  }

  createBottomDragEvent(indent = 0) {
    return TestTree.dragEvent(indent * 20, 19);
  }
}
