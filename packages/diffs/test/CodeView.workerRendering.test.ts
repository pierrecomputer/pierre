import { afterAll, beforeAll, describe, expect, spyOn, test } from 'bun:test';

import { CodeView } from '../src/components/CodeView';
import {
  disposeHighlighter,
  getSharedHighlighter,
} from '../src/highlighter/shared_highlighter';
import type {
  CodeViewItem,
  DiffsHighlighter,
  FileContents,
  FileDiffMetadata,
} from '../src/types';
import { parseDiffFromFile } from '../src/utils/parseDiffFromFile';
import { renderDiffWithHighlighter } from '../src/utils/renderDiffWithHighlighter';
import { renderFileWithHighlighter } from '../src/utils/renderFileWithHighlighter';
import {
  createRoot,
  dispatchScroll,
  installDom,
  wait,
  waitFor,
} from './domHarness';
import { createInitializedManager, withTimeout } from './workerPoolHarness';

let sharedHighlighter: DiffsHighlighter;

beforeAll(async () => {
  sharedHighlighter = await getSharedHighlighter({
    themes: ['pierre-dark'],
    langs: ['typescript'],
    preferredHighlighter: 'shiki-js',
  });
});

afterAll(async () => {
  await disposeHighlighter();
});

function createDiff(
  newFileCacheKey: string,
  newContents: string
): FileDiffMetadata {
  return parseDiffFromFile(
    {
      name: 'pending.ts',
      contents: 'const before = 0;\n',
      cacheKey: 'pending:old',
    },
    {
      name: 'pending.ts',
      contents: newContents,
      cacheKey: newFileCacheKey,
    }
  );
}

function getRenderedText<LAnnotation, Caret>(
  viewer: CodeView<LAnnotation, Caret>,
  id: string
): string | undefined {
  return viewer
    .getRenderedItems()
    .find((item) => item.id === id)
    ?.element.shadowRoot?.textContent?.trim();
}

function getRenderedSlotText(
  viewer: CodeView<string, undefined>,
  id: string
): string | undefined {
  return viewer
    .getRenderedItems()
    .find((item) => item.id === id)
    ?.element.textContent?.trim();
}

function getRenderedHeaderPrefix(
  viewer: CodeView<string, undefined>,
  id: string
): string | undefined {
  const element = viewer
    .getRenderedItems()
    .find((item) => item.id === id)
    ?.element.querySelector<HTMLElement>('[slot="header-prefix"]');
  return element?.innerText;
}

function getItemTop<LAnnotation>(
  viewer: CodeView<LAnnotation, undefined>,
  id: string
): number {
  const top = viewer.getTopForItem(id);
  if (top == null) {
    throw new Error(`Expected CodeView layout for item "${id}"`);
  }
  return top;
}

function getRenderedDiffForTest(
  instance: object
): FileDiffMetadata | undefined {
  return Reflect.get(instance, 'renderedDiff') as FileDiffMetadata | undefined;
}

function getRenderedFileForTest(instance: object): FileContents | undefined {
  return Reflect.get(instance, 'renderedFile') as FileContents | undefined;
}

