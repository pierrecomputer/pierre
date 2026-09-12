import { afterAll, describe, expect, test } from 'bun:test';

import {
  disposeHighlighter,
  FileDiff,
  parseDiffFromFile,
  parsePatchFiles,
} from '../src';
import type { AnnotationSide, DiffLineAnnotation } from '../src/types';
import { installDom } from './domHarness';

afterAll(async () => {
  await disposeHighlighter();
});

async function waitForRenderedCode(container: HTMLElement): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt++) {
    if (container.shadowRoot?.querySelector('code') != null) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Timed out waiting for FileDiff render');
}

describe('FileDiff partial render', () => {
  test('line lookup excludes unavailable source lines in a partial patch', async () => {
    const { cleanup } = installDom();
    const instance = new FileDiff({ diffStyle: 'unified' });
    try {
      const fileDiff = parsePatchFiles(
        '--- a/example.txt\n+++ b/example.txt\n@@ -100 +120 @@\n-old\n+new\n@@ -130 +150 @@\n-before\n+after\n'
      )[0]?.files[0];
      expect(fileDiff).toBeDefined();
      const fileContainer = document.createElement('div');
      instance.render({ fileDiff, fileContainer });
      await waitForRenderedCode(fileContainer);

      expect(instance.getLineIndex(100, 'deletions')).toEqual([119, 119]);
      expect(instance.getLineIndex(120, 'additions')).toEqual([120, 119]);
      expect(instance.getLineIndex(130, 'deletions')).toBeDefined();
      expect(instance.getLineIndex(150, 'additions')).toBeDefined();
      // Missing new-source positions must not match an old row's index.
      for (const line of [100, 119, 121, 130, 149, 151]) {
        expect(instance.getLineIndex(line, 'additions')).toBeUndefined();
      }
      for (const line of [99, 101, 120, 129, 131]) {
        expect(instance.getLineIndex(line, 'deletions')).toBeUndefined();
      }
    } finally {
      instance.cleanUp();
      cleanup();
    }
  });

  test('expanded context before and after a hunk keeps its additions source', async () => {
    const { cleanup } = installDom();
    const clicks: Array<[number, AnnotationSide]> = [];
    const instance = new FileDiff({
      diffStyle: 'unified',
      expandUnchanged: true,
      onLineClick: (event) =>
        clicks.push([event.lineNumber, event.annotationSide]),
    });
    try {
      const oldLines = Array.from(
        { length: 16 },
        (_, index) => `line ${index + 1}\n`
      );
      const newLines = [...oldLines];
      newLines[7] = 'changed\n';
      const fileDiff = parseDiffFromFile(
        { name: 'example.txt', contents: oldLines.join('') },
        { name: 'example.txt', contents: newLines.join('') }
      );
      const fileContainer = document.createElement('div');
      instance.render({ fileDiff, fileContainer });
      await waitForRenderedCode(fileContainer);

      for (const lineNumber of [1, 16]) {
        const row = fileContainer.shadowRoot?.querySelector(
          `[data-line="${lineNumber}"]`
        );
        expect(row?.getAttribute('data-line-type')).toBe('context-expanded');
        expect(row?.getAttribute('data-alt-line')).toBe(`${lineNumber}`);
        row?.dispatchEvent(
          new MouseEvent('click', { bubbles: true, composed: true })
        );
      }
      expect(clicks).toEqual([
        [1, 'additions'],
        [16, 'additions'],
      ]);
    } finally {
      instance.cleanUp();
      cleanup();
    }
  });

  // Crash regression guard: re-rendering a narrower range over an annotated
  // deleted line exercises the partial-render trim path. disableErrorHandling
  // surfaces applyPartialRender's internal invariant errors as throws, so the
  // not.toThrow assertion catches trim crashes. It does not inspect the
  // resulting DOM, so column alignment itself is not verified here.
  test('re-rendering a narrower range over an annotated deleted line does not throw', async () => {
    const { cleanup } = installDom();
    let instance: FileDiff<string> | undefined;
    try {
      const oldFile = { name: 'x.txt', contents: 'a\nb\nc\nd\n' };
      const newFile = { name: 'x.txt', contents: 'a\nd\n' };
      const fileDiff = parseDiffFromFile(oldFile, newFile);
      const fileContainer = document.createElement('div');
      const lineAnnotations: DiffLineAnnotation<string>[] = [
        { side: 'deletions', lineNumber: 2, metadata: 'annotation' },
      ];
      instance = new FileDiff<string>({
        disableErrorHandling: true,
        disableFileHeader: true,
        diffStyle: 'split',
      });

      instance.render({
        fileContainer,
        fileDiff,
        lineAnnotations,
        deferManagers: true,
        preventEmit: true,
        renderRange: {
          startingLine: 1,
          totalLines: 3,
          bufferBefore: 0,
          bufferAfter: 0,
        },
      });
      await waitForRenderedCode(fileContainer);

      expect(() => {
        instance!.render({
          fileContainer,
          fileDiff,
          lineAnnotations,
          deferManagers: true,
          preventEmit: true,
          renderRange: {
            startingLine: 2,
            totalLines: 2,
            bufferBefore: 0,
            bufferAfter: 0,
          },
        });
      }).not.toThrow();
    } finally {
      instance?.cleanUp();
      cleanup();
    }
  });

  test('re-rendering a range that excludes the top removes file-level annotations', async () => {
    const { cleanup } = installDom();
    let instance: FileDiff<string> | undefined;
    try {
      const oldFile = { name: 'x.txt', contents: 'a\nb\nc\nd\n' };
      const newFile = { name: 'x.txt', contents: 'a\nB\nc\nd\n' };
      const fileDiff = parseDiffFromFile(oldFile, newFile);
      const fileContainer = document.createElement('div');
      const lineAnnotations: DiffLineAnnotation<string>[] = [
        { side: 'deletions', lineNumber: 0, metadata: 'old-file' },
        { side: 'additions', lineNumber: 0, metadata: 'new-file' },
      ];
      instance = new FileDiff<string>({
        disableErrorHandling: true,
        disableFileHeader: true,
        diffStyle: 'split',
      });

      instance.render({
        fileContainer,
        fileDiff,
        lineAnnotations,
        deferManagers: true,
        preventEmit: true,
        renderRange: {
          startingLine: 0,
          totalLines: 2,
          bufferBefore: 0,
          bufferAfter: 0,
        },
      });
      await waitForRenderedCode(fileContainer);

      expect(
        fileContainer.shadowRoot?.querySelectorAll(
          '[data-line-annotation="-1,-1"]'
        ).length
      ).toBe(2);

      instance.render({
        fileContainer,
        fileDiff,
        lineAnnotations,
        deferManagers: true,
        preventEmit: true,
        renderRange: {
          startingLine: 1,
          totalLines: 2,
          bufferBefore: 0,
          bufferAfter: 0,
        },
      });
      await waitForRenderedCode(fileContainer);

      expect(
        fileContainer.shadowRoot?.querySelectorAll(
          '[data-line-annotation="-1,-1"]'
        ).length
      ).toBe(0);
    } finally {
      instance?.cleanUp();
      cleanup();
    }
  });

  test('renders a new file from an explicit missing oldFile side', async () => {
    const { cleanup } = installDom();
    let instance: FileDiff<string> | undefined;
    try {
      const newFile = { name: 'new.txt', contents: 'alpha\nbeta\n' };
      const fileContainer = document.createElement('div');
      instance = new FileDiff<string>({
        disableErrorHandling: true,
        disableFileHeader: true,
        diffStyle: 'split',
      });

      instance.render({
        fileContainer,
        oldFile: null,
        newFile,
        deferManagers: true,
        preventEmit: true,
      });
      await waitForRenderedCode(fileContainer);

      expect(instance.fileDiff?.type).toBe('new');
      expect(instance.fileDiff?.isPartial).toBe(false);
      expect(instance.fileDiff?.deletionLines).toEqual([]);
      expect(instance.fileDiff?.additionLines).toEqual(['alpha\n', 'beta\n']);
    } finally {
      instance?.cleanUp();
      cleanup();
    }
  });

  test('renders a deleted file from an explicit missing newFile side', async () => {
    const { cleanup } = installDom();
    let instance: FileDiff<string> | undefined;
    try {
      const oldFile = { name: 'deleted.txt', contents: 'alpha\nbeta\n' };
      const fileContainer = document.createElement('div');
      instance = new FileDiff<string>({
        disableErrorHandling: true,
        disableFileHeader: true,
        diffStyle: 'split',
      });

      instance.render({
        fileContainer,
        oldFile,
        newFile: null,
        deferManagers: true,
        preventEmit: true,
      });
      await waitForRenderedCode(fileContainer);

      expect(instance.fileDiff?.type).toBe('deleted');
      expect(instance.fileDiff?.isPartial).toBe(false);
      expect(instance.fileDiff?.deletionLines).toEqual(['alpha\n', 'beta\n']);
      expect(instance.fileDiff?.additionLines).toEqual([]);
    } finally {
      instance?.cleanUp();
      cleanup();
    }
  });
});
