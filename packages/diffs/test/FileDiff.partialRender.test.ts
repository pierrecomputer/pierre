import { afterAll, describe, expect, test } from 'bun:test';

import { disposeHighlighter, FileDiff, parseDiffFromFile } from '../src';
import type { DiffLineAnnotation } from '../src/types';
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
