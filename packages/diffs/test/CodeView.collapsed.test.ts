import { describe, expect, test } from 'bun:test';

import { CodeView } from '../src/components/CodeView';
import type { CodeViewItem } from '../src/types';
import { parseDiffFromFile } from '../src/utils/parseDiffFromFile';
import {
  createRoot,
  dispatchScroll,
  installDom,
  makeFile,
  renderItems,
  wait,
} from './domHarness';

function makeDiffItem(
  id: string,
  collapsed?: boolean
): CodeViewItem<undefined> {
  const item: CodeViewItem<undefined> = {
    id,
    type: 'diff',
    fileDiff: parseDiffFromFile(
      {
        name: 'src/example.txt',
        contents: 'one\ntwo\nthree\n',
      },
      {
        name: 'src/example.txt',
        contents: 'one\ntwo changed\nthree\n',
      }
    ),
  };
  if (collapsed !== undefined) {
    item.collapsed = collapsed;
  }
  return item;
}

function hasRenderedCode(item: { element: HTMLElement }): boolean {
  return item.element.shadowRoot?.querySelector('pre') != null;
}

describe('CodeView item collapsed state', () => {
  test('mounts mixed initially collapsed and expanded items', async () => {
    const { cleanup } = installDom();
    const viewer = new CodeView();
    try {
      viewer.setup(createRoot());
      await renderItems(viewer, [
        {
          id: 'file:collapsed.txt',
          type: 'file',
          file: makeFile('collapsed.txt'),
          collapsed: true,
        },
        makeDiffItem('diff:expanded.txt'),
      ]);

      const renderedItems = viewer.getRenderedItems();
      const collapsedFile = renderedItems.find(
        (item) => item.id === 'file:collapsed.txt'
      );
      const expandedDiff = renderedItems.find(
        (item) => item.id === 'diff:expanded.txt'
      );

      expect(collapsedFile).toBeDefined();
      expect(expandedDiff).toBeDefined();
      expect(hasRenderedCode(collapsedFile!)).toBe(false);
      expect(hasRenderedCode(expandedDiff!)).toBe(true);
    } finally {
      viewer.cleanUp();
      await wait(0);
      cleanup();
    }
  });

  test('collapses an item when its versioned snapshot changes', async () => {
    const { cleanup } = installDom();
    const viewer = new CodeView();
    const item: CodeViewItem = {
      id: 'file:example.txt',
      type: 'file',
      file: makeFile('example.txt'),
      version: 0,
    };
    try {
      viewer.setup(createRoot());
      await renderItems(viewer, [item]);

      const expandedItem = viewer.getRenderedItems()[0];
      expect(expandedItem).toBeDefined();
      expect(hasRenderedCode(expandedItem)).toBe(true);
      const expandedHeight = expandedItem.instance.getVirtualizedHeight();

      await renderItems(viewer, [{ ...item, collapsed: true, version: 1 }]);

      const collapsedItem = viewer.getRenderedItems()[0];
      expect(collapsedItem).toBeDefined();
      expect(hasRenderedCode(collapsedItem)).toBe(false);
      expect(collapsedItem.instance.getVirtualizedHeight()).toBeLessThan(
        expandedHeight
      );
    } finally {
      viewer.cleanUp();
      await wait(0);
      cleanup();
    }
  });

  test('ignores same-version collapsed changes', async () => {
    const { cleanup } = installDom();
    const viewer = new CodeView();
    const item: CodeViewItem = {
      id: 'file:example.txt',
      type: 'file',
      file: makeFile('example.txt'),
      version: 0,
    };
    try {
      viewer.setup(createRoot());
      await renderItems(viewer, [item]);

      await renderItems(viewer, [{ ...item, collapsed: true }]);

      const renderedItem = viewer.getRenderedItems()[0];
      expect(renderedItem).toBeDefined();
      expect(hasRenderedCode(renderedItem)).toBe(true);
    } finally {
      viewer.cleanUp();
      await wait(0);
      cleanup();
    }
  });

  test('updates one item without changing item order', async () => {
    const { cleanup } = installDom();
    const viewer = new CodeView();
    const items: CodeViewItem[] = [
      {
        id: 'file:first.txt',
        type: 'file',
        file: makeFile('first.txt'),
        version: 0,
      },
      {
        id: 'file:middle.txt',
        type: 'file',
        file: makeFile('middle.txt'),
        version: 0,
      },
      {
        id: 'file:last.txt',
        type: 'file',
        file: makeFile('last.txt'),
        version: 0,
      },
    ];
    try {
      viewer.setup(createRoot());
      await renderItems(viewer, items);

      const middleItem = viewer.getItem('file:middle.txt');
      expect(middleItem).toBeDefined();
      middleItem!.collapsed = true;
      middleItem!.version = 1;

      expect(viewer.updateItem(middleItem!)).toBe(true);
      viewer.render(true);
      await wait(0);

      const renderedItems = viewer.getRenderedItems();
      expect(renderedItems.map((item) => item.id)).toEqual([
        'file:first.txt',
        'file:middle.txt',
        'file:last.txt',
      ]);
      const renderedMiddleItem = renderedItems[1];
      expect(renderedMiddleItem).toBeDefined();
      expect(hasRenderedCode(renderedMiddleItem)).toBe(false);
    } finally {
      viewer.cleanUp();
      await wait(0);
      cleanup();
    }
  });

  test('keeps rendering after many collapsed items shrink the layout', async () => {
    const { cleanup } = installDom();
    const viewer = new CodeView();
    const items: CodeViewItem[] = Array.from({ length: 40 }, (_, index) => ({
      id: `file:${index}`,
      type: 'file',
      file: makeFile(`example-${index}.txt`, 30),
      version: 0,
    }));
    try {
      const root = createRoot();
      viewer.setup(root);
      await renderItems(viewer, items);

      root.scrollTop = 20_000;
      dispatchScroll(root);
      viewer.render(true);

      const collapsedItems = items.map((item) => ({
        ...item,
        collapsed: true,
        version: 1,
      }));

      await renderItems(viewer, collapsedItems);

      const renderedItems = viewer.getRenderedItems();
      expect(renderedItems.length).toBeGreaterThan(0);
      // The clamped scroll position must land the render window on the tail
      // of the list rather than stranding it past the shrunken content.
      expect(renderedItems.map((item) => item.id)).toContain(
        `file:${items.length - 1}`
      );
      // Every item is identical and collapsed, so the total content height is
      // the item count times one collapsed item's virtualized height; the
      // clamped scroll offset cannot exceed it.
      const collapsedHeight = renderedItems[0].instance.getVirtualizedHeight();
      expect(root.scrollTop).toBeLessThanOrEqual(
        items.length * collapsedHeight
      );
    } finally {
      viewer.cleanUp();
      await wait(0);
      cleanup();
    }
  });
});
