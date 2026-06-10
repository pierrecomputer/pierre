import { describe, expect, test } from 'bun:test';

import { CodeView } from '../src/components/CodeView';
import { DEFAULT_CODE_VIEW_LAYOUT } from '../src/constants';
import type { CodeViewItem, FileContents } from '../src/types';
import { parseDiffFromFile } from '../src/utils/parseDiffFromFile';
import {
  dispatchScroll,
  installDom,
  makeFile,
  makeFileItem,
  renderItems,
  wait,
} from './domHarness';

const ROOT_HEIGHT = 800;

// Unlike the shared createRoot, this root clamps scrollTop writes to the
// container's current max scroll range, mimicking real browser behavior so
// rebase/anchoring logic can be exercised.
function createClampingRoot(): HTMLDivElement {
  const root = document.createElement('div');
  root.scrollTo = (options?: ScrollToOptions | number, y?: number) => {
    const top =
      typeof options === 'number' ? (y ?? 0) : (options?.top ?? root.scrollTop);
    root.scrollTop = Math.min(Math.max(top, 0), getRootMaxScrollTop(root));
  };
  Object.defineProperty(root, 'getBoundingClientRect', {
    value: () => ({
      bottom: ROOT_HEIGHT,
      height: ROOT_HEIGHT,
      left: 0,
      right: 1000,
      top: 0,
      width: 1000,
      x: 0,
      y: 0,
      toJSON() {
        return {};
      },
    }),
  });
  document.body.appendChild(root);
  return root;
}

function getRootMaxScrollTop(root: HTMLElement): number {
  const container = root.firstElementChild;
  if (!(container instanceof HTMLElement)) {
    return 0;
  }

  const contentHeight = Number.parseFloat(
    container.style.height !== '' ? container.style.height : '0'
  );
  const marginTop = Number.parseFloat(
    container.style.marginTop !== '' ? container.style.marginTop : '0'
  );
  const marginBottom = Number.parseFloat(
    container.style.marginBottom !== '' ? container.style.marginBottom : '0'
  );
  return Math.max(contentHeight + marginTop + marginBottom - ROOT_HEIGHT, 0);
}

function getScrollToTop(
  options?: ScrollToOptions | number,
  y?: number
): number {
  return typeof options === 'number' ? (y ?? 0) : (options?.top ?? 0);
}

function makeReplacementDiffItem(
  id: string,
  lineCount: number
): CodeViewItem<undefined> {
  const oldFile = makeFile('src/replaced.ts', lineCount);
  const newFile: FileContents = {
    name: oldFile.name,
    contents: Array.from(
      { length: lineCount },
      (_, index) => `replacement ${index + 1}`
    ).join('\n'),
  };

  return {
    id,
    type: 'diff',
    fileDiff: parseDiffFromFile(oldFile, newFile),
  };
}

