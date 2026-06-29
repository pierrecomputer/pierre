import { afterAll, describe, expect, test } from 'bun:test';

import {
  disposeHighlighter,
  File,
  type FileContents,
  type LineAnnotation,
  type RenderRange,
} from '../src';
import { installDom, wait } from './domHarness';

afterAll(async () => {
  await disposeHighlighter();
});

function makeFile(lineCount: number): FileContents {
  const lines = Array.from(
    { length: lineCount },
    (_, index) => `line ${index + 1}`
  );
  return {
    name: 'file.txt',
    contents: `${lines.join('\n')}\n`,
    cacheKey: `file:${lineCount}`,
  };
}

function makeRange(startingLine: number, totalLines: number): RenderRange {
  return {
    startingLine,
    totalLines,
    bufferBefore: 0,
    bufferAfter: 0,
  };
}

async function waitForAnnotationCount(
  container: HTMLElement,
  expected: number
): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt++) {
    const count = container.shadowRoot?.querySelectorAll(
      '[data-line-annotation="-1,-1"]'
    ).length;
    if (count === expected) {
      return;
    }
    await wait(10);
  }
  throw new Error(`Timed out waiting for ${expected} file-level annotations`);
}

describe('File partial render', () => {
  test('hydrate can only initialize a File instance', () => {
    const { cleanup } = installDom();
    let instance: File<string> | undefined;
    try {
      const file = makeFile(4);
      const fileContainer = document.createElement('div');
      instance = new File({
        disableErrorHandling: true,
        disableFileHeader: true,
      });

      instance.hydrate({ file, fileContainer });

      expect(() => instance!.hydrate({ file, fileContainer })).toThrow(
        'File.hydrate: hydrate can only be called before the instance has rendered or hydrated'
      );
    } finally {
      instance?.cleanUp();
      cleanup();
    }
  });

  test('hydrate after render rejects File updates', () => {
    const { cleanup } = installDom();
    let instance: File<string> | undefined;
    try {
      const file = makeFile(4);
      const fileContainer = document.createElement('div');
      instance = new File({
        disableErrorHandling: true,
        disableFileHeader: true,
      });

      instance.render({
        file,
        fileContainer,
        deferManagers: true,
        preventEmit: true,
      });

      expect(() => instance!.hydrate({ file, fileContainer })).toThrow(
        'File.hydrate: hydrate can only be called before the instance has rendered or hydrated'
      );
    } finally {
      instance?.cleanUp();
      cleanup();
    }
  });

  test('preserves file-level annotations when a top render range grows', async () => {
    const { cleanup } = installDom();
    let instance: File<string> | undefined;
    try {
      const file = makeFile(120);
      const fileContainer = document.createElement('div');
      const lineAnnotations: LineAnnotation<string>[] = [
        { lineNumber: 0, metadata: 'file' },
      ];
      instance = new File({
        disableErrorHandling: true,
        disableFileHeader: true,
      });

      instance.render({
        file,
        fileContainer,
        lineAnnotations,
        deferManagers: true,
        preventEmit: true,
        renderRange: makeRange(0, 50),
      });
      await waitForAnnotationCount(fileContainer, 1);

      instance.render({
        file,
        fileContainer,
        lineAnnotations,
        deferManagers: true,
        preventEmit: true,
        renderRange: makeRange(0, 100),
      });
      await waitForAnnotationCount(fileContainer, 1);

      const content = fileContainer.shadowRoot?.querySelector('[data-content]');
      expect(content?.children[0]?.getAttribute('data-line-annotation')).toBe(
        '-1,-1'
      );
      expect(content?.querySelectorAll('[data-line-index]').length).toBe(100);
    } finally {
      instance?.cleanUp();
      cleanup();
    }
  });
});
