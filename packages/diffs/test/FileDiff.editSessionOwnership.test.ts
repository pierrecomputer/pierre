import { afterAll, describe, expect, test } from 'bun:test';

import { disposeHighlighter, FileDiff, parseDiffFromFile } from '../src';
import { Editor } from '../src/editor/editor';
import type {
  DiffsEditor,
  DiffsTextDocument,
  FileContents,
  FileDiffMetadata,
  HighlightedToken,
} from '../src/types';
import { installDom, waitFor } from './domHarness';

afterAll(async () => {
  await disposeHighlighter();
});

class TestFileDiff extends FileDiff<undefined> {
  getCurrentDiffForTest(): FileDiffMetadata | undefined {
    return this.getCurrentDiff();
  }

  getRendererDiffForTest(): FileDiffMetadata | undefined {
    return this.hunksRenderer.diffCache;
  }

  isEditorRenderReadyForTest(): boolean {
    return this.hunksRenderer.editorRenderReady();
  }
}

function createEditorStub(): DiffsEditor<undefined> {
  return {
    cleanUp() {},
    edit: () => () => {},
    __captureFocusForDOMReplacement() {},
    __postponeBgTokenizeToNextFrame() {},
    __syncRenderView() {},
  };
}

function createExternalDiff(): FileDiffMetadata {
  const fileDiff = parseDiffFromFile(
    { name: 'session.ts', contents: 'alpha\nold value\nomega\n' },
    { name: 'session.ts', contents: 'alpha\nnew value\nomega\n' }
  );
  fileDiff.cacheKey = 'external:session-v1';
  return fileDiff;
}

function captureExternalDiffState(fileDiff: FileDiffMetadata) {
  return {
    value: structuredClone(fileDiff),
    additionLines: fileDiff.additionLines,
    deletionLines: fileDiff.deletionLines,
    hunks: fileDiff.hunks,
    hunkItems: [...fileDiff.hunks],
  };
}

function expectExternalDiffUnchanged(
  instance: TestFileDiff,
  externalDiff: FileDiffMetadata,
  before: ReturnType<typeof captureExternalDiffState>
): void {
  expect(instance.fileDiff).toBe(externalDiff);
  expect(externalDiff.additionLines).toBe(before.additionLines);
  expect(externalDiff.deletionLines).toBe(before.deletionLines);
  expect(externalDiff.hunks).toBe(before.hunks);
  for (const [index, hunk] of before.hunkItems.entries()) {
    expect(externalDiff.hunks[index]).toBe(hunk);
  }
  expect(externalDiff).toEqual(before.value);
}

function makeDirtyLines(
  edits: ReadonlyArray<[number, string]>
): Map<number, HighlightedToken[]> {
  return new Map(edits.map(([line, text]) => [line, [[0, '', text]]]));
}

function makeTextDocument(lines: string[]): DiffsTextDocument {
  return {
    lineCount: lines.length,
    getText: () => lines.join(''),
    getLineText: (lineNumber: number, includeLineBreak = false) => {
      const line = lines[lineNumber] ?? '';
      return includeLineBreak ? line : line.replace(/\r?\n$/, '');
    },
  };
}

async function createAttachedFixture(): Promise<{
  cleanup(): void;
  detach(recycle?: boolean): void;
  externalDiff: FileDiffMetadata;
  instance: TestFileDiff;
}> {
  const dom = installDom();
  const fileContainer = document.createElement('div');
  document.body.appendChild(fileContainer);
  const externalDiff = createExternalDiff();
  const instance = new TestFileDiff({
    disableErrorHandling: true,
    disableFileHeader: true,
  });

  instance.render({
    fileDiff: externalDiff,
    fileContainer,
    forceRender: true,
  });
  const detach = instance.attachEditor(createEditorStub());

  await waitFor(
    () => {
      const sessionDiff = instance.getCurrentDiffForTest();
      return (
        sessionDiff != null &&
        sessionDiff !== externalDiff &&
        instance.isEditorRenderReadyForTest()
      );
    },
    { timeout: 4_000 }
  );
  const sessionDiff = instance.getCurrentDiffForTest();
  expect(sessionDiff).toBeDefined();
  expect(sessionDiff).not.toBe(externalDiff);
  expect(instance.isEditorRenderReadyForTest()).toBe(true);

  return {
    cleanup() {
      instance.cleanUp();
      dom.cleanup();
    },
    detach,
    externalDiff,
    instance,
  };
}

