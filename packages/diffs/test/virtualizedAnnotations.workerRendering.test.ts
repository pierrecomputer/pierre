import { afterAll, beforeAll, expect, spyOn, test } from 'bun:test';

import { VirtualizedFile } from '../src/components/VirtualizedFile';
import { VirtualizedFileDiff } from '../src/components/VirtualizedFileDiff';
import {
  disposeHighlighter,
  getSharedHighlighter,
} from '../src/highlighter/shared_highlighter';
import type {
  DiffLineAnnotation,
  DiffsHighlighter,
  FileContents,
  RenderWindow,
  VirtualFileMetrics,
} from '../src/types';
import { getVirtualFileHeaderRegion } from '../src/utils/computeVirtualFileMetrics';
import { parseDiffFromFile } from '../src/utils/parseDiffFromFile';
import { renderDiffWithHighlighter } from '../src/utils/renderDiffWithHighlighter';
import { renderFileWithHighlighter } from '../src/utils/renderFileWithHighlighter';
import { installDom, waitFor } from './domHarness';
import { createInitializedManager, withTimeout } from './workerPoolHarness';

let highlighter: DiffsHighlighter;

beforeAll(async () => {
  highlighter = await getSharedHighlighter({
    themes: ['pierre-dark'],
    langs: ['typescript'],
    preferredHighlighter: 'shiki-js',
  });
});

afterAll(async () => {
  await disposeHighlighter();
});

const metrics: VirtualFileMetrics = {
  hunkLineCount: 2,
  lineHeight: 10,
  diffHeaderHeight: 30,
  spacing: 4,
};

const annotations: DiffLineAnnotation<string>[] = [
  { side: 'additions', lineNumber: 0, metadata: 'file annotation' },
  { side: 'additions', lineNumber: 1, metadata: 'line annotation' },
];

// Hold worker results until the test has measured or scrolled the old DOM.
async function createFixture(
  type: 'file' | 'diff',
  mode: 'simple' | 'advanced'
) {
  const dom = installDom();
  const { manager, worker } = await createInitializedManager({
    theme: 'pierre-dark',
  });
  let window: RenderWindow = { top: 0, bottom: 1000 };
  let changes = 0;
  const virtualizer = {
    type: mode,
    config: {},
    connect() {},
    disconnect() {},
    getWindowSpecs: () => window,
    getOffsetInScrollContainer: () => 0,
    getLocalTopForInstance: () => 0,
    isInstanceVisible: () => true,
    markDOMDirty() {},
    requestHeightReconcile() {},
    instanceChanged() {
      changes++;
    },
  } as never;
  const options = {
    theme: 'pierre-dark',
    disableErrorHandling: true,
    renderAnnotation(annotation: DiffLineAnnotation<string>) {
      const element = document.createElement('span');
      element.textContent = annotation.metadata;
      return element;
    },
  };
  const instance =
    type === 'file'
      ? new VirtualizedFile<string>(options, virtualizer, metrics, manager)
      : new VirtualizedFileDiff<string>(
          { ...options, diffStyle: 'unified' },
          virtualizer,
          metrics,
          manager
        );
  const container = document.createElement('div');
  document.body.appendChild(container);
  const createFile = (name: string): FileContents => ({
    name: 'pending.ts',
    cacheKey: `virtualized:${name}`,
    contents:
      Array.from(
        { length: 100 },
        (_, index) => `const ${name}${index} = ${index};`
      ).join('\n') + '\n',
  });
  const files = { A: createFile('alpha'), B: createFile('beta') };
  const oldFile = { ...createFile('before'), contents: 'const before = 0;\n' };
  const diffs = {
    A: parseDiffFromFile(oldFile, files.A),
    B: parseDiffFromFile(oldFile, files.B),
  };
  const render = (
    version: 'A' | 'B',
    lineAnnotations?: DiffLineAnnotation<string>[]
  ) => {
    if (instance instanceof VirtualizedFile) {
      if (mode === 'advanced') {
        instance.updateCodeViewLayout(
          files[version],
          0,
          undefined,
          lineAnnotations
        );
      }
      instance.render({
        file: files[version],
        fileContainer: container,
        lineAnnotations,
      });
    } else {
      if (mode === 'advanced') {
        instance.updateCodeViewLayout(
          diffs[version],
          0,
          undefined,
          lineAnnotations
        );
      }
      instance.render({
        fileDiff: diffs[version],
        fileContainer: container,
        lineAnnotations,
      });
    }
  };
  const respond = async (version: 'A' | 'B') => {
    const requestCount = version === 'A' ? 1 : 2;
    await waitFor(
      () =>
        (type === 'file' ? worker.fileRequestCount : worker.diffRequestCount) >=
        requestCount
    );
    const previousChanges = changes;
    if (type === 'file') {
      const request = await withTimeout(worker.waitForFileRequest());
      expect(request.file.cacheKey).toBe(files[version].cacheKey);
      const renderOptions = manager.getFileRenderOptions();
      worker.respond({
        type: 'success',
        requestType: 'file',
        id: request.id,
        result: renderFileWithHighlighter(
          files[version],
          highlighter,
          renderOptions
        ),
        options: renderOptions,
        sentAt: Date.now(),
      });
    } else {
      const request = await withTimeout(worker.waitForDiffRequest());
      expect(request.diff.cacheKey).toBe(diffs[version].cacheKey);
      const renderOptions = manager.getDiffRenderOptions();
      worker.respond({
        type: 'success',
        requestType: 'diff',
        id: request.id,
        result: renderDiffWithHighlighter(
          diffs[version],
          highlighter,
          renderOptions
        ),
        options: renderOptions,
        sentAt: Date.now(),
      });
    }
    await waitFor(() => changes > previousChanges);
  };
  const rects = spyOn(
    HTMLElement.prototype,
    'getBoundingClientRect'
  ).mockImplementation(function (this: HTMLElement) {
    const height =
      this.dataset.lineAnnotation === '-1,-1'
        ? 25
        : 'lineAnnotation' in this.dataset
          ? 15
          : 'lineIndex' in this.dataset
            ? metrics.lineHeight
            : 0;
    return { height } as DOMRect;
  });
  return {
    instance,
    container,
    render,
    respond,
    rects,
    showOnlyFileAnnotation() {
      const headerRegion = getVirtualFileHeaderRegion(metrics, false);
      window = { top: headerRegion + 1, bottom: headerRegion + 24 };
    },
    cleanup() {
      rects.mockRestore();
      instance.cleanUp();
      manager.terminate();
      dom.cleanup();
    },
  };
}

