import { afterAll, beforeAll, expect, spyOn, test } from 'bun:test';

import { File } from '../src/components/File';
import { FileDiff } from '../src/components/FileDiff';
import {
  disposeHighlighter,
  getSharedHighlighter,
} from '../src/highlighter/shared_highlighter';
import type {
  DiffLineAnnotation,
  DiffsHighlighter,
  FileContents,
  FileDiffMetadata,
  RenderDiffOptions,
  ThemedDiffResult,
} from '../src/types';
import { parseDiffFromFile } from '../src/utils/parseDiffFromFile';
import { renderDiffWithHighlighter } from '../src/utils/renderDiffWithHighlighter';
import { installDom, waitFor } from './domHarness';
import {
  createInitializedManager,
  createInitializingManager,
  withTimeout,
} from './workerPoolHarness';

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

class TestFileDiff extends FileDiff<string> {
  getRenderedDiffForTest(): FileDiffMetadata | undefined {
    return this.getRenderedDiff();
  }

  completeHighlightForTest(
    fileDiff: FileDiffMetadata,
    result: ThemedDiffResult,
    options: RenderDiffOptions
  ): void {
    this.hunksRenderer.onHighlightSuccess(fileDiff, result, options);
  }
}

class TestFile extends File<string> {
  getRenderedFileForTest(): FileContents | undefined {
    return this.getRenderedFile();
  }
}

function createDiff(cacheKey: string, contents: string): FileDiffMetadata {
  return parseDiffFromFile(
    {
      name: 'annotations.ts',
      contents: 'const before = 0;\nconst stable = 1;\n',
      cacheKey: `${cacheKey}:old`,
    },
    {
      name: 'annotations.ts',
      contents,
      cacheKey: `${cacheKey}:new`,
    }
  );
}

function getAnnotationText(
  container: HTMLElement,
  slot: string
): string | undefined {
  return container
    .querySelector<HTMLElement>(`[slot="${slot}"]`)
    ?.textContent?.trim();
}

test('standalone renderers fall back when worker initialization fails', async () => {
  const dom = installDom();
  const consoleError = spyOn(console, 'error').mockImplementation(() => {});
  const { initialization, manager, worker } = createInitializingManager({
    theme: 'pierre-dark',
  });
  const fileInstance = new TestFile(
    { disableErrorHandling: true, disableFileHeader: true },
    manager
  );
  const diffInstance = new TestFileDiff(
    { disableErrorHandling: true, disableFileHeader: true },
    manager
  );
  const fileContainer = document.createElement('div');
  const diffContainer = document.createElement('div');
  const file: FileContents = {
    name: 'fallback.ts',
    contents: 'const fallback = true;\n',
    cacheKey: 'fallback:file',
  };
  const diff = createDiff('fallback:diff', 'const fallback = true;\n');

  try {
    fileInstance.render({ file, fileContainer });
    diffInstance.render({ fileDiff: diff, fileContainer: diffContainer });
    await worker.waitForInitializeRequest();

    worker.emitError(new Error('worker failed to load'));
    await initialization.catch(() => {});
    await waitFor(
      () =>
        fileInstance.getRenderedFileForTest() === file &&
        diffInstance.getRenderedDiffForTest() === diff
    );

    expect(fileInstance.getRenderedFileForTest()).toBe(file);
    expect(diffInstance.getRenderedDiffForTest()).toBe(diff);
  } finally {
    fileInstance.cleanUp();
    diffInstance.cleanUp();
    manager.terminate();
    consoleError.mockRestore();
    dom.cleanup();
  }
});

test('applies replacement annotations while its diff is highlighted', async () => {
  const dom = installDom();
  const { manager, worker } = await createInitializedManager({
    theme: 'pierre-dark',
  });
  const instance = new TestFileDiff(
    {
      disableErrorHandling: true,
      disableFileHeader: true,
      renderAnnotation: (annotation) => {
        const element = document.createElement('span');
        element.textContent = annotation.metadata;
        return element;
      },
      theme: 'pierre-dark',
    },
    manager
  );
  const fileContainer = document.createElement('div');
  fileContainer.attachShadow({ mode: 'open' });
  const diffA = createDiff(
    'annotations:a',
    'const alpha = 1;\nconst stable = 1;\n'
  );
  const diffB = createDiff(
    'annotations:b',
    'const before = 0;\nconst beta = 2;\n'
  );
  const annotationsA: DiffLineAnnotation<string>[] = [
    { side: 'additions', lineNumber: 1, metadata: 'annotation:A' },
  ];
  const annotationsB: DiffLineAnnotation<string>[] = [
    { side: 'additions', lineNumber: 2, metadata: 'annotation:B' },
  ];

  try {
    instance.render({
      fileContainer,
      fileDiff: diffA,
      lineAnnotations: annotationsA,
    });
    const requestA = await withTimeout(worker.waitForDiffRequest());
    worker.respond({
      type: 'success',
      requestType: 'diff',
      id: requestA.id,
      result: renderDiffWithHighlighter(
        diffA,
        sharedHighlighter,
        manager.getDiffRenderOptions()
      ),
      options: manager.getDiffRenderOptions(),
      sentAt: Date.now(),
    });
    await waitFor(
      () =>
        instance.getRenderedDiffForTest() === diffA &&
        getAnnotationText(fileContainer, 'annotation-additions-1') ===
          'annotation:A'
    );
    expect(instance.getRenderedDiffForTest()).toBe(diffA);
    expect(getAnnotationText(fileContainer, 'annotation-additions-1')).toBe(
      'annotation:A'
    );

    instance.render({
      fileContainer,
      fileDiff: diffB,
      lineAnnotations: annotationsB,
    });
    expect(instance.getRenderedDiffForTest()).toBe(diffA);
    expect(
      getAnnotationText(fileContainer, 'annotation-additions-1')
    ).toBeUndefined();
    expect(getAnnotationText(fileContainer, 'annotation-additions-2')).toBe(
      'annotation:B'
    );

    instance.completeHighlightForTest(
      diffB,
      renderDiffWithHighlighter(
        diffB,
        sharedHighlighter,
        manager.getDiffRenderOptions()
      ),
      manager.getDiffRenderOptions()
    );
    await waitFor(
      () =>
        instance.getRenderedDiffForTest() === diffB &&
        getAnnotationText(fileContainer, 'annotation-additions-2') ===
          'annotation:B'
    );
    expect(instance.getRenderedDiffForTest()).toBe(diffB);
    expect(getAnnotationText(fileContainer, 'annotation-additions-2')).toBe(
      'annotation:B'
    );
    expect(
      getAnnotationText(fileContainer, 'annotation-additions-1')
    ).toBeUndefined();
  } finally {
    instance.cleanUp();
    manager.terminate();
    dom.cleanup();
  }
});
