import { afterAll, beforeAll, expect, spyOn, test } from 'bun:test';

import { File } from '../src/components/File';
import { FileDiff, type FileDiffOptions } from '../src/components/FileDiff';
import {
  disposeHighlighter,
  getSharedHighlighter,
} from '../src/highlighter/shared_highlighter';
import { preloadFileDiff } from '../src/ssr';
import type {
  DiffLineAnnotation,
  DiffsHighlighter,
  FileContents,
  FileDiffMetadata,
} from '../src/types';
import { diffAcceptRejectHunk } from '../src/utils/diffAcceptRejectHunk';
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
  const annotationContents: FileDiffMetadata[] = [];
  const instance = new TestFileDiff(
    {
      disableErrorHandling: true,
      disableFileHeader: true,
      theme: 'pierre-dark',
      renderAnnotation(annotation, fileDiff) {
        annotationContents.push(fileDiff);
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
  // Annotation content lives in light DOM; its row lives in the shadow DOM.
  const annotationAt = (line: number) => ({
    text: annotationText(line),
    row: hasAnnotationRow(line),
  });
  render(diffA, annotationsA);
  respond(await getRequest(1), diffA);
  await waitFor(
    () =>
      instance.getRenderedDiffForTest() === diffA &&
      annotationText(1) === 'annotation:A'
  );
  return {
    manager,
    instance,
    fileContainer,
    annotationContents,
    diffA,
    diffB,
    annotationsA,
    annotationsB,
    render,
    getRequest,
    respond,
    annotationText,
    hasAnnotationRow,
    annotationAt,
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
      expect(fixture.annotationContents.at(-1)).toBe(diffA);
      render(diffB, annotationsB);
      expect(instance.fileDiff).toBe(diffB);
      expect(instance.getRenderedDiffForTest()).toBe(diffA);
      expect(annotationText(1)).toBe('annotation:A updated');
      expect(fixture.annotationContents.at(-1)).toBe(diffA);
      expect(hasAnnotationRow(1)).toBe(true);
      expect(hasAnnotationRow(2)).toBe(false);
      render(diffB, reuseDisplayed ? updatedA : []);
      expect(instance.getRenderedDiffForTest()).toBe(diffA);
      expect(annotationText(1)).toBe('annotation:A updated');
      expect(fixture.annotationContents.at(-1)).toBe(diffA);
      fixture.respond(await fixture.getRequest(2), diffB);
      await waitFor(() => instance.getRenderedDiffForTest() === diffB);
      expect(annotationText(1)).toBe(
        reuseDisplayed ? 'annotation:A updated' : undefined
      );
      expect(fixture.annotationContents.at(-1)).toBe(
        reuseDisplayed ? diffB : diffA
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

test('FileDiff replaces queued data without adopting a superseded highlight', async () => {
  const fixture = await createHighlightedDiffFixture();
  const { instance, render, diffA, diffB, annotationsA, annotationsB } =
    fixture;
  const { annotationAt } = fixture;
  try {
    const diffC = createDiff(
      'annotations:c',
      'const gamma = 3;\nconst stable = 1;\n'
    );
    render(diffB, annotationsB);
    const requestB = await fixture.getRequest(2);
    render(diffC, []);
    expect(instance.fileDiff).toBe(diffC);
    expect(instance.getRenderedDiffForTest()).toBe(diffA);
    expect(annotationAt(1)).toEqual({ text: 'annotation:A', row: true });

    fixture.respond(requestB, diffB);
    await wait();
    expect(instance.getRenderedDiffForTest()).toBe(diffA);
    expect(annotationAt(1)).toEqual({ text: 'annotation:A', row: true });
    expect(annotationAt(2)).toEqual({ text: undefined, row: false });

    fixture.respond(await fixture.getRequest(3), diffC);
    await waitFor(() => instance.getRenderedDiffForTest() === diffC);
    expect(annotationAt(1)).toEqual({ text: undefined, row: false });

    const plainDiff: FileDiffMetadata = {
      ...diffC,
      lang: 'text',
      cacheKey: 'annotations:plain',
    };
    render(plainDiff, annotationsA);
    expect(instance.getRenderedDiffForTest()).toBe(plainDiff);
    expect(annotationAt(1)).toEqual({ text: 'annotation:A', row: true });
  } finally {
    fixture.cleanup();
  }
});

test('FileDiff keeps hydrated annotations while a replacement is highlighted', async () => {
  const fixture = await createHighlightedDiffFixture();
  const { manager, diffA, diffB, annotationsA, annotationsB } = fixture;
  const options: FileDiffOptions<string, undefined> = {
    disableFileHeader: true,
    theme: 'pierre-dark',
  };
  const hydrated = new TestFileDiff(
    {
      ...options,
      disableErrorHandling: true,
      renderAnnotation(annotation) {
        const element = document.createElement('span');
        element.textContent = annotation.metadata;
        return element;
      },
    },
    manager
  );
  const fileContainer = document.createElement('div');
  try {
    const { prerenderedHTML } = await preloadFileDiff({
      fileDiff: diffA,
      options,
      annotations: annotationsA,
    });
    hydrated.hydrate({
      fileDiff: diffA,
      fileContainer,
      lineAnnotations: annotationsA,
      prerenderedHTML,
    });
    const annotationAt = (line: number) => ({
      text: getAnnotationText(fileContainer, `annotation-additions-${line}`),
      row:
        fileContainer.shadowRoot?.querySelector(
          `slot[name="annotation-additions-${line}"]`
        ) != null,
    });
    expect(annotationAt(1)).toEqual({ text: 'annotation:A', row: true });

    hydrated.render({ fileDiff: diffB, lineAnnotations: annotationsB });
    expect(hydrated.getRenderedDiffForTest()).toBe(diffA);
    expect(annotationAt(1)).toEqual({ text: 'annotation:A', row: true });
    expect(annotationAt(2)).toEqual({ text: undefined, row: false });

    const request = await fixture.getRequest(2);
    fixture.respond(request, request.diff);
    await waitFor(() => hydrated.getRenderedDiffForTest() === diffB);
    expect(annotationAt(1)).toEqual({ text: undefined, row: false });
    expect(annotationAt(2)).toEqual({ text: 'annotation:B', row: true });
  } finally {
    hydrated.cleanUp();
    fixture.cleanup();
  }
});

test('FileDiff keeps a hunk action with its hunk until the resolved diff renders', async () => {
  const fixture = await createHighlightedDiffFixture();
  const { instance, render, diffA, annotationAt } = fixture;
  const changedRows = () =>
    fixture.fileContainer.shadowRoot?.querySelectorAll(
      '[data-line-type="change-addition"]'
    ).length ?? 0;
  try {
    expect(changedRows()).toBeGreaterThan(0);
    // The annotation on the hunk's added line stands in for its action.
    const resolved = diffAcceptRejectHunk(diffA, 0, 'accept');
    render(resolved, []);
    expect(instance.getRenderedDiffForTest()).toBe(diffA);
    expect(changedRows()).toBeGreaterThan(0);
    expect(annotationAt(1)).toEqual({ text: 'annotation:A', row: true });

    fixture.respond(await fixture.getRequest(2), resolved);
    await waitFor(() => instance.getRenderedDiffForTest() === resolved);
    expect(changedRows()).toBe(0);
    expect(annotationAt(1)).toEqual({ text: undefined, row: false });
  } finally {
    fixture.cleanup();
  }
});

// Collapsing drops the highlighted rows, so expanding before the replacement
// is highlighted shows no code and no annotations until it is ready.
test('FileDiff shows no stale annotations when expanded during a replacement', async () => {
  const fixture = await createHighlightedDiffFixture();
  const { instance, render, diffB, annotationsB, annotationAt } = fixture;
  const setCollapsed = (collapsed: boolean) =>
    instance.setOptions({ ...instance.options, collapsed });
  try {
    setCollapsed(true);
    render(diffB, annotationsB);
    const requestB = await fixture.getRequest(2);
    setCollapsed(false);
    render(diffB, annotationsB);
    expect(annotationAt(1)).toEqual({ text: undefined, row: false });
    expect(annotationAt(2)).toEqual({ text: undefined, row: false });

    fixture.respond(requestB, diffB);
    await waitFor(() => instance.getRenderedDiffForTest() === diffB);
    expect(annotationAt(1)).toEqual({ text: undefined, row: false });
    expect(annotationAt(2)).toEqual({ text: 'annotation:B', row: true });
  } finally {
    fixture.cleanup();
  }
});

test('FileDiff applies annotations immediately for an equivalent diff object', async () => {
  const fixture = await createHighlightedDiffFixture();
  const { instance, render, diffA, annotationsB, annotationAt } = fixture;
  try {
    render({ ...diffA }, annotationsB);
    expect(instance.getRenderedDiffForTest()).toBe(diffA);
    expect(annotationAt(1)).toEqual({ text: undefined, row: false });
    expect(annotationAt(2)).toEqual({ text: 'annotation:B', row: true });
  } finally {
    fixture.cleanup();
  }
});