describe('FileDiff edit-session ownership', () => {
  test('mutation entry points reject writes without an edit session', () => {
    const dom = installDom();
    const fileContainer = document.createElement('div');
    document.body.appendChild(fileContainer);
    const externalDiff = createExternalDiff();
    const externalBefore = captureExternalDiffState(externalDiff);
    const instance = new TestFileDiff({
      disableErrorHandling: true,
      disableFileHeader: true,
    });

    try {
      instance.render({
        fileDiff: externalDiff,
        fileContainer,
        forceRender: true,
      });

      expect(() =>
        instance.updateRenderCache(
          makeDirtyLines([[1, 'edited value']]),
          'light'
        )
      ).toThrow('FileDiff.updateRenderCache: requires an active edit session');
      expect(() =>
        instance.applyDocumentChange(
          makeTextDocument(['alpha\n', 'inserted\n', 'new value\n', 'omega\n'])
        )
      ).toThrow(
        'FileDiff.applyDocumentChange: requires an active edit session'
      );

      expectExternalDiffUnchanged(instance, externalDiff, externalBefore);
    } finally {
      instance.cleanUp();
      dom.cleanup();
    }
  });

  test('attach creates a private keyless shallow session diff', async () => {
    const fixture = await createAttachedFixture();
    const { detach, externalDiff, instance } = fixture;
    try {
      const sessionDiff = instance.getCurrentDiffForTest();
      expect(sessionDiff).toBeDefined();
      if (sessionDiff == null) return;

      expect(sessionDiff).not.toBe(externalDiff);
      expect(sessionDiff.cacheKey).toBeUndefined();
      expect(externalDiff.cacheKey).toBe('external:session-v1');
      expect(sessionDiff.additionLines).toBe(externalDiff.additionLines);
      expect(sessionDiff.deletionLines).toBe(externalDiff.deletionLines);
      expect(sessionDiff.hunks).toBe(externalDiff.hunks);
      expect(sessionDiff.hunks[0]).toBe(externalDiff.hunks[0]);
    } finally {
      detach();
      fixture.cleanup();
    }
  });

  test('a same-line edit copies addition lines and keeps hunks shared', async () => {
    const fixture = await createAttachedFixture();
    const { detach, externalDiff, instance } = fixture;
    const externalBefore = captureExternalDiffState(externalDiff);
    try {
      const sessionBefore = instance.getCurrentDiffForTest();
      expect(sessionBefore).toBeDefined();
      if (sessionBefore == null) return;
      expect(sessionBefore.additionLines).toBe(externalDiff.additionLines);
      expect(sessionBefore.hunks).toBe(externalDiff.hunks);

      instance.updateRenderCache(
        makeDirtyLines([[1, 'edited value']]),
        'light'
      );

      const sessionAfter = instance.getCurrentDiffForTest();
      expect(sessionAfter).toBe(sessionBefore);
      expect(sessionAfter?.additionLines).not.toBe(externalDiff.additionLines);
      expect(sessionAfter?.additionLines[1]).toBe('edited value\n');
      expect(sessionAfter?.deletionLines).toBe(externalDiff.deletionLines);
      expect(sessionAfter?.hunks).toBe(externalDiff.hunks);
      expect(sessionAfter?.hunks[0]).toBe(externalDiff.hunks[0]);
      expect(sessionAfter?.editSessionDirty).toBe(true);
      expect(instance.getRendererDiffForTest()).toBe(sessionAfter);
      expectExternalDiffUnchanged(instance, externalDiff, externalBefore);
    } finally {
      detach();
      fixture.cleanup();
    }
  });

  test('a structural edit rebuilds an owned hunk graph', async () => {
    const fixture = await createAttachedFixture();
    const { detach, externalDiff, instance } = fixture;
    const externalBefore = captureExternalDiffState(externalDiff);
    try {
      const sessionBefore = instance.getCurrentDiffForTest();
      expect(sessionBefore).toBeDefined();
      if (sessionBefore == null) return;
      expect(sessionBefore.hunks).toBe(externalDiff.hunks);

      instance.applyDocumentChange(
        makeTextDocument(['alpha\n', 'inserted\n', 'new value\n', 'omega\n'])
      );

      const sessionAfter = instance.getCurrentDiffForTest();
      expect(sessionAfter).toBe(sessionBefore);
      expect(sessionAfter?.additionLines).not.toBe(externalDiff.additionLines);
      expect(sessionAfter?.additionLines.join('')).toBe(
        'alpha\ninserted\nnew value\nomega\n'
      );
      expect(sessionAfter?.deletionLines).toBe(externalDiff.deletionLines);
      expect(sessionAfter?.hunks).not.toBe(externalDiff.hunks);
      expect(sessionAfter?.hunks[0]).not.toBe(externalDiff.hunks[0]);
      expect(sessionAfter?.cacheKey).toBeUndefined();
      expectExternalDiffUnchanged(instance, externalDiff, externalBefore);
    } finally {
      detach();
      fixture.cleanup();
    }
  });

  test('recycling clears renderer state without writing edits to the external diff', async () => {
    const fixture = await createAttachedFixture();
    const { detach, externalDiff, instance } = fixture;
    const externalBefore = captureExternalDiffState(externalDiff);
    try {
      instance.updateRenderCache(
        makeDirtyLines([[1, 'edited value']]),
        'light'
      );
      const sessionDiff = instance.getCurrentDiffForTest();
      expect(sessionDiff).toBeDefined();
      expect(sessionDiff?.additionLines[1]).toBe('edited value\n');

      detach(true);
      instance.cleanUp(true);

      expect(instance.getCurrentDiffForTest()).toBe(sessionDiff);
      expect(instance.getRendererDiffForTest()).toBeUndefined();
      expectExternalDiffUnchanged(instance, externalDiff, externalBefore);
    } finally {
      fixture.cleanup();
    }
  });

  test('real editor changes emit an edited keyless file without changing the external diff', async () => {
    const dom = installDom();
    const fileContainer = document.createElement('div');
    document.body.appendChild(fileContainer);
    const externalDiff = createExternalDiff();
    const externalBefore = captureExternalDiffState(externalDiff);
    const changedFiles: FileContents[] = [];
    const instance = new TestFileDiff({
      disableErrorHandling: true,
      disableFileHeader: true,
    });
    const editor = new Editor<undefined>({
      onChange: (file) => changedFiles.push(file),
    });

    try {
      instance.render({
        fileDiff: externalDiff,
        fileContainer,
        forceRender: true,
      });
      editor.edit(instance);

      await waitFor(() => editor.getText() === 'alpha\nnew value\nomega\n', {
        timeout: 4_000,
      });
      editor.applyEdits([
        {
          range: {
            start: { line: 1, character: 0 },
            end: { line: 1, character: 9 },
          },
          newText: 'edited value',
        },
      ]);

      expect(changedFiles).toHaveLength(1);
      expect(changedFiles[0]).toEqual({
        name: 'session.ts',
        contents: 'alpha\nedited value\nomega\n',
      });
      expect(changedFiles[0]?.cacheKey).toBeUndefined();
      expectExternalDiffUnchanged(instance, externalDiff, externalBefore);
    } finally {
      editor.cleanUp();
      instance.cleanUp();
      dom.cleanup();
    }
  });
});
