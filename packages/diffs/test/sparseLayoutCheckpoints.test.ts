import { describe, expect, spyOn, test } from 'bun:test';

import { VirtualizedFile } from '../src/components/VirtualizedFile';
import { VirtualizedFileDiff } from '../src/components/VirtualizedFileDiff';
import { DEFAULT_VIRTUAL_FILE_METRICS } from '../src/constants';
import type {
  FileContents,
  LineAnnotation,
  RenderRange,
  RenderWindow,
  VirtualFileMetrics,
} from '../src/types';
import { FILE_ANNOTATION_DOM_KEY } from '../src/utils/includesFileAnnotations';
import { iterateOverDiff } from '../src/utils/iterateOverDiff';
import { parseDiffFromFile } from '../src/utils/parseDiffFromFile';
import { installDom, waitFor } from './domHarness';

const metrics: VirtualFileMetrics & { hunkSeparatorHeight: number } = {
  ...DEFAULT_VIRTUAL_FILE_METRICS,
  hunkLineCount: 1,
  lineHeight: 10,
  diffHeaderHeight: 30,
  hunkSeparatorHeight: 12,
  spacing: 4,
};

const virtualizerBase = {
  type: 'simple',
  config: {},
  connect() {},
  disconnect() {},
  getWindowSpecs() {
    return { top: 0, bottom: 1000 };
  },
  getOffsetInScrollContainer() {
    return 0;
  },
  instanceChanged() {},
  isInstanceVisible() {
    return true;
  },
};

const virtualizer = virtualizerBase as never;

interface InspectableVirtualizedFile {
  cache: {
    fileAnnotationHeight: number;
  };
  renderRange: RenderRange | undefined;
  computeRenderRangeFromWindow(
    file: FileContents,
    fileTop: number,
    window: RenderWindow
  ): RenderRange;
}

function inspectFile(instance: VirtualizedFile): InspectableVirtualizedFile {
  return instance as unknown as InspectableVirtualizedFile;
}

function createTrackingVirtualizer(layoutDirtyCalls: boolean[]) {
  return {
    ...virtualizerBase,
    instanceChanged(_instance: unknown, layoutDirty: boolean) {
      layoutDirtyCalls.push(layoutDirty);
    },
  } as never;
}

function createLargeFile(name = 'large.txt'): FileContents {
  return {
    name,
    contents: Array.from({ length: 12_000 }, (_, index) => `${index + 1}`).join(
      '\n'
    ),
  };
}

// Render a large plain-text file through the real pipeline. Row heights come
// from each rendered row's type, so reconciliation measures actual DOM.
async function createRenderedFileFixture(
  lineAnnotations: LineAnnotation<undefined>[]
) {
  const dom = installDom();
  const file = createLargeFile();
  let window: RenderWindow = { top: 0, bottom: 100 };
  let fileAnnotationHeight = 25;
  const instance: VirtualizedFile = new VirtualizedFile(
    {},
    {
      ...virtualizerBase,
      getWindowSpecs: () => window,
      markDOMDirty() {},
      requestHeightReconcile() {},
      instanceChanged() {
        instance.onRender(true);
      },
    } as never,
    metrics
  );
  const fileContainer = document.createElement('div');
  document.body.appendChild(fileContainer);
  const rects = spyOn(
    HTMLElement.prototype,
    'getBoundingClientRect'
  ).mockImplementation(function (this: HTMLElement) {
    const height =
      this.dataset.lineAnnotation === FILE_ANNOTATION_DOM_KEY
        ? fileAnnotationHeight
        : 'lineIndex' in this.dataset
          ? metrics.lineHeight
          : 0;
    return { height } as DOMRect;
  });
  const render = (nextAnnotations?: LineAnnotation<undefined>[]) =>
    instance.render({ file, fileContainer, lineAnnotations: nextAnnotations });
  const hasFileAnnotationRow = () =>
    fileContainer.shadowRoot?.querySelector(
      `[data-line-annotation="${FILE_ANNOTATION_DOM_KEY}"]`
    ) != null;

  render(lineAnnotations);
  await waitFor(
    () => fileContainer.shadowRoot?.querySelector('[data-code]') != null
  );

  return {
    instance,
    render,
    hasFileAnnotationRow,
    setFileAnnotationHeight(height: number) {
      fileAnnotationHeight = height;
    },
    scrollTo(top: number) {
      window = { top, bottom: top + 100 };
      render();
    },
    cleanup() {
      rects.mockRestore();
      instance.cleanUp();
      dom.cleanup();
    },
  };
}