describe('CodeView worker rendering', () => {
  test('ignores a worker result after its collapsed file is removed', async () => {
    const { cleanup } = installDom();
    const { manager, worker } = await createInitializedManager({
      theme: 'pierre-dark',
    });
    const viewer = new CodeView(
      {
        theme: 'pierre-dark',
      },
      manager
    );
    const file: FileContents = {
      name: 'removed.ts',
      contents: 'const removed = true;\n',
      cacheKey: 'removed:file',
    };
    const item: CodeViewItem<undefined> = {
      id: 'file:removed',
      type: 'file',
      file,
      collapsed: true,
    };
    const instanceChanged = spyOn(viewer, 'instanceChanged');

    try {
      viewer.setup(createRoot());
      viewer.setItems([item]);
      viewer.render(true);

      const request = await withTimeout(worker.waitForFileRequest());
      viewer.setItems([]);
      viewer.render(true);
      instanceChanged.mockClear();

      const renderOptions = manager.getFileRenderOptions();
      worker.respond({
        type: 'success',
        requestType: 'file',
        id: request.id,
        result: renderFileWithHighlighter(
          file,
          sharedHighlighter,
          renderOptions
        ),
        options: renderOptions,
        sentAt: Date.now(),
      });
      await wait(0);

      expect(viewer.getRenderedItems()).toEqual([]);
      expect(instanceChanged).not.toHaveBeenCalled();
    } finally {
      instanceChanged.mockRestore();
      viewer.cleanUp();
      manager.terminate();
      await wait(0);
      cleanup();
    }
  });

  test('keeps layout matched to the displayed diff while its replacement is highlighted', async () => {
    const { cleanup } = installDom();
    const { manager, worker } = await createInitializedManager({
      theme: 'pierre-dark',
    });
    const viewer = new CodeView<string, undefined>(
      {
        renderAnnotation: (annotation) => {
          const element = document.createElement('span');
          element.textContent = annotation.metadata;
          return element;
        },
        renderHeaderPrefix: (file) => `header:${file.cacheKey}`,
        stickyHeaders: false,
        theme: 'pierre-dark',
      },
      manager
    );
    const shortDiff = createDiff('pending:short', 'const shortValue = 1;\n');
    const tallDiff = parseDiffFromFile(
      {
        name: 'pending.ts',
        contents: 'const before = 0;\nconst removed = 1;\n',
        cacheKey: 'pending:tall-old',
      },
      {
        name: 'pending.ts',
        contents:
          Array.from(
            { length: 120 },
            (_, index) => `const tallValue${index + 1} = ${index + 1};`
          ).join('\n') + '\n',
        cacheKey: 'pending:tall',
      }
    );
    const follower: CodeViewItem<string> = {
      id: 'file:follower',
      type: 'file',
      file: {
        name: 'follower.txt',
        lang: 'text',
        contents: Array.from(
          { length: 80 },
          (_, index) => `follower ${index + 1}`
        ).join('\n'),
      },
    };
    const shortItem: CodeViewItem<string> = {
      id: 'diff:pending',
      type: 'diff',
      fileDiff: shortDiff,
      version: 0,
      annotations: [
        {
          side: 'additions',
          lineNumber: 1,
          metadata: 'annotation:short',
        },
      ],
    };
    const tallItem: CodeViewItem<string> = {
      id: shortItem.id,
      type: 'diff',
      fileDiff: tallDiff,
      version: 1,
      annotations: [
        {
          side: 'additions',
          lineNumber: 1,
          metadata: 'annotation:tall',
        },
      ],
    };

    try {
      const root = createRoot({ height: 120 });
      viewer.setup(root);
      viewer.setItems([shortItem, follower]);
      viewer.render(true);

      const shortRequest = await withTimeout(worker.waitForDiffRequest());
      const renderOptions = manager.getDiffRenderOptions();
      worker.respond({
        type: 'success',
        requestType: 'diff',
        id: shortRequest.id,
        result: renderDiffWithHighlighter(
          shortDiff,
          sharedHighlighter,
          renderOptions
        ),
        options: renderOptions,
        sentAt: Date.now(),
      });
      viewer.render(true);
      await waitFor(
        () =>
          getRenderedText(viewer, shortItem.id)?.includes('shortValue') === true
      );
      expect(getRenderedText(viewer, shortItem.id)).toContain('shortValue');
      expect(getRenderedHeaderPrefix(viewer, shortItem.id)).toBe(
        `header:${shortDiff.cacheKey}`
      );
      expect(getRenderedSlotText(viewer, shortItem.id)).toContain(
        'annotation:short'
      );

      const shortScrollHeight = viewer.getScrollHeight();
      const followerTopWithShortDiff = getItemTop(viewer, follower.id);

      viewer.setItems([tallItem, follower]);
      viewer.render();

      await waitFor(() => worker.diffRequestCount === 2);
      expect(worker.diffRequestCount).toBe(2);
      const tallRequest = await withTimeout(worker.waitForDiffRequest());
      expect(tallRequest.diff.cacheKey).toBe(tallDiff.cacheKey);
      expect(viewer.getItem(shortItem.id)).toBe(tallItem);
      expect(getRenderedText(viewer, shortItem.id)).toContain('shortValue');
      expect(getRenderedText(viewer, shortItem.id)).not.toContain(
        'tallValue120'
      );
      const pendingItem = viewer
        .getRenderedItems()
        .find((item) => item.id === shortItem.id);
      expect(pendingItem?.type).toBe('diff');
      if (pendingItem?.type !== 'diff') {
        throw new Error('Expected the diff item to remain rendered');
      }
      const shortPreparedHeight = pendingItem.instance.getVirtualizedHeight();
      expect(pendingItem.item).toBe(tallItem);
      expect(pendingItem.version).toBe(1);
      expect(getRenderedDiffForTest(pendingItem.instance)).toBe(shortDiff);
      const shortLineIndex = pendingItem.instance.getLineIndex(
        120,
        'additions'
      );
      expect(getRenderedHeaderPrefix(viewer, shortItem.id)).toBe(
        `header:${shortDiff.cacheKey}`
      );
      expect(getRenderedSlotText(viewer, shortItem.id)).toContain(
        'annotation:tall'
      );
      expect(getRenderedSlotText(viewer, shortItem.id)).not.toContain(
        'annotation:short'
      );
      expect(viewer.getScrollHeight()).toBe(shortScrollHeight);
      expect(getItemTop(viewer, follower.id)).toBe(followerTopWithShortDiff);

      root.scrollTop = followerTopWithShortDiff;
      dispatchScroll(root);
      viewer.render(true);
      const followerOffsetBefore =
        followerTopWithShortDiff - viewer.getScrollTop();

      worker.respond({
        type: 'success',
        requestType: 'diff',
        id: tallRequest.id,
        result: renderDiffWithHighlighter(
          tallDiff,
          sharedHighlighter,
          renderOptions
        ),
        options: renderOptions,
        sentAt: Date.now(),
      });

      // The worker response only schedules the render. Until that render runs,
      // both the DOM and layout still describe the short diff.
      expect(getRenderedText(viewer, shortItem.id)).toContain('shortValue');
      expect(getItemTop(viewer, follower.id)).toBe(followerTopWithShortDiff);
      const itemBeforeReplacementRender = viewer
        .getRenderedItems()
        .find((item) => item.id === shortItem.id);
      expect(itemBeforeReplacementRender?.type).toBe('diff');
      if (itemBeforeReplacementRender?.type !== 'diff') {
        throw new Error('Expected the short diff to remain rendered');
      }
      expect(
        itemBeforeReplacementRender.instance.getLineIndex(120, 'additions')
      ).toEqual(shortLineIndex);
      expect(getRenderedDiffForTest(itemBeforeReplacementRender.instance)).toBe(
        shortDiff
      );

      const tallPreparedHeight =
        itemBeforeReplacementRender.instance.updateCodeViewLayout(
          tallDiff,
          viewer.getLocalTopForInstance(itemBeforeReplacementRender.instance),
          undefined,
          tallItem.annotations
        );
      expect(tallPreparedHeight).toBeGreaterThan(shortPreparedHeight);
      expect(getRenderedDiffForTest(itemBeforeReplacementRender.instance)).toBe(
        shortDiff
      );

      await waitFor(
        () =>
          getRenderedText(viewer, shortItem.id)?.includes('tallValue120') ===
          true
      );

      const followerTopWithTallDiff = getItemTop(viewer, follower.id);
      expect(getRenderedText(viewer, shortItem.id)).toContain('tallValue120');
      expect(getRenderedText(viewer, shortItem.id)).not.toContain('shortValue');
      const replacementItem = viewer
        .getRenderedItems()
        .find((item) => item.id === shortItem.id);
      expect(replacementItem?.type).toBe('diff');
      if (replacementItem?.type !== 'diff') {
        throw new Error('Expected the replacement diff to be rendered');
      }
      expect(replacementItem.item.fileDiff).toBe(tallDiff);
      expect(replacementItem.version).toBe(1);
      expect(getRenderedDiffForTest(replacementItem.instance)).toBe(tallDiff);
      expect(
        replacementItem.instance.getLineIndex(120, 'additions')
      ).not.toEqual(shortLineIndex);
      expect(getRenderedHeaderPrefix(viewer, shortItem.id)).toBe(
        `header:${tallDiff.cacheKey}`
      );
      expect(getRenderedSlotText(viewer, shortItem.id)).toContain(
        'annotation:tall'
      );
      expect(getRenderedSlotText(viewer, shortItem.id)).not.toContain(
        'annotation:short'
      );
      expect(viewer.getScrollHeight()).toBeGreaterThan(shortScrollHeight);
      expect(followerTopWithTallDiff).toBeGreaterThan(followerTopWithShortDiff);
      expect(followerTopWithTallDiff - viewer.getScrollTop()).toBe(
        followerOffsetBefore
      );
    } finally {
      viewer.cleanUp();
      manager.terminate();
      await wait(0);
      cleanup();
    }
  });

  test('keeps file layout matched to the displayed file while its replacement is highlighted', async () => {
    const { cleanup } = installDom();
    const { manager, worker } = await createInitializedManager({
      theme: 'pierre-dark',
    });
    const viewer = new CodeView<undefined, undefined>(
      {
        disableFileHeader: true,
        stickyHeaders: false,
        theme: 'pierre-dark',
      },
      manager
    );
    const shortFile: FileContents = {
      name: 'short.ts',
      contents: 'const shortValue = 1;\n',
      cacheKey: 'file-layout:short',
    };
    const tallFile: FileContents = {
      name: 'tall.ts',
      contents:
        Array.from(
          { length: 120 },
          (_, index) => `const tallValue${index + 1} = ${index + 1};`
        ).join('\n') + '\n',
      cacheKey: 'file-layout:tall',
    };
    const shortItem: CodeViewItem<undefined> = {
      id: 'file:pending',
      type: 'file',
      file: shortFile,
      version: 0,
    };
    const tallItem: CodeViewItem<undefined> = {
      ...shortItem,
      file: tallFile,
      version: 1,
    };
    const follower: CodeViewItem<undefined> = {
      id: 'file:pending-follower',
      type: 'file',
      file: {
        name: 'follower.txt',
        lang: 'text',
        contents: 'follower\n',
      },
    };

    try {
      const root = createRoot({ height: 120 });
      viewer.setup(root);
      viewer.setItems([shortItem, follower]);
      viewer.render(true);

      const shortRequest = await withTimeout(worker.waitForFileRequest());
      const renderOptions = manager.getFileRenderOptions();
      worker.respond({
        type: 'success',
        requestType: 'file',
        id: shortRequest.id,
        result: renderFileWithHighlighter(
          shortFile,
          sharedHighlighter,
          renderOptions
        ),
        options: renderOptions,
        sentAt: Date.now(),
      });
      viewer.render(true);
      await waitFor(
        () =>
          getRenderedText(viewer, shortItem.id)?.includes('shortValue') === true
      );

      const shortScrollHeight = viewer.getScrollHeight();
      const followerTopWithShortFile = getItemTop(viewer, follower.id);
      viewer.setItems([tallItem, follower]);
      viewer.render();

      await waitFor(() => worker.fileRequestCount === 2);
      const tallRequest = await withTimeout(worker.waitForFileRequest());
      expect(getRenderedText(viewer, shortItem.id)).toContain('shortValue');
      expect(getRenderedText(viewer, shortItem.id)).not.toContain(
        'tallValue120'
      );
      expect(viewer.getScrollHeight()).toBe(shortScrollHeight);
      expect(getItemTop(viewer, follower.id)).toBe(followerTopWithShortFile);
      const pendingItem = viewer
        .getRenderedItems()
        .find((item) => item.id === shortItem.id);
      expect(pendingItem?.type).toBe('file');
      if (pendingItem?.type !== 'file') {
        throw new Error('Expected the file item to remain rendered');
      }
      expect(getRenderedFileForTest(pendingItem.instance)).toBe(shortFile);

      worker.respond({
        type: 'success',
        requestType: 'file',
        id: tallRequest.id,
        result: renderFileWithHighlighter(
          tallFile,
          sharedHighlighter,
          renderOptions
        ),
        options: renderOptions,
        sentAt: Date.now(),
      });
      await waitFor(
        () =>
          getRenderedText(viewer, shortItem.id)?.includes('tallValue120') ===
          true
      );

      const replacementItem = viewer
        .getRenderedItems()
        .find((item) => item.id === shortItem.id);
      expect(replacementItem?.type).toBe('file');
      if (replacementItem?.type !== 'file') {
        throw new Error('Expected the replacement file to be rendered');
      }
      expect(getRenderedFileForTest(replacementItem.instance)).toBe(tallFile);
      expect(viewer.getScrollHeight()).toBeGreaterThan(shortScrollHeight);
      expect(getItemTop(viewer, follower.id)).toBeGreaterThan(
        followerTopWithShortFile
      );
    } finally {
      viewer.cleanUp();
      manager.terminate();
      await wait(0);
      cleanup();
    }
  });

  test('updates replacement layout before remounting a recycled diff', async () => {
    const { cleanup } = installDom();
    const { manager, worker } = await createInitializedManager({
      theme: 'pierre-dark',
    });
    const viewer = new CodeView<undefined, undefined>(
      {
        disableFileHeader: true,
        stickyHeaders: false,
        theme: 'pierre-dark',
      },
      manager
    );
    const shortDiff = createDiff('recycle:short', 'const shortValue = 1;\n');
    const tallDiff = createDiff(
      'recycle:tall',
      Array.from(
        { length: 120 },
        (_, index) => `const tallValue${index + 1} = ${index + 1};`
      ).join('\n') + '\n'
    );
    const diffItem: CodeViewItem<undefined> = {
      id: 'diff:recycle',
      type: 'diff',
      fileDiff: shortDiff,
      version: 0,
    };
    const replacementItem: CodeViewItem<undefined> = {
      id: diffItem.id,
      type: 'diff',
      fileDiff: tallDiff,
      version: 1,
    };
    const follower: CodeViewItem<undefined> = {
      id: 'file:recycle-follower',
      type: 'file',
      file: {
        name: 'recycle-follower.txt',
        lang: 'text',
        contents: Array.from(
          { length: 400 },
          (_, index) => `follower ${index + 1}`
        ).join('\n'),
      },
    };

    try {
      const root = createRoot({ height: 120 });
      viewer.setup(root);
      viewer.setItems([diffItem, follower]);
      viewer.render(true);

      const shortRequest = await withTimeout(worker.waitForDiffRequest());
      const renderOptions = manager.getDiffRenderOptions();
      worker.respond({
        type: 'success',
        requestType: 'diff',
        id: shortRequest.id,
        result: renderDiffWithHighlighter(
          shortDiff,
          sharedHighlighter,
          renderOptions
        ),
        options: renderOptions,
        sentAt: Date.now(),
      });
      viewer.render(true);
      await waitFor(
        () =>
          getRenderedText(viewer, diffItem.id)?.includes('shortValue') === true
      );

      const shortScrollHeight = viewer.getScrollHeight();
      const followerTopWithShortDiff = getItemTop(viewer, follower.id);
      viewer.setItems([replacementItem, follower]);
      viewer.render();
      await waitFor(() => worker.diffRequestCount === 2);
      expect(viewer.getItem(diffItem.id)).toBe(replacementItem);
      const pendingItem = viewer
        .getRenderedItems()
        .find((item) => item.id === diffItem.id);
      expect(pendingItem?.type).toBe('diff');
      if (pendingItem?.type !== 'diff') {
        throw new Error('Expected the replacement item to remain mounted');
      }
      expect(pendingItem.item).toBe(replacementItem);
      expect(pendingItem.version).toBe(1);
      expect(getRenderedText(viewer, diffItem.id)).toContain('shortValue');

      root.scrollTop = 4_000;
      dispatchScroll(root);
      viewer.render(true);
      await waitFor(
        () => !viewer.getRenderedItems().some((item) => item.id === diffItem.id)
      );

      root.scrollTop = 0;
      dispatchScroll(root);
      viewer.render(true);

      const renderedItem = viewer
        .getRenderedItems()
        .find((item) => item.id === diffItem.id);
      expect(renderedItem?.type).toBe('diff');
      if (renderedItem?.type !== 'diff') {
        throw new Error('Expected the recycled diff to remount');
      }
      expect(renderedItem.item.fileDiff).toBe(tallDiff);
      expect(renderedItem.version).toBe(1);
      expect(getRenderedText(viewer, diffItem.id)).toContain('tallValue1');
      expect(getRenderedText(viewer, diffItem.id)).not.toContain('shortValue');
      expect(viewer.getScrollHeight()).toBeGreaterThan(shortScrollHeight);
      expect(getItemTop(viewer, follower.id)).toBeGreaterThan(
        followerTopWithShortDiff
      );
    } finally {
      viewer.cleanUp();
      manager.terminate();
      await wait(0);
      cleanup();
    }
  });
});