for (const type of ['file', 'diff'] as const) {
  for (const mode of ['simple', 'advanced'] as const) {
    for (const measured of [false, true]) {
      test(`${mode} ${type} retains ${measured ? 'measured' : 'unmeasured'} annotations while removal is highlighted`, async () => {
        const fixture = await createFixture(type, mode);
        const { instance, container, render, respond } = fixture;
        try {
          render('A', annotations);
          await respond('A');
          render('A');
          const unmeasuredHeight = instance.getVirtualizedHeight();

          if (measured) {
            expect(instance.reconcileHeights()).toBe(true);
          }
          render('B', []);
          expect(container.textContent).toContain('file annotation');
          expect(instance.reconcileHeights()).toBe(!measured);
          expect(instance.getVirtualizedHeight()).toBe(unmeasuredHeight + 40);

          fixture.showOnlyFileAnnotation();
          render('B', []);
          expect(
            container.shadowRoot?.querySelector(
              '[data-line-annotation="-1,-1"]'
            )
          ).not.toBeNull();
          expect(container.textContent).toContain('file annotation');
          expect(instance.getVirtualizedHeight()).toBe(unmeasuredHeight + 40);

          await respond('B');
          render('B');
          instance.reconcileHeights();
          expect(container.textContent).not.toContain('file annotation');
          expect(container.textContent).not.toContain('line annotation');
          expect(instance.getVirtualizedHeight()).toBe(unmeasuredHeight);
        } finally {
          fixture.cleanup();
        }
      });
    }

    test(`${mode} ${type} does not measure plain rows for annotations queued with a replacement`, async () => {
      const fixture = await createFixture(type, mode);
      const { instance, container, render, respond, rects } = fixture;
      try {
        render('A', []);
        await respond('A');
        render('A');
        const height = instance.getVirtualizedHeight();

        render('B', annotations);
        rects.mockClear();
        expect(instance.reconcileHeights()).toBe(false);
        expect(rects).not.toHaveBeenCalled();
        expect(instance.getVirtualizedHeight()).toBe(height);
        expect(container.textContent).not.toContain('file annotation');

        await respond('B');
        render('B');
        expect(container.textContent).toContain('file annotation');
        expect(instance.reconcileHeights()).toBe(true);
        expect(instance.getVirtualizedHeight()).toBe(height + 40);

        render('B', []);
        expect(container.textContent).not.toContain('file annotation');
        expect(instance.reconcileHeights()).toBe(true);
        expect(instance.getVirtualizedHeight()).toBe(height);
      } finally {
        fixture.cleanup();
      }
    });
  }
}
