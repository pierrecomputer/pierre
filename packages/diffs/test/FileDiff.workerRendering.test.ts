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
} from '../src/types';
import { parseDiffFromFile } from '../src/utils/parseDiffFromFile';
import { renderDiffWithHighlighter } from '../src/utils/renderDiffWithHighlighter';
import type { RenderDiffRequest } from '../src/worker/types';
import { installDom, wait, waitFor } from './domHarness';
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

test('a pool terminated while a diff primes its highlight logs nothing', async () => {
  const dom = installDom();
  const consoleError = spyOn(console, 'error').mockImplementation(() => {});
  const { manager, worker } = await createInitializedManager({
    theme: 'pierre-dark',
  });
  const diffInstance = new TestFileDiff(
    { disableErrorHandling: true, disableFileHeader: true },
    manager
  );
  const diff = createDiff('terminated:diff', 'const terminated = true;\n');

  try {
    const primed = diffInstance.primeHighlightCache(diff);
    await worker.waitForDiffRequest();

    // Terminating the pool cancels the pending highlight without logging
    // an error.
    manager.terminate();
    await primed;

    expect(consoleError).not.toHaveBeenCalled();
  } finally {
    diffInstance.cleanUp();
    manager.terminate();
    consoleError.mockRestore();
    dom.cleanup();
  }
});

// Use real worker requests to keep the pending interval under test control.
async function createHighlightedDiffFixture() {
  const dom = installDom();
  const { manager, worker } = await createInitializedManager({
    theme: 'pierre-dark',
  });
  const instance = new TestFileDiff(
    {
      disableErrorHandling: true,
      disableFileHeader: true,
      theme: 'pierre-dark',
      renderAnnotation(annotation) {
        const element = document.createElement('span');
        element.textContent = annotation.metadata;
        return element;
      },
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
  const render = (
    fileDiff: FileDiffMetadata,
    lineAnnotations?: DiffLineAnnotation<string>[]
  ) => instance.render({ fileContainer, fileDiff, lineAnnotations });
  const getRequest = async (count: number) => {
    await waitFor(() => worker.diffRequestCount >= count);
    return withTimeout(worker.waitForDiffRequest());
  };
  const respond = (request: RenderDiffRequest, diff: FileDiffMetadata) => {
    const options = manager.getDiffRenderOptions();
    worker.respond({
      type: 'success',
      requestType: 'diff',
      id: request.id,
      result: renderDiffWithHighlighter(diff, sharedHighlighter, options),
      options,
      sentAt: Date.now(),
    });
  };
  const annotationText = (line: number) =>
    getAnnotationText(fileContainer, `annotation-additions-${line}`);
  const hasAnnotationRow = (line: number) =>
    fileContainer.shadowRoot?.querySelector(
      `slot[name="annotation-additions-${line}"]`
    ) != null;
  render(diffA, annotationsA);
  respond(await getRequest(1), diffA);
  await waitFor(
    () =>
      instance.getRenderedDiffForTest() === diffA &&
      annotationText(1) === 'annotation:A'
  );
  return {
    instance,
    diffA,
    diffB,
    annotationsA,
    annotationsB,
    render,
    getRequest,
    respond,
    annotationText,
    hasAnnotationRow,
    cleanup() {
      instance.cleanUp();
      manager.terminate();
      dom.cleanup();
    },
  };
}

for (const reuseDisplayed of [false, true]) {
  test(`FileDiff adopts replacement content and ${reuseDisplayed ? 'reused' : 'removed'} annotations together`, async () => {
    const fixture = await createHighlightedDiffFixture();
    const {
      instance,
      render,
      diffA,
      diffB,
      annotationsB,
      annotationText,
      hasAnnotationRow,
    } = fixture;
    try {
      const updatedA: DiffLineAnnotation<string>[] = [
        { side: 'additions', lineNumber: 1, metadata: 'annotation:A updated' },
      ];
      render(diffA, updatedA);
      expect(instance.getRenderedDiffForTest()).toBe(diffA);
      expect(annotationText(1)).toBe('annotation:A updated');
      render(diffB, annotationsB);
      expect(instance.fileDiff).toBe(diffB);
      expect(instance.getRenderedDiffForTest()).toBe(diffA);
      expect(annotationText(1)).toBe('annotation:A updated');
      expect(hasAnnotationRow(1)).toBe(true);
      expect(hasAnnotationRow(2)).toBe(false);
      render(diffB, reuseDisplayed ? updatedA : []);
      expect(instance.getRenderedDiffForTest()).toBe(diffA);
      expect(annotationText(1)).toBe('annotation:A updated');
      fixture.respond(await fixture.getRequest(2), diffB);
      await waitFor(() => instance.getRenderedDiffForTest() === diffB);
      expect(annotationText(1)).toBe(
        reuseDisplayed ? 'annotation:A updated' : undefined
      );
      expect(hasAnnotationRow(1)).toBe(reuseDisplayed);
      expect(hasAnnotationRow(2)).toBe(false);
    } finally {
      fixture.cleanup();
    }
  });
}

test('FileDiff returns to the adopted diff and ignores a late replacement highlight', async () => {
  const fixture = await createHighlightedDiffFixture();
  const {
    instance,
    render,
    diffA,
    diffB,
    annotationsA,
    annotationsB,
    annotationText,
  } = fixture;
  try {
    render(diffB, annotationsB);
    expect(instance.fileDiff).toBe(diffB);
    const requestB = await fixture.getRequest(2);
    render(diffA, annotationsA);
    expect(instance.getRenderedDiffForTest()).toBe(diffA);
    expect(annotationText(1)).toBe('annotation:A');
    fixture.respond(requestB, diffB);
    await wait();
    expect(instance.getRenderedDiffForTest()).toBe(diffA);
    expect(annotationText(1)).toBe('annotation:A');
    expect(annotationText(2)).toBeUndefined();
  } finally {
    fixture.cleanup();
  }
});
