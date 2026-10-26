import { afterAll, beforeAll, describe, expect, spyOn, test } from 'bun:test';

import { CodeView, type CodeViewCoordinator } from '../src/components/CodeView';
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
import { getCodeViewItemRenderData } from '../src/utils/getCodeViewItemRenderData';
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
  const getRenderedDiff = Reflect.get(instance, 'getRenderedDiff') as () =>
    | FileDiffMetadata
    | undefined;
  return getRenderedDiff.call(instance);
}

function getRenderedFileForTest(instance: object): FileContents | undefined {
  const getRenderedFile = Reflect.get(instance, 'getRenderedFile') as () =>
    | FileContents
    | undefined;
  return getRenderedFile.call(instance);
}

for (const type of ['file', 'diff'] as const) {
  test(`CodeView ${type} keeps input items intact while annotation callbacks and slots use displayed data`, async () => {
    const dom = installDom();
    const { manager, worker } = await createInitializedManager({
      theme: 'pierre-dark',
    });
    const contexts: CodeViewItem<string>[] = [];
    const displayedContents: (FileContents | FileDiffMetadata)[] = [];
    let notifications = 0;
    const viewer = new CodeView<string>(
      {
        theme: 'pierre-dark',
        stickyHeaders: false,
        renderAnnotation(annotation, fileOrDiff, context) {
          contexts.push(context.item);
          displayedContents.push(fileOrDiff);
          const element = document.createElement('span');
          element.textContent = annotation.metadata;
          return element;
        },
      },
      manager
    );
    const fileA: FileContents = {
      name: 'pending.ts',
      contents: 'const alpha = 1;\n',
      cacheKey: 'context:A',
    };
    const fileB = {
      ...fileA,
      contents: 'const beta = 2;\n',
      cacheKey: 'context:B',
    };
    const diffA = createDiff('context:A', fileA.contents);
    const diffB = createDiff('context:B', fileB.contents);
    const annotation = {
      side: 'additions' as const,
      lineNumber: 1,
      metadata: 'context annotation',
    };
    const annotations = [annotation];
    const itemA: CodeViewItem<string> =
      type === 'file'
        ? { type, id: 'pending', file: fileA, annotations, version: 0 }
        : { type, id: 'pending', fileDiff: diffA, annotations, version: 0 };
    const itemB: CodeViewItem<string> =
      type === 'file'
        ? { type, id: 'pending', file: fileB, annotations: [], version: 1 }
        : { type, id: 'pending', fileDiff: diffB, annotations: [], version: 1 };
    const coordinator: CodeViewCoordinator<string, undefined> = {
      hasHeaderRenderers: false,
      hasAnnotationRenderer: true,
      hasGutterRenderer: false,
      onSnapshotChange() {
        notifications++;
      },
    };
    const respond = async (count: number) => {
      await waitFor(
        () =>
          (type === 'file'
            ? worker.fileRequestCount
            : worker.diffRequestCount) >= count
      );
      if (type === 'file') {
        const request = await withTimeout(worker.waitForFileRequest());
        const options = manager.getFileRenderOptions();
        worker.respond({
          type: 'success',
          requestType: 'file',
          id: request.id,
          result: renderFileWithHighlighter(
            count === 1 ? fileA : fileB,
            sharedHighlighter,
            options
          ),
          options,
          sentAt: Date.now(),
        });
      } else {
        const request = await withTimeout(worker.waitForDiffRequest());
        const options = manager.getDiffRenderOptions();
        worker.respond({
          type: 'success',
          requestType: 'diff',
          id: request.id,
          result: renderDiffWithHighlighter(
            count === 1 ? diffA : diffB,
            sharedHighlighter,
            options
          ),
          options,
          sentAt: Date.now(),
        });
      }
    };
    try {
      viewer.setup(createRoot());
      viewer.setSlotCoordinator(coordinator);
      viewer.setItems([itemA]);
      viewer.render(true);
      await respond(1);
      viewer.render(true);
      await waitFor(
        () => getRenderedText(viewer, 'pending')?.includes('alpha') === true
      );
      expect(contexts.at(-1)).toBe(itemA);
      expect(displayedContents.at(-1)).toBe(type === 'file' ? fileA : diffA);

      viewer.setItems([itemB]);
      viewer.render(true);
      expect(viewer.getItem('pending')).toBe(itemB);
      const slotItem = viewer.getSlotSnapshot(coordinator)?.items?.[0];
      if (slotItem == null) throw new Error('Expected a slot item');
      expect(slotItem.item).toBe(itemB);
      const slotData = getCodeViewItemRenderData(slotItem);
      expect(slotData.lineAnnotations).toBe(annotations);
      expect('file' in slotData ? slotData.file : slotData.fileDiff).toBe(
        type === 'file' ? fileA : diffA
      );
      const rendered = viewer.getRenderedItems()[0];
      if (rendered == null)
        throw new Error('Expected the pending item to remain displayed');
      expect(rendered.item).toBe(itemB);
      if (rendered.type === 'file') {
        rendered.instance.options.renderAnnotation?.(annotation, fileA);
      } else {
        rendered.instance.options.renderAnnotation?.(annotation, diffA);
      }
      expect(contexts.at(-1)).toBe(itemB);
      expect(displayedContents.at(-1)).toBe(type === 'file' ? fileA : diffA);
      expect(rendered.version).toBe(1);
      const notificationsBeforeRender = notifications;
      viewer.render(true);
      expect(notifications).toBe(notificationsBeforeRender);

      expect(viewer.updateItemId('pending', 'renamed')).toBe(true);
      expect(viewer.getRenderedItems()[0]?.item.id).toBe('renamed');
      expect(viewer.getRenderedItems()[0]?.version).toBe(1);

      await respond(2);
      await waitFor(
        () => getRenderedText(viewer, 'renamed')?.includes('beta') === true
      );
      expect(viewer.getRenderedItems()[0]?.item).toBe(itemB);
      expect(viewer.getSlotSnapshot(coordinator)).toBeUndefined();
      const annotatedB = { ...itemB, annotations, version: 2 };
      viewer.setItems([annotatedB]);
      viewer.render(true);
      expect(contexts.at(-1)).toBe(annotatedB);
      expect(displayedContents.at(-1)).toBe(type === 'file' ? fileB : diffB);
      expect(viewer.getSlotSnapshot(coordinator)?.items?.[0]?.item).toBe(
        annotatedB
      );
    } finally {
      viewer.cleanUp();
      manager.terminate();
      dom.cleanup();
    }
  });
}

