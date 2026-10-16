import { afterAll, beforeAll, expect, test } from 'bun:test';

import { File } from '../src/components/File';
import {
  disposeHighlighter,
  getSharedHighlighter,
} from '../src/highlighter/shared_highlighter';
import type {
  DiffsHighlighter,
  FileContents,
  LineAnnotation,
} from '../src/types';
import { renderFileWithHighlighter } from '../src/utils/renderFileWithHighlighter';
import type { RenderFileRequest } from '../src/worker/types';
import { installDom, wait, waitFor } from './domHarness';
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

class TestFile extends File<string> {
  getRenderedFileForTest(): FileContents | undefined {
    return this.getRenderedFile();
  }

  getAnnotationsForTest(): LineAnnotation<string>[] {
    return this.lineAnnotations;
  }
}

const fileA: FileContents = {
  name: 'pending.ts',
  contents: 'const alpha = 1;\nconst stable = 0;\n',
  cacheKey: 'pending:file:a',
};
const fileB: FileContents = {
  ...fileA,
  contents: 'const stable = 0;\nconst beta = 2;\n',
  cacheKey: 'pending:file:b',
};
const fileC: FileContents = {
  ...fileA,
  contents: 'const gamma = 3;\n',
  cacheKey: 'pending:file:c',
};
const annotationsA: LineAnnotation<string>[] = [
  { lineNumber: 1, metadata: 'annotation:A' },
];
const annotationsB: LineAnnotation<string>[] = [
  { lineNumber: 2, metadata: 'annotation:B' },
];

