import { expect, test } from 'bun:test';

import { VirtualizedFileDiff } from '../src/components/VirtualizedFileDiff';
import type { Virtualizer } from '../src/components/Virtualizer';
import type { FileDiffMetadata } from '../src/types';
import { parseDiffFromFile } from '../src/utils/parseDiffFromFile';
import { installDom } from './domHarness';
import { createInitializedManager } from './workerPoolHarness';

class TestVirtualizedFileDiff extends VirtualizedFileDiff {
  getRenderedDiffForTest(): FileDiffMetadata | undefined {
    return this.getRenderedDiff();
  }
}

function createDiff(cacheKey: string, contents: string): FileDiffMetadata {
  return parseDiffFromFile(
    {
      name: 'visibility.txt',
      contents: 'before\n',
      cacheKey: `${cacheKey}:old`,
    },
    {
      name: 'visibility.txt',
      contents: `${contents}\n`,
      cacheKey: `${cacheKey}:new`,
    }
  );
}

function createVirtualizer(isVisible: boolean): Virtualizer {
  return {
    config: { resizeDebugging: false },
    type: 'simple',
    connect() {},
    disconnect() {},
    getOffsetInScrollContainer() {
      return 0;
    },
    getWindowSpecs() {
      return { top: 0, bottom: 1000 };
    },
    instanceChanged() {},
    isInstanceVisible() {
      return isVisible;
    },
    markDOMDirty() {},
    requestHeightReconcile() {},
  } as unknown as Virtualizer;
}

test('renders a replacement after an off-screen placeholder', async () => {
  const dom = installDom();
  const { manager } = await createInitializedManager({
    theme: 'pierre-dark',
  });
  const container = document.createElement('diffs-container');
  const instance = new TestVirtualizedFileDiff(
    {},
    createVirtualizer(false),
    undefined,
    manager,
    true
  );
  const firstDiff = createDiff('first', 'first value');
  const replacementDiff = createDiff('replacement', 'replacement value');

  try {
    instance.render({ fileDiff: firstDiff, fileContainer: container });
    expect(
      container.shadowRoot?.querySelectorAll('[data-placeholder]').length
    ).toBe(1);
    expect(instance.getRenderedDiffForTest()).toBeUndefined();

    instance.render({
      fileDiff: replacementDiff,
      fileContainer: container,
    });
    expect(
      container.shadowRoot?.querySelectorAll('[data-placeholder]').length
    ).toBe(0);
    expect(instance.getRenderedDiffForTest()).toBe(replacementDiff);
  } finally {
    instance.cleanUp();
    manager.terminate();
    dom.cleanup();
  }
});