for (const type of ['file', 'diff'] as const) {
  test(`CodeView ${type} reads the displayed pair without observing intermediate renders`, async () => {
    const dom = installDom();
    const { manager, worker } = await createInitializedManager({
      theme: 'pierre-dark',
    });
    const viewer = new CodeView<string>(
      { theme: 'pierre-dark', stickyHeaders: false },
      manager
    );
    const files = ['alpha', 'beta', 'gamma'].map((name) => ({
      name: 'pending.ts',
      contents: `const ${name} = 1;\n`,
      cacheKey: `unobserved:${name}`,
    }));
    const items: CodeViewItem<string>[] = files.map((file, version) => {
      const shared = {
        id: 'pending',
        version,
        annotations:
          version === 2
            ? [
                {
                  side: 'additions' as const,
                  lineNumber: 1,
                  metadata: 'new annotation',
                },
              ]
            : [],
      };
      return type === 'file'
        ? { ...shared, type, file }
        : {
            ...shared,
            type,
            fileDiff: createDiff(file.cacheKey, file.contents),
          };
    });
    const respond = async (count: number) => {
      await waitFor(
        () =>
          (type === 'file'
            ? worker.fileRequestCount
            : worker.diffRequestCount) >= count
      );
      if (type === 'file') {
        const request = await withTimeout(worker.waitForFileRequest());
        const options = manager.getFileRenderOptions();
        worker.respond({
          type: 'success',
          requestType: 'file',
          id: request.id,
          result: renderFileWithHighlighter(
            request.file,
            sharedHighlighter,
            options
          ),
          options,
          sentAt: Date.now(),
        });
      } else {
        const request = await withTimeout(worker.waitForDiffRequest());
        const options = manager.getDiffRenderOptions();
        worker.respond({
          type: 'success',
          requestType: 'diff',
          id: request.id,
          result: renderDiffWithHighlighter(
            request.diff,
            sharedHighlighter,
            options
          ),
          options,
          sentAt: Date.now(),
        });
      }
      viewer.render(true);
    };
    try {
      viewer.setup(createRoot());
      viewer.setItems([items[0]]);
      await respond(1);
      const element = viewer.getRenderedItems()[0]?.element;
      expect(element?.shadowRoot?.textContent).toContain('alpha');

      // Apply B without a portal coordinator or a read of getRenderedItems().
      viewer.setItems([items[1]]);
      await respond(2);
      expect(element?.shadowRoot?.textContent).toContain('beta');
      viewer.setItems([items[2]]);
      viewer.render(true);
      expect(element?.shadowRoot?.textContent).toContain('beta');

      const displayed = viewer.getRenderedItems()[0];
      if (displayed == null) throw new Error('Expected a rendered item');
      expect(displayed.item).toBe(items[2]);
      const itemB = items[1];
      const displayedData = getCodeViewItemRenderData(displayed);
      expect(
        'file' in displayedData ? displayedData.file : displayedData.fileDiff
      ).toBe(itemB.type === 'file' ? itemB.file : itemB.fileDiff);
      expect(displayedData.lineAnnotations).toEqual([]);
      expect(viewer.getItem('pending')).toBe(items[2]);
      // The pending annotation keeps a portal so its content can be built
      // before C renders.
      expect(
        viewer.getSlotSnapshot({
          hasHeaderRenderers: false,
          hasGutterRenderer: false,
          hasAnnotationRenderer: true,
          onSnapshotChange() {},
        })?.items?.[0]?.item
      ).toBe(items[2]);
    } finally {
      viewer.cleanUp();
      manager.terminate();
      dom.cleanup();
    }
  });
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

  test('renders a new diff object with the same cache key while a highlight result is pending', async () => {
    const { cleanup } = installDom();
    const { manager, worker } = await createInitializedManager({
      theme: 'pierre-dark',
    });
    const viewer = new CodeView<string, undefined>(
      {
        // Throw render errors instead of logging them.
        disableErrorHandling: true,
        stickyHeaders: false,
        theme: 'pierre-dark',
      },
      manager
    );
    // Built from the same files, so both carry the same cache key.
    const diff = createDiff('pending:same', 'const sameValue = 1;\n');
    const rebuiltDiff = createDiff('pending:same', 'const sameValue = 1;\n');
    expect(rebuiltDiff).not.toBe(diff);
    expect(rebuiltDiff.cacheKey).toBe(diff.cacheKey);

    try {
      viewer.setup(createRoot());
      viewer.setItems([
        { id: 'diff:same', type: 'diff', fileDiff: diff, version: 0 },
      ]);
      viewer.render(true);

      const request = await withTimeout(worker.waitForDiffRequest());
      const renderOptions = manager.getDiffRenderOptions();
      worker.respond({
        type: 'success',
        requestType: 'diff',
        id: request.id,
        result: renderDiffWithHighlighter(
          diff,
          sharedHighlighter,
          renderOptions
        ),
        options: renderOptions,
        sentAt: Date.now(),
      });

      // Before the highlight result is applied.
      viewer.setItems([
        { id: 'diff:same', type: 'diff', fileDiff: rebuiltDiff, version: 1 },
      ]);
      expect(() => viewer.render(true)).not.toThrow();
      await wait(0);

      expect(getRenderedText(viewer, 'diff:same')).toContain('sameValue');
    } finally {
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
        'annotation:short'
      );
      expect(getRenderedSlotText(viewer, shortItem.id)).not.toContain(
        'annotation:tall'
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