// Control real worker responses so assertions cover both the waiting interval
// and the render that adopts replacement content.
async function createFixture() {
  const dom = installDom();
  const { manager, worker } = await createInitializedManager({
    theme: 'pierre-dark',
  });
  const container = document.createElement('div');
  document.body.appendChild(container);
  const annotationContents: FileContents[] = [];
  const instance = new TestFile(
    {
      disableErrorHandling: true,
      theme: 'pierre-dark',
      renderAnnotation(annotation, file) {
        annotationContents.push(file);
        const element = document.createElement('span');
        element.textContent = annotation.metadata;
        return element;
      },
    },
    manager
  );
  const render = (
    file: FileContents,
    lineAnnotations?: LineAnnotation<string>[]
  ) => instance.render({ file, fileContainer: container, lineAnnotations });
  const getRequest = async (count: number) => {
    await waitFor(() => worker.fileRequestCount >= count);
    return withTimeout(worker.waitForFileRequest());
  };
  const respond = (request: RenderFileRequest, file: FileContents) => {
    const options = manager.getFileRenderOptions();
    worker.respond({
      type: 'success',
      requestType: 'file',
      id: request.id,
      result: renderFileWithHighlighter(file, highlighter, options),
      options,
      sentAt: Date.now(),
    });
  };
  const annotationText = (line: number) =>
    container.querySelector(`[slot="annotation-${line}"]`)?.textContent;
  const hasAnnotationRow = (line: number) =>
    container.shadowRoot?.querySelector(`slot[name="annotation-${line}"]`) !=
    null;
  // Annotation content lives in light DOM; its row lives in the shadow DOM.
  const annotationAt = (line: number) => ({
    text: annotationText(line),
    row: hasAnnotationRow(line),
  });

  render(fileA, annotationsA);
  respond(await getRequest(1), fileA);
  await waitFor(() => annotationText(1) === 'annotation:A');

  return {
    instance,
    annotationContents,
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
  test(`File adopts replacement content and ${reuseDisplayed ? 'reused' : 'removed'} annotations together`, async () => {
    const fixture = await createFixture();
    const { instance, render, annotationText, hasAnnotationRow } = fixture;
    try {
      const updatedA: LineAnnotation<string>[] = [
        { lineNumber: 1, metadata: 'annotation:A updated' },
      ];
      render(fileA, updatedA);
      expect(instance.getRenderedFileForTest()).toBe(fileA);
      expect(instance.getAnnotationsForTest()).toBe(updatedA);
      expect(annotationText(1)).toBe('annotation:A updated');
      expect(fixture.annotationContents.at(-1)).toBe(fileA);

      render(fileB, annotationsB);
      expect(instance.file).toBe(fileB);
      expect(instance.getRenderedFileForTest()).toBe(fileA);
      expect(instance.getAnnotationsForTest()).toBe(updatedA);
      expect(annotationText(1)).toBe('annotation:A updated');
      expect(fixture.annotationContents.at(-1)).toBe(fileA);
      expect(hasAnnotationRow(1)).toBe(true);
      expect(hasAnnotationRow(2)).toBe(false);

      const finalAnnotations = reuseDisplayed ? updatedA : [];
      render(fileB, finalAnnotations);
      expect(instance.getRenderedFileForTest()).toBe(fileA);
      expect(instance.getAnnotationsForTest()).toBe(updatedA);
      expect(annotationText(1)).toBe('annotation:A updated');
      expect(fixture.annotationContents.at(-1)).toBe(fileA);

      fixture.respond(await fixture.getRequest(2), fileB);
      await waitFor(() => instance.getRenderedFileForTest() === fileB);
      expect(instance.getAnnotationsForTest()).toBe(finalAnnotations);
      expect(annotationText(1)).toBe(
        reuseDisplayed ? 'annotation:A updated' : undefined
      );
      expect(fixture.annotationContents.at(-1)).toBe(
        reuseDisplayed ? fileB : fileA
      );
      expect(hasAnnotationRow(1)).toBe(reuseDisplayed);
      expect(hasAnnotationRow(2)).toBe(false);
    } finally {
      fixture.cleanup();
    }
  });
}

test('File replaces queued data without adopting a superseded highlight', async () => {
  const fixture = await createFixture();
  const { instance, render, annotationText } = fixture;
  try {
    render(fileB, annotationsB);
    expect(instance.file).toBe(fileB);
    const requestB = await fixture.getRequest(2);
    render(fileC, []);
    expect(instance.file).toBe(fileC);
    expect(instance.getRenderedFileForTest()).toBe(fileA);
    expect(instance.getAnnotationsForTest()).toBe(annotationsA);

    fixture.respond(requestB, fileB);
    await wait();
    expect(instance.getRenderedFileForTest()).toBe(fileA);
    expect(annotationText(1)).toBe('annotation:A');

    fixture.respond(await fixture.getRequest(3), fileC);
    await waitFor(() => instance.getRenderedFileForTest() === fileC);
    expect(instance.getAnnotationsForTest()).toEqual([]);
    expect(annotationText(1)).toBeUndefined();

    const plainFile = {
      ...fileC,
      lang: 'text',
      cacheKey: 'pending:file:plain',
    };
    render(plainFile, annotationsA);
    expect(instance.file).toBe(plainFile);
    expect(instance.getRenderedFileForTest()).toBe(plainFile);
    expect(instance.getAnnotationsForTest()).toBe(annotationsA);
    expect(annotationText(1)).toBe('annotation:A');
  } finally {
    fixture.cleanup();
  }
});

test('File returns to the adopted file and ignores a late replacement highlight', async () => {
  const fixture = await createFixture();
  const { instance, render, annotationAt } = fixture;
  try {
    render(fileB, annotationsB);
    expect(instance.file).toBe(fileB);
    const requestB = await fixture.getRequest(2);
    render(fileA, annotationsA);
    expect(instance.getRenderedFileForTest()).toBe(fileA);
    expect(annotationAt(1)).toEqual({ text: 'annotation:A', row: true });

    fixture.respond(requestB, fileB);
    await wait();
    expect(instance.getRenderedFileForTest()).toBe(fileA);
    expect(annotationAt(1)).toEqual({ text: 'annotation:A', row: true });
    expect(annotationAt(2)).toEqual({ text: undefined, row: false });
  } finally {
    fixture.cleanup();
  }
});

test('File applies annotations immediately for an equivalent file object', async () => {
  const fixture = await createFixture();
  const { instance, render, annotationAt } = fixture;
  try {
    const equivalentA = { ...fileA };
    render(equivalentA, annotationsB);
    expect(instance.getRenderedFileForTest()).toBe(fileA);
    expect(annotationAt(1)).toEqual({ text: undefined, row: false });
    expect(annotationAt(2)).toEqual({ text: 'annotation:B', row: true });
  } finally {
    fixture.cleanup();
  }
});