const unannotatedFileHeight =
  metrics.diffHeaderHeight + 12_000 * metrics.lineHeight + metrics.spacing;

describe('sparse layout checkpoints', () => {
  test('iterateOverDiff windowing matches full iteration for a deep expanded window', () => {
    const oldFile = createLargeFile();
    const newFile: FileContents = {
      ...oldFile,
      contents: oldFile.contents.replace('\n6000\n', '\nchanged-6000\n'),
    };
    const diff = parseDiffFromFile(oldFile, newFile);
    const full: number[] = [];
    const windowed: number[] = [];

    iterateOverDiff({
      diff,
      diffStyle: 'split',
      expandedHunks: true,
      callback: ({ additionLine, deletionLine }) => {
        const lineIndex =
          additionLine?.splitLineIndex ?? deletionLine?.splitLineIndex;
        if (lineIndex == null) {
          throw new Error('Expected a diff line');
        }
        full.push(lineIndex);
      },
    });

    iterateOverDiff({
      diff,
      diffStyle: 'split',
      startingLine: 10_000,
      totalLines: 5,
      expandedHunks: true,
      callback: ({ additionLine, deletionLine }) => {
        const lineIndex =
          additionLine?.splitLineIndex ?? deletionLine?.splitLineIndex;
        if (lineIndex == null) {
          throw new Error('Expected a diff line');
        }
        windowed.push(lineIndex);
      },
    });

    expect(windowed).toEqual(full.slice(10_000, 10_005));
  });

  test('VirtualizedFile uses checkpoints for deep variable-height line positions', () => {
    const file = createLargeFile();
    const instance = new VirtualizedFile(
      { overflow: 'wrap' },
      virtualizer,
      metrics
    );

    instance.updateCodeViewLayout(file, 0);

    expect(instance.getLinePosition(10_000)?.top).toBe(
      metrics.diffHeaderHeight + 9_999 * metrics.lineHeight
    );
  });

  test('VirtualizedFile does not reserve unmeasured file-level annotations above source lines', () => {
    const file = createLargeFile();
    const instance = new VirtualizedFile({}, virtualizer, metrics);

    instance.updateCodeViewLayout(file, 0, undefined, [{ lineNumber: 0 }]);

    expect(instance.getVirtualizedHeight()).toBe(
      metrics.diffHeaderHeight + 12_000 * metrics.lineHeight + metrics.spacing
    );
    expect(instance.getLinePosition(0)).toBeUndefined();
    expect(instance.getLinePosition(10_000)?.top).toBe(
      metrics.diffHeaderHeight + 9_999 * metrics.lineHeight
    );
  });

  test('VirtualizedFile does not reserve unmeasured file-level annotations after recycle', () => {
    const file = createLargeFile();
    const instance = new VirtualizedFile({}, virtualizer, metrics);

    instance.updateCodeViewLayout(file, 0, undefined, [{ lineNumber: 0 }]);
    expect(instance.getVirtualizedHeight()).toBe(
      metrics.diffHeaderHeight + 12_000 * metrics.lineHeight + metrics.spacing
    );

    instance.cleanUp(true);
    instance.updateCodeViewLayout(file, 0, undefined, []);

    expect(instance.getVirtualizedHeight()).toBe(
      metrics.diffHeaderHeight + 12_000 * metrics.lineHeight + metrics.spacing
    );
  });

  test('VirtualizedFile uses a top render range when measured file-level annotations are visible', () => {
    const file = createLargeFile();
    const instance = new VirtualizedFile({}, virtualizer, metrics);

    instance.updateCodeViewLayout(file, 0, undefined, [{ lineNumber: 0 }]);
    inspectFile(instance).cache.fileAnnotationHeight = 25;
    instance.height =
      metrics.diffHeaderHeight +
      25 +
      12_000 * metrics.lineHeight +
      metrics.spacing;

    const range = inspectFile(instance).computeRenderRangeFromWindow(file, 0, {
      top: metrics.diffHeaderHeight + 1,
      bottom: metrics.diffHeaderHeight + 24,
    });

    expect(range.startingLine).toBe(0);
    expect(range.totalLines).toBeGreaterThan(0);
    expect(range.bufferBefore).toBe(0);
  });

  test('VirtualizedFile does not use file-level annotation height to force top render ranges when only the header is visible', () => {
    const file = createLargeFile();
    const instance = new VirtualizedFile({}, virtualizer, metrics);

    instance.updateCodeViewLayout(file, 0, undefined, [{ lineNumber: 0 }]);
    inspectFile(instance).cache.fileAnnotationHeight = 25;
    instance.height =
      metrics.diffHeaderHeight +
      25 +
      12_000 * metrics.lineHeight +
      metrics.spacing;

    const range = inspectFile(instance).computeRenderRangeFromWindow(file, 0, {
      top: 1,
      bottom: metrics.diffHeaderHeight,
    });

    expect(range.totalLines).toBe(0);
  });

  test('VirtualizedFile includes the top render range when the first source row is visible with a zero-height file-level annotation', () => {
    const file = createLargeFile();
    const instance = new VirtualizedFile({}, virtualizer, metrics);

    instance.updateCodeViewLayout(file, 0, undefined, [{ lineNumber: 0 }]);

    const range = inspectFile(instance).computeRenderRangeFromWindow(file, 0, {
      top: metrics.diffHeaderHeight,
      bottom: metrics.diffHeaderHeight + metrics.lineHeight,
    });

    expect(range.startingLine).toBe(0);
    expect(range.totalLines).toBeGreaterThan(0);
  });

  test('VirtualizedFile does not require measured file-level annotation height to render top content', () => {
    const file = createLargeFile();
    const instance = new VirtualizedFile({}, virtualizer, metrics);

    instance.updateCodeViewLayout(file, 0, undefined, [{ lineNumber: 0 }]);
    inspectFile(instance).cache.fileAnnotationHeight = 0;

    const range = inspectFile(instance).computeRenderRangeFromWindow(file, 0, {
      top: metrics.diffHeaderHeight + 1,
      bottom: metrics.diffHeaderHeight + 2,
    });

    expect(range.startingLine).toBe(0);
    expect(range.totalLines).toBeGreaterThan(0);
    expect(range.bufferBefore).toBe(0);
  });

  test('VirtualizedFile applies measured file-level annotation height', async () => {
    const fixture = await createRenderedFileFixture([{ lineNumber: 0 }]);
    try {
      const { instance } = fixture;
      expect(fixture.hasFileAnnotationRow()).toBe(true);
      expect(instance.getVirtualizedHeight()).toBe(unannotatedFileHeight);
      expect(inspectFile(instance).cache.fileAnnotationHeight).toBe(0);

      expect(instance.reconcileHeights()).toBe(true);
      expect(instance.getVirtualizedHeight()).toBe(unannotatedFileHeight + 25);
      expect(inspectFile(instance).cache.fileAnnotationHeight).toBe(25);

      fixture.setFileAnnotationHeight(metrics.lineHeight);
      expect(instance.reconcileHeights()).toBe(true);
      expect(instance.getVirtualizedHeight()).toBe(
        unannotatedFileHeight + metrics.lineHeight
      );
      expect(inspectFile(instance).cache.fileAnnotationHeight).toBe(
        metrics.lineHeight
      );
    } finally {
      fixture.cleanup();
    }
  });

  test('VirtualizedFile anchors top render ranges after measured file-level annotations', () => {
    const file = createLargeFile();
    const instance = new VirtualizedFile({}, virtualizer, metrics);

    instance.updateCodeViewLayout(file, 0, undefined, [{ lineNumber: 0 }]);
    inspectFile(instance).cache.fileAnnotationHeight = 25;
    inspectFile(instance).renderRange = {
      startingLine: 0,
      totalLines: 3,
      bufferBefore: 0,
      bufferAfter: 0,
    };

    expect(
      instance.getNumericScrollAnchor(metrics.diffHeaderHeight + 25)
    ).toEqual({
      lineNumber: 1,
      top: metrics.diffHeaderHeight + 25,
    });
  });

  test('VirtualizedFile anchors non-top render ranges from bufferBefore without double-counting file-level annotations', () => {
    const file = createLargeFile();
    const instance = new VirtualizedFile({}, virtualizer, metrics);
    const fileAnnotationHeight = 25;
    const startingLine = 100;
    const firstRenderedLineTop =
      metrics.diffHeaderHeight +
      fileAnnotationHeight +
      startingLine * metrics.lineHeight;

    instance.updateCodeViewLayout(file, 0, undefined, [{ lineNumber: 0 }]);
    inspectFile(instance).cache.fileAnnotationHeight = fileAnnotationHeight;
    inspectFile(instance).renderRange = {
      startingLine,
      totalLines: 3,
      bufferBefore: fileAnnotationHeight + startingLine * metrics.lineHeight,
      bufferAfter: 0,
    };

    expect(instance.getNumericScrollAnchor(firstRenderedLineTop + 1)).toEqual({
      lineNumber: startingLine + 2,
      top: firstRenderedLineTop + metrics.lineHeight,
    });
  });

  test('VirtualizedFile preserves measured file-level annotation height when the row is not rendered', async () => {
    const fixture = await createRenderedFileFixture([{ lineNumber: 0 }]);
    try {
      const { instance } = fixture;
      expect(instance.reconcileHeights()).toBe(true);
      expect(inspectFile(instance).cache.fileAnnotationHeight).toBe(25);

      fixture.scrollTo(50_000);
      expect(fixture.hasFileAnnotationRow()).toBe(false);
      expect(instance.reconcileHeights()).toBe(false);
      expect(inspectFile(instance).cache.fileAnnotationHeight).toBe(25);
      expect(instance.getVirtualizedHeight()).toBe(unannotatedFileHeight + 25);
    } finally {
      fixture.cleanup();
    }
  });

  test('VirtualizedFile clears measured file-level annotation height when the rendered top no longer has the row', async () => {
    const fixture = await createRenderedFileFixture([{ lineNumber: 0 }]);
    try {
      const { instance } = fixture;
      expect(instance.reconcileHeights()).toBe(true);
      expect(inspectFile(instance).cache.fileAnnotationHeight).toBe(25);

      fixture.render([]);
      expect(fixture.hasFileAnnotationRow()).toBe(false);
      expect(instance.reconcileHeights()).toBe(true);
      expect(inspectFile(instance).cache.fileAnnotationHeight).toBe(0);
      expect(instance.getVirtualizedHeight()).toBe(unannotatedFileHeight);
    } finally {
      fixture.cleanup();
    }
  });

  test('VirtualizedFile retains removed file-level annotation height until the top renders', async () => {
    const fixture = await createRenderedFileFixture([{ lineNumber: 0 }]);
    try {
      const { instance } = fixture;
      expect(instance.reconcileHeights()).toBe(true);
      expect(instance.getVirtualizedHeight()).toBe(unannotatedFileHeight + 25);

      fixture.scrollTo(50_000);
      fixture.render([]);
      expect(instance.reconcileHeights()).toBe(false);
      expect(inspectFile(instance).cache.fileAnnotationHeight).toBe(25);
      expect(instance.getVirtualizedHeight()).toBe(unannotatedFileHeight + 25);

      fixture.scrollTo(0);
      expect(instance.reconcileHeights()).toBe(true);
      expect(inspectFile(instance).cache.fileAnnotationHeight).toBe(0);
      expect(instance.getVirtualizedHeight()).toBe(unannotatedFileHeight);
    } finally {
      fixture.cleanup();
    }
  });

  test('VirtualizedFileDiff uses checkpoints for deep expanded line positions and anchors', () => {
    const oldFile = createLargeFile();
    const newFile: FileContents = {
      ...oldFile,
      contents: oldFile.contents.replace('\n6000\n', '\nchanged-6000\n'),
    };
    const diff = parseDiffFromFile(oldFile, newFile);
    const instance = new VirtualizedFileDiff(
      { expandUnchanged: true },
      virtualizer,
      metrics
    );

    instance.updateCodeViewLayout(diff, 0);

    const expectedTop = metrics.diffHeaderHeight + 9_999 * metrics.lineHeight;
    expect(instance.getLinePosition(10_000, 'additions')?.top).toBe(
      expectedTop
    );
    expect(instance.getNumericScrollAnchor(expectedTop)).toEqual({
      lineNumber: 10_000,
      side: 'deletions',
      top: expectedTop,
    });
  });

  test('VirtualizedFileDiff maps hidden collapsed line indexes to their separator row', () => {
    const oldFile: FileContents = {
      name: 'collapsed.txt',
      contents: Array.from({ length: 120 }, (_, index) => `${index + 1}`).join(
        '\n'
      ),
    };
    const newFile: FileContents = {
      ...oldFile,
      contents: Array.from({ length: 120 }, (_, index) => {
        if (index === 1) return 'changed-2';
        if (index === 109) return 'changed-110';
        return `${index + 1}`;
      }).join('\n'),
    };
    const diff = parseDiffFromFile(oldFile, newFile);
    const [firstHunk, secondHunk] = diff.hunks;
    if (firstHunk == null || secondHunk == null) {
      throw new Error('Expected two hunks');
    }
    const instance = new VirtualizedFileDiff({}, virtualizer, metrics);

    instance.updateCodeViewLayout(diff, 0);

    expect(
      instance.getLinePosition(secondHunk.additionStart - 2, 'additions')
    ).toEqual({
      top:
        metrics.diffHeaderHeight +
        firstHunk.splitLineCount * metrics.lineHeight +
        metrics.spacing,
      height: metrics.hunkSeparatorHeight,
    });
  });

  test('VirtualizedFile renders option changes without marking visual-only changes as layout dirty', () => {
    const layoutDirtyCalls: boolean[] = [];
    const instance = new VirtualizedFile(
      {},
      createTrackingVirtualizer(layoutDirtyCalls),
      metrics
    );

    instance.updateCodeViewLayout(createLargeFile(), 0);
    instance.setOptions({ disableVirtualizationBuffers: true });

    expect(layoutDirtyCalls).toEqual([false]);
  });

  test('VirtualizedFileDiff marks diff indicator changes as layout dirty', () => {
    const oldFile: FileContents = {
      name: 'indicators.txt',
      contents: 'one\ntwo\nthree',
    };
    const newFile: FileContents = {
      ...oldFile,
      contents: 'one\nchanged\nthree',
    };
    const layoutDirtyCalls: boolean[] = [];
    const instance = new VirtualizedFileDiff(
      { diffIndicators: 'bars' },
      createTrackingVirtualizer(layoutDirtyCalls),
      metrics
    );

    instance.updateCodeViewLayout(parseDiffFromFile(oldFile, newFile), 0);
    instance.setOptions({ diffIndicators: 'classic' });

    expect(layoutDirtyCalls).toEqual([true]);
  });
});