describe('CodeView scroll anchoring', () => {
  test('keeps an item anchor fixed when split to unified grows past the old scroll range', async () => {
    const { cleanup } = installDom();
    const viewer = new CodeView({ diffStyle: 'split' });
    const root = createClampingRoot();
    const anchorItem: CodeViewItem = {
      id: 'file:anchor',
      type: 'file',
      file: makeFile('anchor.ts', 90),
    };
    const items = [makeReplacementDiffItem('diff:growing', 100), anchorItem];

    try {
      viewer.setup(root);
      await renderItems(viewer, items);

      const splitAnchorTop =
        DEFAULT_CODE_VIEW_LAYOUT.paddingTop +
        (viewer.getTopForItem(anchorItem.id) ?? 0);
      const splitMaxScrollTop = getRootMaxScrollTop(root);
      expect(splitMaxScrollTop).toBeGreaterThan(splitAnchorTop);

      root.scrollTop = splitAnchorTop;
      dispatchScroll(root);
      viewer.render(true);

      viewer.setOptions({ diffStyle: 'unified' });
      viewer.render(true);

      const unifiedAnchorTop =
        DEFAULT_CODE_VIEW_LAYOUT.paddingTop +
        (viewer.getTopForItem(anchorItem.id) ?? 0);
      expect(unifiedAnchorTop).toBeGreaterThan(splitMaxScrollTop);
      expect(root.scrollTop).toBe(unifiedAnchorTop);
    } finally {
      viewer.cleanUp();
      await wait(0);
      cleanup();
    }
  });

  test('rebases the DOM scroll position while preserving logical scroll progress', async () => {
    const { cleanup } = installDom();
    const viewer = new CodeView({
      layout: {
        ...DEFAULT_CODE_VIEW_LAYOUT,
        gap: 1_000_000,
      },
    });
    const root = createClampingRoot();
    const items = Array.from({ length: 40 }, (_, index) =>
      makeFileItem(`file:${index}`, 1)
    );

    try {
      viewer.setup(root);
      await renderItems(viewer, items);

      expect(viewer.getScrollHeight()).toBeGreaterThan(20_000_000);
      expect(getRootMaxScrollTop(root)).toBeLessThan(12_000_000);

      root.scrollTop = 11_100_000;
      dispatchScroll(root);
      viewer.render(true);

      expect(viewer.getScrollTop()).toBe(11_100_000);
      expect(root.scrollTop).toBe(2_000_000);

      root.scrollTop = 3_000_000;
      dispatchScroll(root);
      viewer.render(true);

      expect(viewer.getScrollTop()).toBe(12_100_000);

      viewer.scrollTo({
        type: 'item',
        id: 'file:39',
        align: 'start',
        behavior: 'instant',
      });
      viewer.render(true);

      const finalFileTop =
        DEFAULT_CODE_VIEW_LAYOUT.paddingTop +
        (viewer.getTopForItem('file:39') ?? 0);
      expect(viewer.getScrollTop()).toBeGreaterThan(finalFileTop - ROOT_HEIGHT);
      expect(viewer.getScrollTop()).toBeLessThanOrEqual(finalFileTop);
      expect(root.scrollTop).toBeLessThanOrEqual(getRootMaxScrollTop(root));
      expect(
        viewer.getRenderedItems().some((item) => item.id === 'file:39')
      ).toBe(true);
    } finally {
      viewer.cleanUp();
      await wait(0);
      cleanup();
    }
  });

  test('restores the paged scroll height after clearing and reusing the viewer', async () => {
    const { cleanup } = installDom();
    const viewer = new CodeView({
      layout: {
        ...DEFAULT_CODE_VIEW_LAYOUT,
        gap: 1_000_000,
      },
    });
    const root = createClampingRoot();
    const firstItems = Array.from({ length: 40 }, (_, index) =>
      makeFileItem(`first:${index}`, 1)
    );
    const secondItems = Array.from({ length: 40 }, (_, index) =>
      makeFileItem(`second:${index}`, 1)
    );

    try {
      viewer.setup(root);
      await renderItems(viewer, firstItems);

      const container = root.firstElementChild;
      expect(container).toBeInstanceOf(HTMLElement);
      expect((container as HTMLElement).style.height).toBe('12000000px');

      viewer.setItems([]);
      expect((container as HTMLElement).style.height).toBe('');

      await renderItems(viewer, secondItems);

      expect(viewer.getScrollHeight()).toBeGreaterThan(20_000_000);
      expect((container as HTMLElement).style.height).toBe('12000000px');
      expect(getRootMaxScrollTop(root)).toBeGreaterThan(11_000_000);
    } finally {
      viewer.cleanUp();
      await wait(0);
      cleanup();
    }
  });

  test('moves the physical spacer before applying a programmatic rebase jump', async () => {
    const { cleanup } = installDom();
    const viewer = new CodeView({
      layout: {
        ...DEFAULT_CODE_VIEW_LAYOUT,
        gap: 1_000_000,
      },
    });
    const root = createClampingRoot();
    const scrollWrites: { top: number; spacerHeight: number }[] = [];
    const originalScrollTo = root.scrollTo.bind(root);
    root.scrollTo = (options?: ScrollToOptions | number, y?: number) => {
      const container = root.firstElementChild;
      const spacer = container?.firstElementChild;
      scrollWrites.push({
        top: getScrollToTop(options, y),
        spacerHeight:
          spacer instanceof HTMLElement
            ? Number.parseFloat(
                spacer.style.height !== '' ? spacer.style.height : '0'
              )
            : 0,
      });
      if (typeof options === 'number') {
        originalScrollTo(options, y ?? 0);
      } else {
        originalScrollTo(options);
      }
    };
    const items = Array.from({ length: 40 }, (_, index) =>
      makeFileItem(`file:${index}`, 1)
    );

    try {
      viewer.setup(root);
      await renderItems(viewer, items);

      viewer.scrollTo({
        type: 'position',
        position: 11_100_000,
        behavior: 'instant',
      });
      viewer.render(true);

      const rebaseWrite = scrollWrites.find((write) => write.top === 2_000_000);
      expect(rebaseWrite).toBeDefined();
      expect(rebaseWrite?.spacerHeight).toBeGreaterThan(1_900_000);
      expect(rebaseWrite?.spacerHeight).toBeLessThan(2_100_000);
    } finally {
      viewer.cleanUp();
      await wait(0);
      cleanup();
    }
  });
});
